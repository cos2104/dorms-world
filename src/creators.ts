/**
 * 만든 사람. 도름스가 알려 주는 공개 프로필(사진, 닉네임, 한 줄 소개, 꼬리표, 받은 도름)을 받아 메모리에 둔다.
 * 도름스 응답은 남이 주는 값이다: 모양과 길이를 여기서 검사하고, 화면에 그릴 때는 늘 esc 를 거친다(src/profile.ts).
 * 받지 못해도 화면은 그대로 뜬다(pack.json 의 닉네임과 기본 도름이 그림).
 */

export type Creator = {
  id: string; nickname: string; avatar: string | null; profileUrl: string | null;
  bio: string; dorms: number | null; tags: string[];
};

export const DORMS_ORIGIN = 'https://dorms.school';
export const CREATORS_URL = `${DORMS_ORIGIN}/api/world/creators`;
export const LIMIT = { nickname: 30, bio: 120, tags: 4, tag: 12, url: 300, creators: 500, bytes: 400_000 } as const;
const TTL_MS = 5 * 60_000, TIMEOUT_MS = 4000;

const PACK_ID = /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/;
const MEMBER_ID = /^[0-9A-Za-z-]{1,64}$/;
// 제어 문자, 글 방향을 뒤집는 문자, 폭 없는 글자: 이름을 다른 글처럼 보이게 꾸미는 데 쓰인다
const HIDDEN = /[\u0000-\u001F\u007F-\u009F​‎‏‪-‮⁠⁦-⁩﻿]/g;

/** 글 한 줄로 다듬는다: 글이 아니면 빈 글, 숨은 문자와 줄바꿈은 빈칸으로, 길이는 글자 수(코드 포인트)로 자른다. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const one = v.slice(0, max * 8 + 64).replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim();
  return [...one].slice(0, max).join('').trim();
}

/** 도름스 주소(https://dorms.school/ 로 시작)일 때만 돌려준다. 다른 곳의 주소, 빈칸이 든 주소, 너무 긴 주소는 버린다. */
export function dormsUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > LIMIT.url || !v.startsWith(`${DORMS_ORIGIN}/`) || /[\s\u0000-\u001F\u007F"'<>\\`]/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.origin === DORMS_ORIGIN && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

/** 한 사람의 값을 검사한다. 회원 번호나 닉네임이 없으면 없는 사람으로 친다(null). */
export function parseCreator(raw: unknown): Creator | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const nickname = cleanText(r.nickname, LIMIT.nickname);
  if (typeof r.id !== 'string' || !MEMBER_ID.test(r.id) || !nickname) return null;
  const tags = (Array.isArray(r.tags) ? r.tags.slice(0, 40) : []).map(t => cleanText(t, LIMIT.tag)).filter(Boolean).slice(0, LIMIT.tags);
  const dorms = typeof r.dorms === 'number' && Number.isSafeInteger(r.dorms) && r.dorms >= 0 ? r.dorms : null;
  return { id: r.id, nickname, avatar: dormsUrl(r.avatar), profileUrl: dormsUrl(r.profileUrl), bio: cleanText(r.bio, LIMIT.bio), dorms, tags };
}

/** 응답 전체를 검사해 팩 번호별로 모은다. 모양이 다르면 빈 모음(그러면 화면은 pack.json 값으로 그린다). */
export function parseCreators(raw: unknown): Map<string, Creator> {
  const out = new Map<string, Creator>();
  const list = raw && typeof raw === 'object' ? (raw as { creators?: unknown }).creators : null;
  if (!list || typeof list !== 'object' || Array.isArray(list)) return out;
  for (const [packId, value] of Object.entries(list).slice(0, LIMIT.creators)) {
    if (!PACK_ID.test(packId)) continue;
    const c = parseCreator(value);
    if (c) out.set(packId, c);
  }
  return out;
}

/** 받은 도름은 붙여 쓴다: 12도름, 1,240도름. */
export const dormText = (n: number) => `${n.toLocaleString('en-US')}도름`;

type PackLike = { id: string; creator: { nickname: string } };
/** 같은 사람인지 가르는 열쇠. 도름스가 알려 준 팩은 회원 번호로, 아닌 팩은 pack.json 에 적힌 닉네임으로 본다.
 *  둘을 섞지 않는다: 닉네임이 같다는 것만으로 도름스 회원의 게임으로 묶지 않는다. */
export const creatorKey = (pack: PackLike, c: Creator | null) => (c ? `id:${c.id}` : `nick:${pack.creator.nickname}`);

/** 같은 만든 사람의 팩만 고른다(순서는 받은 그대로). of 는 팩 번호로 도름스 값을 찾는 함수, as 는 target 을 누구로 볼지(기본은 of 로 찾은 값). */
export function packsBy<P extends PackLike>(packs: readonly P[], target: PackLike, of: (packId: string) => Creator | null, as: Creator | null = of(target.id)): P[] {
  const key = creatorKey(target, as);
  return packs.filter(p => creatorKey(p, of(p.id)) === key);
}

// ---------- 받아 두기 ----------
let cache = new Map<string, Creator>(), askedAt = -Infinity, pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

export const creatorOf = (packId: string): Creator | null => cache.get(packId) ?? null;
/** 새 값을 받았을 때 부를 함수를 건다. */
export function onCreators(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

async function fetchCreators(): Promise<Map<string, Creator>> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);   // 도름스가 늦어도 화면이 기다리지 않게
  try {
    const res = await fetch(CREATORS_URL, { credentials: 'omit', mode: 'cors', redirect: 'error', signal: ctl.signal });
    if (!res.ok) throw new Error(`creators ${res.status}`);
    if (Number(res.headers?.get('content-length') ?? 0) > LIMIT.bytes) throw new Error('creators too large');
    const text = await res.text();
    if (text.length > LIMIT.bytes) throw new Error('creators too large');
    return parseCreators(JSON.parse(text));
  } finally { clearTimeout(timer); }
}

/** 받은 지 5분이 지났으면(또는 처음이면) 다시 받는다. 받지 못하면 지난 값을 그대로 두고 5분 뒤에 다시 묻는다. */
export function refreshCreators(now = Date.now()): Promise<void> {
  if (pending) return pending;
  if (now - askedAt < TTL_MS) return Promise.resolve();
  askedAt = now;
  pending = fetchCreators().then(
    next => { cache = next; for (const fn of listeners) fn(); },
    () => { /* 도름스가 답하지 않으면 지금 화면 그대로 */ },
  ).finally(() => { pending = null; });
  return pending;
}

/** 시험에서만: 받아 둔 것을 비운다. */
export function resetCreators() { cache = new Map(); askedAt = -Infinity; pending = null; listeners.clear(); }

/**
 * 요청(PR) 검토 화면에 쓸 팩 읽기. 요청에 든 팩 파일을 GitHub 에서 글로 읽어 운영 판으로 돌린다.
 * 팩은 자료뿐이라(코드 없음) 읽어서 돌려도 안전하다. 요청에 판을 고친 파일이 들어 있어도 그 코드는 여기서 돌지 않는다.
 * 읽은 글은 모두 남이 쓴 것이다: 이름과 크기를 검사하고, 화면에는 글자로만 넣는다.
 */
import { buildPack, type Pack, type PackJson } from '../platform/packs';

export const REPO = 'shinnanchanguk/dorms-world';
const API = 'https://api.github.com/repos/';
const RAW = 'https://raw.githubusercontent.com/';
const MAX_FILE = 300 * 1024, MAX_FILES = 120;
const ALLOWED = /^(pack\.json|DESIGN\.md|stages\/\d{2}\.(json|map\.txt)|sprites\/[a-z0-9-]+\.txt|[a-z0-9-]+\.(png|webp))$/;

export type Review = {
  number: number; title: string; author: string; url: string; state: 'open' | 'merged' | 'closed';
  pack: Pack; design: string;
  others: string[];          // 팩 폴더 밖에서 바뀐 파일(있으면 판 변경이 들어 있다)
  extraPacks: string[];      // 함께 바뀐 다른 팩
};

async function json(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 404) throw new Error('그런 요청이 없어요.');
  if (r.status === 403 || r.status === 429) throw new Error('GitHub 가 잠깐 막았어요(짧은 시간에 너무 많이 열었어요). 조금 뒤에 다시 열어 주세요.');
  if (!r.ok) throw new Error(`요청을 읽지 못했어요(${r.status}).`);
  return r.json();
}
async function text(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`파일을 읽지 못했어요(${r.status}).`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > MAX_FILE) throw new Error('파일이 너무 커요(300KB까지).');
  const body = await r.text();
  if (body.length > MAX_FILE) throw new Error('파일이 너무 커요(300KB까지).');
  return body;
}
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

export async function loadReview(number: number): Promise<Review> {
  if (!Number.isInteger(number) || number < 1 || number > 99999) throw new Error('요청 번호를 확인해 주세요.');
  const pr = await json(`${API}${REPO}/pulls/${number}`) as { changed_files?: unknown; title?: unknown; html_url?: unknown; state?: unknown; merged?: unknown; user?: { login?: unknown }; head?: { sha?: unknown; repo?: { full_name?: unknown } | null } };
  const sha = str(pr.head?.sha, 40), source = str(pr.head?.repo?.full_name, 140);
  if (!/^[0-9a-f]{40}$/.test(sha) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)) throw new Error('요청의 원본 저장소를 찾지 못했어요(지워졌을 수 있어요).');
  const files = await json(`${API}${REPO}/pulls/${number}/files?per_page=100`) as { filename?: unknown; previous_filename?: unknown; status?: unknown }[];
  const list = Array.isArray(files) ? files : [];
  // 지우거나 이름을 바꾼 파일도 '바뀐 파일'로 센다(판 파일을 지우는 요청이 팩만 바꾼 것처럼 보이지 않게)
  const touched = list.flatMap(f => [str(f.filename, 300), str(f.previous_filename, 300)]).filter(Boolean);
  const names = list.filter(f => f.status !== 'removed').map(f => str(f.filename, 300));
  // 바뀐 파일을 다 읽지 못했으면(100개 넘음) '팩만'이라고 말하지 않는다
  const total = Number(pr.changed_files);
  const unread = !Number.isInteger(total) || total !== list.length;
  const ids = [...new Set(names.map(n => /^packs\/([a-z0-9-]+\/[a-z0-9-]+)\//.exec(n)?.[1]).filter((v): v is string => !!v))];
  if (!ids.length) throw new Error('이 요청에는 팩이 없어요. 판만 고친 요청은 세션에서 내려받아 확인해 주세요.');
  const id = ids[0], dir = `packs/${id}/`;
  // 그 팩의 모든 파일(바뀌지 않은 파일 포함)을 요청의 그 시점에서 읽는다
  const tree = await json(`${API}${source}/git/trees/${sha}?recursive=1`) as { tree?: { path?: unknown; type?: unknown; size?: unknown }[] };
  const inPack = (tree.tree ?? []).filter(t => t.type === 'blob' && str(t.path, 300).startsWith(dir)).map(t => ({ rel: str(t.path, 300).slice(dir.length), size: Number(t.size) || 0 }));
  if (inPack.length > MAX_FILES) throw new Error('팩에 파일이 너무 많아요.');
  const stray = inPack.filter(f => !ALLOWED.test(f.rel)).map(f => f.rel);
  if (stray.length) throw new Error(`팩에 둘 수 없는 파일이 있어요: ${stray.slice(0, 3).join(', ')}`);
  const raw = (rel: string) => `${RAW}${source}/${sha}/${dir}${rel}`;
  const store = new Map<string, string>();
  await Promise.all(inPack.filter(f => /\.(json|txt|md)$/.test(f.rel)).map(async f => { if (f.size > MAX_FILE) throw new Error(`${f.rel}: 파일이 너무 커요.`); store.set(f.rel, await text(raw(f.rel))); }));
  let meta: PackJson;
  try { meta = JSON.parse(store.get('pack.json') ?? ''); } catch { throw new Error('pack.json 을 읽을 수 없어요.'); }
  const avatar = typeof meta?.creator?.avatar === 'string' && /^[a-z0-9-]+\.(png|webp)$/.test(meta.creator.avatar) && inPack.some(f => f.rel === meta.creator.avatar) ? raw(meta.creator.avatar) : null;
  const sprites = inPack.map(f => /^sprites\/([a-z0-9-]+)\.txt$/.exec(f.rel)?.[1]).filter((v): v is string => !!v);
  const pack = buildPack(meta, rel => store.get(rel), avatar, sprites);
  return {
    number, title: str(pr.title, 120), author: str(pr.user?.login, 40), url: `https://github.com/${REPO}/pull/${number}`,
    state: pr.merged === true ? 'merged' : pr.state === 'open' ? 'open' : 'closed',
    pack: { ...pack, id }, design: (store.get('DESIGN.md') ?? '').slice(0, 20000),
    others: [...(unread ? ['(바뀐 파일이 많아 다 읽지 못했어요. 세션에서 내려받아 확인해 주세요)'] : []), ...new Set(touched.filter(n => !n.startsWith('packs/')))].slice(0, 40), extraPacks: ids.slice(1),
  };
}

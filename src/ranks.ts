/**
 * 팩 화면의 순위 줄. 선생님 방에서 '순위에 올리기'를 켜고 깬 기록을 도름스가 모아 두고, 여기서는 읽어 보여 주기만 한다.
 * 스테이지마다 빠른 순 10개: 등수, 방 제목, 걸린 시간, 인원, 선생님 닉네임.
 * 방 제목과 닉네임은 남이 쓴 글이다: 한 줄 글로 다듬고 esc 를 거쳐 넣는다. 읽지 못하면 줄을 그리지 않는다.
 */
import '../platform/ui/teacher.css';
import { icon } from '../platform/icons';
import type { Pack } from '../platform/packs';
import { MAX_SEATS, RANK, cleanLine, cleanTitle } from '../platform/room-rules';
import { esc, mmss } from '../platform/text';

export type RankRow = { title: string; ms: number; players: number; teacher: string; at: string };
const RANKS_URL = 'https://dorms.school/api/world/ranks';
const TOP = 10;

const whole = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** 도름스가 준 순위를 검사해 스테이지 번호마다의 줄로 돌려준다. 모양이 어긋난 줄은 버리고, 통째로 어긋나면 null. */
export function readRanks(x: unknown, stages: number): RankRow[][] | null {
  const all = x && typeof x === 'object' ? (x as { stages?: unknown }).stages : null;
  if (!all || typeof all !== 'object') return null;
  const out: RankRow[][] = [];
  for (let i = 0; i < stages; i++) {
    const raw = (all as Record<string, unknown>)[String(i)];
    const rows: RankRow[] = [];
    for (const r of Array.isArray(raw) ? raw.slice(0, 50) : []) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>, title = cleanTitle(o.title), teacher = cleanLine(o.teacher, 40);
      if (!title || !whole(o.ms, RANK.min, RANK.max) || !whole(o.players, 1, MAX_SEATS)) continue;
      rows.push({ title, ms: o.ms, players: o.players, teacher, at: typeof o.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.at) ? o.at : '' });
    }
    out.push(rows.sort((a, b) => a.ms - b.ms).slice(0, TOP));
  }
  return out;
}

export async function loadRanks(p: Pack, fetcher: typeof fetch = fetch): Promise<RankRow[][] | null> {
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetcher(`${RANKS_URL}?pack=${encodeURIComponent(p.id)}`, { signal: ctl.signal, credentials: 'omit' });
    clearTimeout(timer);
    return res.ok ? readRanks(await res.json(), p.stages.length) : null;
  } catch { return null; }
}

const rowHtml = (r: RankRow, i: number) => `<div class="ar-row w-rank"><span class="ar-count w-rank-no" aria-label="${i + 1}번째">${i + 1}</span><span class="w-rank-text"><b class="w-rank-title">${esc(r.title)}</b>${r.teacher ? `<span class="w-rank-by">@${esc(r.teacher)}</span>` : ''}</span><span class="ar-mono w-rank-time">${mmss(r.ms)}</span><span class="ar-count w-people">${icon('users', 14)}<span><span class="lab-num">${r.players}</span>명</span></span></div>`;

/** 팩 화면이 그려진 뒤: 스테이지 목록 아래에 순위 줄을 단다. 도름스가 답하지 않으면 아무것도 달지 않는다. */
export function mountRanks(app: HTMLElement, p: Pack) {
  const at = app.querySelector('.w-keys') ?? app.querySelector('.w-stages');
  if (!at) return;
  void loadRanks(p).then(ranks => {
    if (!ranks || !at.isConnected) return;
    const el = document.createElement('section');
    el.className = 'w-ranks'; el.setAttribute('aria-label', '순위');
    // 처음에는 기록이 있는 첫 스테이지를 보여 준다(없으면 첫 스테이지)
    let si = Math.max(0, ranks.findIndex(r => r.length > 0));
    const paint = () => {
      el.innerHTML = `<p class="ar-kicker w-kicker" id="w-rank-k">순위</p>
        <div class="ar-view-tabs w-rank-tabs" role="group" aria-labelledby="w-rank-k">${p.stages.map((s, i) => `<button class="ar-key ghost" data-rank-stage="${i}" aria-pressed="${i === si}" aria-label="${String(i + 1).padStart(2, '0')} ${esc(s.name)} 순위 보기">${String(i + 1).padStart(2, '0')}</button>`).join('')}</div>
        <p class="ar-sub w-rank-say">${String(si + 1).padStart(2, '0')} ${esc(p.stages[si].name)}. 선생님 방에서 다 함께 깬 시간이에요.</p>
        ${ranks[si].length ? `<div class="lab-roster w-rank-list">${ranks[si].map(rowHtml).join('')}</div>` : '<p class="w-public-none w-rank-none">아직 기록이 없어요.</p>'}`;
      el.querySelectorAll<HTMLButtonElement>('[data-rank-stage]').forEach(b => b.onclick = () => { si = Number(b.dataset.rankStage); paint(); el.querySelector<HTMLElement>(`[data-rank-stage="${si}"]`)?.focus(); });
    };
    paint();
    at.after(el);
  });
}

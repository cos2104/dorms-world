/**
 * 그래프 장치의 요약(방장 → 손님). sync.ts 가 Wire 의 g 칸으로 싣는다.
 * 받은 요약은 남이 보낸 것이라 모양과 범위를 검사하고, 식은 손님 기기가 다시 읽는다(readFormula → makeShape).
 * 화면에 뜨는 판 알림은 글이 아니라 RNOTE_LIST 의 번호로만 간다.
 */
import { LATEX_MAX } from './expr';
import { BODY_MAX, PIECE_MAX, RNOTE_LIST, makeShape, type Body, type GraphStage, type GraphWorld, type Kind, type Piece } from './model';

const KINDS: Kind[] = ['blue', 'red', 'rain', 'bee', 'sled'];
const STATES: Piece['state'][] = ['held', 'free', 'fall', 'planted', 'fixed'];
const B = 7;   // 몸 하나가 차지하는 칸 수: 종류, x, y, vx, vy, t, 튕김

export type GWire = {
  p: [number, number, string, number, number, number, number, number, number, number, number, number[]][];   // id, 공장, 식, a, b, x0, 상태, x, y, vy, 거치대·쏟는 중, 든 사람
  b: number[];
  f: [string, number][];       // 공장마다: 지금 식, 찍은 수
  r: number[];                 // 판: 켜짐, 시간, 점수, 알림 번호, 알림 시간, 그리고 꽃 체력·샌 물(목표마다 두 칸), 나올 때까지 남은 시간(나오는 곳마다)
  d: number[];                 // 이룬 목표(1/0), 그 뒤 홈마다 맞춘 시간
  k: number[];                 // 양동이: x, y, vy, 든 사람, 물. 없으면 빈 목록
  s: number[];                 // 썰매: x, y, vx, vy, 달림, 탄 사람, 시간, 멈춘 시간, 켠 표적, 땅에 닿음. 없으면 빈 목록
  n: number;                   // 난수 씨앗
  i: number;                   // 다음 조각 번호
};

const r1 = (v: number) => Math.round(v * 10) / 10, r2 = (v: number) => Math.round(v * 100) / 100;

export function graphToWire(g: GraphWorld): GWire {
  return {
    p: g.pieces.map(pc => [pc.id, pc.fac, pc.spec.latex, pc.spec.a, pc.spec.b, pc.spec.x0, STATES.indexOf(pc.state), r1(pc.x), r1(pc.y), Math.round(pc.vy), pc.stand + 1 + (pc.ignore > 0 ? 100 : 0), pc.holders.slice(0, 30)]),
    b: g.bodies.flatMap(b => [KINDS.indexOf(b.k), r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy), r2(b.t), b.bounced ? 1 : 0]),
    f: g.factories.map(f => [f.latex, f.made]),
    r: [g.round.on ? 1 : 0, r2(g.round.t), g.round.score, g.round.noteT > 0 ? RNOTE_LIST.indexOf(g.round.note) + 1 : 0, r2(Math.max(0, g.round.noteT)), ...g.round.hp.flatMap((h, i) => [h, g.round.leaks[i]]), ...g.round.spawnT.map(r2)],
    d: [...g.done.map(x => (x ? 1 : 0)), ...g.fit.map(r2)],
    k: g.bucket ? [r1(g.bucket.x), r1(g.bucket.y), Math.round(g.bucket.vy), g.bucket.holder, g.bucket.water] : [],
    s: g.sled ? [r1(g.sled.x), r1(g.sled.y), Math.round(g.sled.vx), Math.round(g.sled.vy), g.sled.run ? 1 : 0, g.sled.rider, r2(g.sled.t), r2(g.sled.still), g.sled.lit, g.sled.grounded ? 1 : 0] : [],
    n: g.seed, i: g.nextId,
  };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const whole = (v: unknown, lo: number, hi: number): v is number => num(v) && Number.isInteger(v) && v >= lo && v <= hi;
const nums = (v: unknown, max: number): v is number[] => Array.isArray(v) && v.length <= max && v.every(num);

/** 모양만 본다(스테이지와 맞는지는 applyGraphWire 가 본다). */
export function readGWire(x: unknown): GWire | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.p) || o.p.length > PIECE_MAX) return null;
  for (const p of o.p) {
    if (!Array.isArray(p) || p.length !== 12 || typeof p[2] !== 'string' || p[2].length > LATEX_MAX) return null;
    if (!whole(p[0], 0, 1e9) || !whole(p[1], 0, 7) || !whole(p[6], 0, STATES.length - 1) || !whole(p[10], 0, 200)) return null;
    if (![p[3], p[4], p[5], p[7], p[8], p[9]].every(num) || !nums(p[11], 30) || !p[11].every((h: number) => whole(h, 0, 29))) return null;
  }
  if (!nums(o.b, BODY_MAX * B) || o.b.length % B) return null;
  for (let i = 0; i < o.b.length; i += B) if (!whole(o.b[i], 0, KINDS.length - 1)) return null;
  if (!Array.isArray(o.f) || o.f.length > 4 || !o.f.every(f => Array.isArray(f) && f.length === 2 && typeof f[0] === 'string' && f[0].length <= LATEX_MAX && whole(f[1], 0, 1e9))) return null;
  if (!nums(o.r, 5 + 2 * 40 + 40) || o.r.length < 5 || !nums(o.d, 80) || !nums(o.k, 5) || !nums(o.s, 10) || !whole(o.n, 1, 2 ** 32) || !whole(o.i, 1, 1e9)) return null;
  return o as unknown as GWire;
}

/** 손님: 요약을 덮어쓴다. 스테이지와 칸 수가 안 맞으면 false. */
export function applyGraphWire(gs: GraphStage, g: GraphWorld, wire: GWire, players: number, sw: number, sh: number): boolean {
  const nGoals = gs.goals.length, nSpawn = gs.drops.length + gs.hives.length;
  if (wire.f.length !== gs.factories.length || wire.r.length !== 5 + 2 * nGoals + nSpawn || wire.d.length !== g.done.length + gs.slots.length) return false;
  if (wire.k.length !== (gs.bucket ? 5 : 0) || wire.s.length !== (gs.sled ? 10 : 0)) return false;
  const inX = (v: number) => Math.max(-200, Math.min(sw + 200, v)), inY = (v: number) => Math.max(-600, Math.min(sh + 200, v));
  const who = (v: number) => (Number.isInteger(v) && v >= 0 && v < players ? v : -1);
  const pieces: Piece[] = [];
  for (const p of wire.p) {
    if (p[1] >= gs.factories.length) continue;
    const spec = { latex: p[2], a: p[3], b: p[4], x0: p[5] };
    const old = g.pieces.find(q => q.id === p[0] && q.spec.latex === spec.latex && q.spec.a === spec.a && q.spec.b === spec.b && q.spec.x0 === spec.x0);
    const shape = old?.shape ?? makeShape(spec);
    if (typeof shape === 'string') continue;                  // 이 기기에서 읽지 못한 식(판이 다름)은 그리지 않는다
    const stand = (p[10] % 100) - 1;
    pieces.push({ id: p[0], fac: p[1], spec, shape, state: STATES[p[6]], x: inX(p[7]), y: inY(p[8]), vy: Math.max(-1000, Math.min(1000, p[9])), stand: stand >= 0 && stand < gs.stands.length ? stand : -1, ignore: p[10] >= 100 ? 0.3 : 0, holders: p[11].map(who).filter(h => h >= 0) });
  }
  g.pieces = pieces;
  const bodies: Body[] = [];
  for (let i = 0; i < wire.b.length; i += B) bodies.push({ k: KINDS[wire.b[i]], x: inX(wire.b[i + 1]), y: inY(wire.b[i + 2]), vx: wire.b[i + 3], vy: wire.b[i + 4], r: KINDS[wire.b[i]] === 'rain' ? 4 : KINDS[wire.b[i]] === 'bee' ? 7 : 8, t: Math.max(0, wire.b[i + 5]), hit: -1, bounced: !!wire.b[i + 6] });
  g.bodies = bodies;
  wire.f.forEach(([latex, made], i) => { g.factories[i].latex = latex; g.factories[i].made = made; });
  const r = wire.r, rd = g.round;
  rd.on = !!r[0]; rd.t = Math.max(0, r[1]); rd.score = Math.max(0, r[2] | 0);
  rd.note = r[3] > 0 ? RNOTE_LIST[r[3] - 1] ?? '' : ''; rd.noteT = rd.note ? Math.max(0, Math.min(5, r[4])) : 0;
  for (let k = 0; k < nGoals; k++) { rd.hp[k] = Math.max(0, r[5 + 2 * k] | 0); rd.leaks[k] = Math.max(0, r[6 + 2 * k] | 0); }
  for (let k = 0; k < nSpawn; k++) rd.spawnT[k] = Math.max(0, r[5 + 2 * nGoals + k]);
  g.done = g.done.map((_, i) => !!wire.d[i]);
  g.fit = g.fit.map((_, i) => Math.max(0, wire.d[g.done.length + i]));
  if (g.bucket && wire.k.length) { const k = wire.k; Object.assign(g.bucket, { x: inX(k[0]), y: inY(k[1]), vy: k[2], holder: who(k[3]), water: Math.max(0, Math.min(99, k[4] | 0)) }); }
  if (g.sled && wire.s.length) { const s = wire.s; Object.assign(g.sled, { x: inX(s[0]), y: inY(s[1]), vx: s[2], vy: s[3], run: !!s[4], rider: who(s[5]), t: Math.max(0, s[6]), still: Math.max(0, s[7]), lit: Math.max(0, Math.min(9, s[8] | 0)), grounded: !!s[9] }); }
  g.seed = wire.n >>> 0 || 1; g.nextId = wire.i;
  return true;
}

/**
 * 그래프 공장 장치. 판(sim.ts)이 부르는 순수 계산만 둔다(화면·연결을 모른다).
 *
 * 흐름: 찍는 방(press)에서 식을 넣고, 손잡이 방(desk)에서 지나는 점과 x 범위를 넣으면 출구(out)에 그래프 조각이 찍혀 나온다.
 * 조각에는 손잡이가 하나 달린다. 손잡이는 지나는 점에서 접선과 수직인 방향으로 붙고, 도름이는 손잡이를 늘 세워 든다.
 * 그래서 조각 전체가 그 점의 접선이 수평이 되도록 돌아간다(형 결정 2026-11-23, B안).
 *
 * 좌표: 수학 1 = 한 칸(30px). 조각의 모양은 손잡이 끝(잡는 곳)을 (0, 0) 으로 둔 판 점(px, 아래가 +y)으로 들고 있다.
 * 남이 보낸 식·값은 모두 여기서 다시 검사한다(readFormula, 범위).
 */
import { readFormula, sampleRuns, slopeAt, canonLatex, LATEX_MAX, type Formula } from './expr';

export const T = 30;
export const HANDLE = 26;                  // 손잡이 길이(px)
export const RANGE_MAX = 16;               // x 범위 너비의 상한(칸)
export const EXTENT_MAX = 22;              // 돌린 뒤 조각이 차지하는 가로·세로의 상한(칸)
export const PIECE_MAX = 10;               // 한 스테이지에 있을 수 있는 조각 수
export const BODY_MAX = 90;                // 한 번에 날아다닐 수 있는 공·물방울·벌 수
export const BUCKET_CAP = 8;
const G_BODY = 900;

export type Kind = 'blue' | 'red' | 'rain' | 'bee' | 'sled';
export type Rect = { x: number; y: number; w: number; h: number };

// ---------- 스테이지에 놓이는 것(stage.ts 가 읽어 채운다) ----------
export type FactoryDef = { name: string; press: Rect[]; desk: Rect[]; out: Rect; max: number };
export type DropDef = Rect & { kind: 'blue' | 'red' | 'mix' | 'rain'; every: [number, number]; spread: number; red: number };
export type HiveDef = Rect & { every: [number, number]; speed: number };
export type GoalDef =
  | { kind: 'basket'; ch: string; rect: Rect; need: number; opens: string[] }
  | { kind: 'flower'; ch: string; rect: Rect; hp: number; hold: number; opens: string[] }
  | { kind: 'leak'; ch: string; rects: Rect[]; max: number; hold: number; opens: string[] };
export type SledDef = { x: number; y: number; opens: string[] };
export type TargetDef = Rect & { order: number };
export type SlotDef = { ch: string; latex: string; a: number; b: number; ox: number; oy: number; tol: number; opens: string[]; pts: [number, number][] };
export type GraphStage = {
  factories: FactoryDef[];
  stands: Rect[];
  bells: Rect[];
  drops: DropDef[];
  hives: HiveDef[];
  goals: GoalDef[];
  bucket: { x: number; y: number } | null;
  drains: Rect[];
  sled: SledDef | null;
  targets: TargetDef[];
  slots: SlotDef[];
};
export const emptyGraphStage = (): GraphStage => ({ factories: [], stands: [], bells: [], drops: [], hives: [], goals: [], bucket: null, drains: [], sled: null, targets: [], slots: [] });
export const hasGraph = (g: GraphStage) => g.factories.length > 0;

// ---------- 조각의 모양 ----------
export type Shape = {
  runs: [number, number][][];   // 잡는 곳 기준 판 점
  need: number;                  // 혼자서도 들지만, 이만큼 모여야 제 빠르기로 걷는다
  arc: number;                   // 곡선 길이(칸)
  box: Rect;                     // 잡는 곳 기준 테두리
};
export type PieceSpec = { latex: string; a: number; b: number; x0: number };

const shapeCache = new Map<string, Shape | string>();
/**
 * 식·범위·손잡이 점으로 조각의 모양을 만든다. 안 되면 까닭(쉬운 말)을 돌려준다.
 * 방장과 손님이 같은 값으로 같은 모양을 얻는다(같은 식 → 같은 점).
 */
export function makeShape(spec: PieceSpec): Shape | string {
  const key = `${spec.latex}|${spec.a}|${spec.b}|${spec.x0}`;
  const hit = shapeCache.get(key); if (hit) return hit;
  const out = buildShape(spec);
  if (shapeCache.size > 400) shapeCache.clear();
  shapeCache.set(key, out);
  return out;
}

function buildShape({ latex, a, b, x0 }: PieceSpec): Shape | string {
  const r = readFormula(latex);
  if (!r.ok) return r.reason;
  const bad = rangeProblem(a, b, x0);
  if (bad) return bad;
  const f = r.formula, y0 = f.f(x0), m = slopeAt(f, x0);
  if (!Number.isFinite(y0) || !Number.isFinite(m)) return `x = ${fmt(x0)} 에서는 그래프가 끊겨 있어서 손잡이를 달 수 없어요`;
  const runsMath = sampleRuns(f, a, b, Math.max(0.04, (b - a) / 240));
  const th = Math.atan(m), cs = Math.cos(th), sn = Math.sin(th);
  let arc = 0;
  const runs: [number, number][][] = [];
  let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
  for (const run of runsMath) {
    const out: [number, number][] = [];
    for (const [x, y] of run) {
      const dx = x - x0, dy = y - y0;
      // 접선이 수평이 되게 -th 만큼 돌린다(수학 좌표) → 판 점(아래가 +y), 손잡이 위 끝이 (0, -HANDLE)
      const rx = dx * cs + dy * sn, ry = -dx * sn + dy * cs;
      const px = rx * T, py = -ry * T - HANDLE;
      if (out.length) { const [qx, qy] = out[out.length - 1]; arc += Math.hypot(px - qx, py - qy) / T; }
      out.push([px, py]);
      x1 = Math.min(x1, px); x2 = Math.max(x2, px); y1 = Math.min(y1, py); y2 = Math.max(y2, py);
    }
    if (out.length > 1) runs.push(out);
  }
  if (!runs.length) return '이 범위에서는 그래프가 그려지지 않아요';
  y2 = Math.max(y2, 0);
  if ((x2 - x1) / T > EXTENT_MAX || (y2 - y1) / T > EXTENT_MAX) return `그래프가 너무 커요. 가로·세로 ${EXTENT_MAX}칸 안에 들어오게 범위를 줄여 주세요`;
  return { runs, arc, need: Math.max(1, Math.min(6, Math.ceil(arc / 5))), box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } };
}

export const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(+v.toFixed(2)));

export function rangeProblem(a: number, b: number, x0: number): string | null {
  if (![a, b, x0].every(Number.isFinite)) return '수를 모두 적어 주세요';
  if ([a, b, x0].some(v => Math.abs(v) > 50)) return '수는 -50 부터 50 사이로 적어 주세요';
  if (b <= a) return 'x 범위는 작은 수부터 적어 주세요';
  if (b - a > RANGE_MAX) return `x 범위는 ${RANGE_MAX}칸까지예요`;
  if (b - a < 0.5) return 'x 범위가 너무 좁아요';
  if (x0 < a || x0 > b) return '지나는 점은 x 범위 안에 있어야 해요';
  return null;
}

/** 손잡이 방에서 넣은 점이 그래프 위에 있는가. 있으면 null. */
export function pointProblem(f: Formula, x0: number, y0: number): string | null {
  const v = f.f(x0);
  if (!Number.isFinite(v)) return `x = ${fmt(x0)} 에서는 그래프가 끊겨 있어요`;
  if (!Number.isFinite(y0) || Math.abs(v - y0) > Math.max(0.05, Math.abs(v) * 0.01)) return `점 (${fmt(x0)}, ${fmt(y0)}) 은 이 그래프 위에 있지 않아요`;
  return null;
}

// ---------- 세계 상태 ----------
export type Piece = {
  id: number;
  fac: number;
  spec: PieceSpec;
  shape: Shape;
  x: number; y: number;           // 잡는 곳(판 점)
  vy: number;
  state: 'held' | 'free' | 'fall' | 'planted' | 'fixed';
  holders: number[];               // 든 사람(맨 앞이 앞장선 사람)
  stand: number;                   // 꽂힌 거치대(-1 없음)
  ignore: number;                  // 쏟는 중: 이 시간 동안 공이 이 조각에 안 걸린다
};
export type Body = { k: Kind; x: number; y: number; vx: number; vy: number; r: number; t: number; hit: number; bounced: boolean; skip?: number };
export type Factory = { latex: string; note: string; noteT: number; made: number };
export type Round = { on: boolean; t: number; score: number; hp: number[]; leaks: number[]; note: string; noteT: number; spawnT: number[] };
export type SledState = { x: number; y: number; vx: number; vy: number; on: boolean; run: boolean; rider: number; t: number; still: number; lit: number; grounded: boolean };
export type GraphWorld = {
  pieces: Piece[];
  nextId: number;
  bodies: Body[];
  factories: Factory[];
  round: Round;
  done: boolean[];                 // 목표마다 이룸(goals, 그 뒤 slots, 그 뒤 sled 하나)
  fit: number[];                   // 홈마다 맞춰 둔 시간
  bucket: { x: number; y: number; vy: number; holder: number; water: number } | null;
  sled: SledState | null;
  seed: number;
};

export function createGraph(gs: GraphStage, seed: number): GraphWorld {
  return {
    pieces: [], nextId: 1, bodies: [],
    factories: gs.factories.map(() => ({ latex: '', note: '', noteT: 0, made: 0 })),
    round: newRound(gs),
    done: [...gs.goals.map(() => false), ...gs.slots.map(() => false), ...(gs.sled ? [false] : [])],
    fit: gs.slots.map(() => 0),
    bucket: gs.bucket ? { x: gs.bucket.x, y: gs.bucket.y, vy: 0, holder: -1, water: 0 } : null,
    sled: gs.sled ? sledHome(gs.sled) : null,
    seed: (seed >>> 0) || 1,
  };
}
const newRound = (gs: GraphStage): Round => ({
  on: !gs.bells.length && (gs.drops.length > 0 || gs.hives.length > 0), t: 0, score: 0,
  hp: gs.goals.map(g => (g.kind === 'flower' ? g.hp : 0)), leaks: gs.goals.map(() => 0), note: '', noteT: 0,
  spawnT: [...gs.drops.map(() => 0.6), ...gs.hives.map(() => 1.2)],
});
const sledHome = (d: SledDef): SledState => ({ x: d.x, y: d.y, vx: 0, vy: 0, on: true, run: false, rider: -1, t: 0, still: 0, lit: 0, grounded: true });

/** 결정적인 난수(방장만 굴리지만, 시험에서 같은 결과가 나오게). */
function rand(g: GraphWorld) { let s = g.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; g.seed = s >>> 0 || 1; return (g.seed % 100000) / 100000; }
const between = (g: GraphWorld, [lo, hi]: [number, number]) => lo + (hi - lo) * rand(g);

// ---------- 주문(찍는 방·손잡이 방에서 넣은 것) ----------
export { cleanOrder, type Order } from './order';
import type { Order } from './order';

/** 판 알림 글(요약에는 글이 아니라 이 목록의 번호가 간다: 다른 기기가 아무 글이나 띄우지 못하게). */
export const RNOTE = {
  sled: '썰매가 멈췄어요. 다시 출발해 봐요', red: '빨간 공이 들어가서 두 개가 빠졌어요',
  flower: '꽃이 벌에게 다 쏘였어요. 종을 쳐서 다시 해 봐요', leak: '집에 물이 너무 많이 샜어요. 종을 쳐서 다시 해 봐요',
} as const;
export const RNOTE_LIST: readonly string[] = Object.values(RNOTE);

export const FNOTE = {
  noFormula: '찍는 방에서 식을 먼저 넣어 주세요', made: '그래프를 찍었어요. 출구에 나왔어요', set: '식을 넣었어요. 손잡이 방에서 점과 범위를 정해 주세요',
  far: '방 안에 서서 넣어 주세요', full: '찍은 그래프가 너무 많아요. 안 쓰는 것을 출구에 두면 새것으로 바뀌어요',
} as const;

/**
 * 주문을 받는다. who 는 넣은 도름이(그 방 가까이 서 있어야 한다). 돌려주는 글은 그 사람 화면의 알림.
 * near: 그 도름이가 그 공장의 방(press/desk)에 서 있는지 판이 판단해 넘긴다.
 */
export function applyOrder(gs: GraphStage, g: GraphWorld, order: Order, near: boolean): string {
  const fd = gs.factories[order.fac], fs = g.factories[order.fac];
  if (!fd || !fs) return '';
  const say = (t: string) => { fs.note = t; fs.noteT = 3; return t; };
  if (!near) return say(FNOTE.far);
  if (order.k === 'f') {
    const r = readFormula(order.latex);
    if (!r.ok) return say(r.reason);
    fs.latex = canonLatex(r.formula);
    return say(FNOTE.set);
  }
  if (!fs.latex) return say(FNOTE.noFormula);
  const r = readFormula(fs.latex);
  if (!r.ok) return say(r.reason);
  const p1 = rangeProblem(order.a, order.b, order.x0) ?? pointProblem(r.formula, order.x0, order.y0);
  if (p1) return say(p1);
  const spec: PieceSpec = { latex: fs.latex, a: round3(order.a), b: round3(order.b), x0: round3(order.x0) };
  const shape = makeShape(spec);
  if (typeof shape === 'string') return say(shape);
  // 출구에 나온 지 오래된 것부터 치운다(들고 있거나 꽂거나 맞춘 것은 그대로)
  const mine = g.pieces.filter(p => p.fac === order.fac);
  if (mine.length >= fd.max || g.pieces.length >= PIECE_MAX) {
    const old = mine.find(p => p.state === 'free' || p.state === 'fall');
    if (!old) return say(FNOTE.full);
    g.pieces.splice(g.pieces.indexOf(old), 1);
  }
  const out = fd.out;
  const piece: Piece = { id: g.nextId++, fac: order.fac, spec, shape, x: out.x + out.w / 2 - (shape.box.x + shape.box.w / 2), y: out.y - shape.box.y - shape.box.h - 4, vy: 0, state: 'fall', holders: [], stand: -1, ignore: 0 };
  // 출구 위로 띄워 내려앉게 한다(출구 칸의 바닥에 닿을 때까지)
  piece.y = Math.min(piece.y, out.y + out.h - (shape.box.y + shape.box.h)) - 2;
  g.pieces.push(piece);
  fs.made++;
  return say(FNOTE.made);
}
const round3 = (v: number) => Math.round(v * 1000) / 1000;

// ---------- 조각을 판 위 선분으로 ----------
export type Seg = { x1: number; y1: number; x2: number; y2: number; pi: number };
export function pieceSegs(p: Piece, pi: number, out: Seg[]) {
  for (const run of p.shape.runs) for (let i = 1; i < run.length; i++) out.push({ x1: p.x + run[i - 1][0], y1: p.y + run[i - 1][1], x2: p.x + run[i][0], y2: p.y + run[i][1], pi });
}
export const pieceBox = (p: Piece): Rect => ({ x: p.x + p.shape.box.x, y: p.y + p.shape.box.y, w: p.shape.box.w, h: p.shape.box.h });

/** 곡선의 x 자리 높이들(판 점). 그 x 를 지나는 선분마다 하나씩. */
export function curveYs(p: Piece, x: number): number[] {
  const out: number[] = [];
  for (const run of p.shape.runs) for (let i = 1; i < run.length; i++) {
    const ax = p.x + run[i - 1][0], bx = p.x + run[i][0];
    if ((x < ax && x < bx) || (x > ax && x > bx) || ax === bx) continue;
    const t = (x - ax) / (bx - ax);
    out.push(p.y + run[i - 1][1] + (run[i][1] - run[i - 1][1]) * t);
  }
  return out;
}

/** 딛고 설 수 있는 조각인가(들고 있거나 떨어지는 중이면 발판이 아니다). */
export const standOn = (p: Piece) => p.state === 'free' || p.state === 'planted' || p.state === 'fixed';

/**
 * 도름이 발밑의 곡선: [x0, x1] 사이(세 점)에서 yTop 과 yBottom 사이에 있는 가장 높은 곡선 높이. 없으면 null.
 * 곡선은 위에서만 딛는다(밑에서 뛰어 지나갈 수 있다).
 */
export function surfaceBelow(g: GraphWorld, x0: number, x1: number, yTop: number, yBottom: number): number | null {
  let best: number | null = null;
  for (const p of g.pieces) {
    if (!standOn(p)) continue;
    const bx = pieceBox(p);
    if (x1 < bx.x || x0 > bx.x + bx.w || yBottom < bx.y - 2 || yTop > bx.y + bx.h + 2) continue;
    for (const x of [x0, (x0 + x1) / 2, x1]) for (const y of curveYs(p, x)) if (y >= yTop && y <= yBottom && (best == null || y < best)) best = y;
  }
  return best;
}

// ---------- 한 걸음 ----------
/** 판이 넘겨주는 것(순환 참조를 피하려고 필요한 것만). */
export type Host = {
  stageW: number; stageH: number;
  solidAt: (x: number, y: number) => boolean;          // 판 점이 땅(또는 켜진 다리) 안인가
  players: { i: number; x: number; y: number; w: number; h: number; inDoor: boolean; on: boolean; stun: number; aNew: boolean; jumpNew: boolean }[];
  need: (n: number) => number;                            // 방 인원으로 푼 필요 인원
};

const near = (a: Rect, x: number, y: number, pad: number) => x > a.x - pad && x < a.x + a.w + pad && y > a.y - pad && y < a.y + a.h + pad;
const headOf = (p: Host['players'][number]) => ({ x: p.x + p.w / 2, y: p.y - 3 });

export type GAction =
  | { do: 'press' | 'desk'; fac: number }
  | { do: 'grab'; piece: number }
  | { do: 'drop' | 'plant' | 'pour'; piece: number }
  | { do: 'bucket-take' | 'bucket-drop' | 'bucket-empty' }
  | { do: 'bell' | 'sled' }
  | { do: 'nothing'; why: string };

export function holdingPiece(g: GraphWorld, pi: number) { return g.pieces.findIndex(p => p.state === 'held' && p.holders.includes(pi)); }

/** 지금 자리에서 확인을 누르면 일어날 일(그래프 장치만). 화면 안내 글과 실제 동작이 같은 판단을 쓴다. */
export function graphActionAt(gs: GraphStage, g: GraphWorld, h: Host, pi: number): GAction | null {
  const p = h.players[pi];
  if (!p || p.inDoor) return null;
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  const held = holdingPiece(g, pi);
  if (held >= 0) {
    const pc = g.pieces[held];
    if (pc.holders[0] !== pi) return { do: 'drop', piece: held };   // 함께 든 사람은 손을 놓는다
    for (const st of gs.stands) if (near(st, cx, cy, 18) && !g.pieces.some(q => q.state === 'planted' && q.stand === gs.stands.indexOf(st))) return { do: 'plant', piece: held };
    for (const go of gs.goals) if (go.kind === 'basket' && Math.abs(go.rect.x + go.rect.w / 2 - cx) < go.rect.w / 2 + 40) return { do: 'pour', piece: held };
    return { do: 'drop', piece: held };
  }
  const b = g.bucket;
  if (b && b.holder === pi) {
    for (const d of gs.drains) if (near(d, cx, cy, 16)) return { do: 'bucket-empty' };
    return { do: 'bucket-drop' };
  }
  // 손잡이 끝이 머리 가까이 있는 조각
  let best = -1, bd = 34;
  g.pieces.forEach((pc, i) => {
    if (pc.state === 'fixed' || pc.state === 'fall') return;
    if (pc.state === 'held' && pc.holders.length >= 6) return;
    const d = Math.hypot(pc.x - cx, pc.y - (p.y + 4));
    if (d < bd) { bd = d; best = i; }
  });
  if (best >= 0) return { do: 'grab', piece: best };
  if (b && b.holder < 0 && Math.abs(b.x - cx) < 26 && Math.abs(b.y - (p.y + p.h - 10)) < 34) return { do: 'bucket-take' };
  for (const [fi, f] of gs.factories.entries()) {
    if (f.press.some(r => near(r, cx, cy, 10))) return { do: 'press', fac: fi };
    if (f.desk.some(r => near(r, cx, cy, 10))) return { do: 'desk', fac: fi };
  }
  if (gs.bells.some(r => near(r, cx, cy, 12))) return g.round.on ? { do: 'nothing', why: '벌써 시작했어요' } : { do: 'bell' };
  if (gs.sled && g.sled && !g.sled.run && Math.abs(g.sled.x - cx) < 34 && Math.abs(g.sled.y - (p.y + p.h)) < 40) return { do: 'sled' };
  return null;
}

/** 공장 방 가까이 서 있는가(주문을 받을 때 방장이 다시 본다. 조금 떨어져도 받아 준다). */
export function atFactory(gs: GraphStage, h: Host, pi: number, fac: number, which: 'press' | 'desk') {
  const p = h.players[pi], f = gs.factories[fac];
  if (!p || !f) return false;
  return f[which].some(r => near(r, p.x + p.w / 2, p.y + p.h / 2, 46));
}

/** 판이 걸음마다 부른다: 확인 누름 처리 → 조각·양동이 따라가기 → 공·벌·썰매 → 목표. opened 에 켜진 다리 글자를 넣는다. */
export function graphTick(gs: GraphStage, g: GraphWorld, h: Host, dt: number, opened: Set<string>, speedOf: (pi: number) => number) {
  // 1) 확인 누름
  for (const p of h.players) {
    if (!p.aNew || p.inDoor) continue;
    const act = graphActionAt(gs, g, h, p.i);
    if (!act) continue;
    doAction(gs, g, h, p.i, act);
  }
  // 2) 들고 있는 조각: 앞장선 사람의 머리 위. 손이 모자라면 판이 걸음을 늦춘다(speedOf)
  for (const pc of g.pieces) {
    if (pc.state !== 'held') continue;
    pc.holders = pc.holders.filter(i => h.players[i] && !h.players[i].inDoor);
    const lead = h.players[pc.holders[0]];
    if (!lead) { pc.state = 'fall'; pc.holders = []; continue; }
    const hd = headOf(lead);
    pc.x = hd.x; pc.y = hd.y;
    // 함께 든 사람이 멀어지면 손을 놓은 것으로 본다
    pc.holders = pc.holders.filter((i, k) => k === 0 || Math.abs(h.players[i].x - lead.x) < 3 * T);
    if (pc.ignore > 0) pc.ignore -= dt;
  }
  void speedOf;
  // 3) 떨어지는 조각
  for (const pc of [...g.pieces]) if (pc.state === 'fall') fallPiece(gs, g, h, pc, dt);
  // 4) 양동이
  const bk = g.bucket;
  if (bk) {
    if (bk.holder >= 0) {
      const p = h.players[bk.holder];
      if (!p || p.inDoor) bk.holder = -1; else { bk.x = p.x + p.w / 2; bk.y = p.y - 2; bk.vy = 0; }
    }
    if (bk.holder < 0) {
      bk.vy = Math.min(600, bk.vy + G_BODY * dt);
      const ny = bk.y + bk.vy * dt;
      if (h.solidAt(bk.x, ny + 1) || h.solidAt(bk.x - 10, ny + 1) || h.solidAt(bk.x + 10, ny + 1)) { bk.y = Math.floor((ny + 1) / T) * T - 0.5; bk.vy = 0; }
      else bk.y = ny;
      if (bk.y > h.stageH + 60 && gs.bucket) { bk.x = gs.bucket.x; bk.y = gs.bucket.y; bk.vy = 0; bk.water = 0; }
    }
  }
  // 5) 판(round): 종을 쳐야 공·벌이 오고 시간이 흐른다
  const rd = g.round;
  if (rd.noteT > 0) rd.noteT -= dt;
  for (const f of g.factories) if (f.noteT > 0) f.noteT -= dt;
  if (rd.on) {
    rd.t += dt;
    spawn(gs, g, h, dt);
  }
  // 6) 공·물방울·벌
  const segs: Seg[] = [];
  g.pieces.forEach((pc, i) => { if (pc.ignore <= 0 || pc.state !== 'held') pieceSegs(pc, i, segs); });
  moveBodies(gs, g, h, segs, dt);
  // 7) 썰매
  if (gs.sled && g.sled) sledTick(gs, g, h, segs, dt);
  // 8) 목표
  goalsTick(gs, g, h, dt);
  // 9) 홈 맞추기
  slotsTick(gs, g, dt);
  // 10) 이룬 목표가 여는 다리
  const all = allGoals(gs);
  all.forEach((opens, i) => { if (g.done[i]) for (const ch of opens) opened.add(ch); });
}

/** 목표·홈·썰매가 여는 다리 글자(차례는 done 과 같다). */
export const allGoals = (gs: GraphStage): string[][] => [...gs.goals.map(x => x.opens), ...gs.slots.map(x => x.opens), ...(gs.sled ? [gs.sled.opens] : [])];

function doAction(gs: GraphStage, g: GraphWorld, h: Host, pi: number, act: GAction) {
  const p = h.players[pi];
  if (act.do === 'grab') {
    const pc = g.pieces[act.piece];
    if (pc.state === 'held') { if (!pc.holders.includes(pi)) pc.holders.push(pi); return; }
    pc.state = 'held'; pc.holders = [pi]; pc.stand = -1; pc.vy = 0;
  } else if (act.do === 'drop') {
    const pc = g.pieces[act.piece];
    if (pc.holders[0] !== pi) { pc.holders = pc.holders.filter(i => i !== pi); return; }
    pc.state = 'fall'; pc.holders = []; pc.vy = 0;
  } else if (act.do === 'plant') {
    const pc = g.pieces[act.piece], si = gs.stands.findIndex(st => near(st, p.x + p.w / 2, p.y + p.h / 2, 18));
    if (si < 0) return;
    const st = gs.stands[si];
    pc.state = 'planted'; pc.holders = []; pc.stand = si; pc.x = st.x + st.w / 2; pc.y = st.y - 2 * T + 6;
  } else if (act.do === 'pour') {
    g.pieces[act.piece].ignore = 0.7;
  } else if (act.do === 'bucket-take') { if (g.bucket) g.bucket.holder = pi; }
  else if (act.do === 'bucket-drop') { if (g.bucket) { g.bucket.holder = -1; g.bucket.y = p.y + p.h - 1; } }
  else if (act.do === 'bucket-empty') { if (g.bucket) g.bucket.water = 0; }
  else if (act.do === 'bell') {
    const rd = newRound(gs); rd.on = true; g.round = rd;
    g.bodies = g.bodies.filter(b => b.k === 'sled');
  } else if (act.do === 'sled' && g.sled && gs.sled) {
    Object.assign(g.sled, sledHome(gs.sled), { run: true, rider: pi });
  }
}

/** 놓은 조각은 아래로 떨어져 땅이나 다른 조각에 닿으면 멈춘다(돌지 않는다). */
function fallPiece(gs: GraphStage, g: GraphWorld, h: Host, pc: Piece, dt: number) {
  pc.vy = Math.min(700, pc.vy + G_BODY * dt);
  const dy = pc.vy * dt;
  // 떨어지다가 홈을 지나면 그 자리에 쏙 맞물린다(한 걸음에 홈을 건너뛰지 않게 이번 걸음의 거리까지 본다)
  const room = dropRoom(g, h, pc, dy);
  for (const [si, sl] of gs.slots.entries()) {
    const di = gs.goals.length + si;
    if (g.done[di]) continue;
    const off = fitOffset(pc, sl);
    // 이번 걸음에 홈을 지나가거나, 홈 바로 위(한 칸 안)에 걸려 멈추게 되면 홈으로 쏙 들어간다
    if (off != null && off >= -sl.tol * T && (off <= dy + sl.tol * T || (room < dy - 1e-6 && off <= room + T + sl.tol * T))) {
      pc.y += off; pc.state = 'fixed'; pc.vy = 0; g.done[di] = true; return;
    }
  }
  pc.y += room;
  if (room < dy - 1e-6) { pc.state = 'free'; pc.vy = 0; }
  if (pc.y + pc.shape.box.y > h.stageH + 80) g.pieces.splice(g.pieces.indexOf(pc), 1);   // 구덩이로 빠진 조각은 사라진다
}

/** 조각을 아래로 dy 만큼 옮길 때 실제로 갈 수 있는 거리. 곡선 점과 손잡이 끝이 땅이나 다른 조각 위에 닿으면 멈춘다. */
function dropRoom(g: GraphWorld, h: Host, pc: Piece, dy: number): number {
  let room = dy;
  const pts: [number, number][] = [[0, 0]];
  for (const run of pc.shape.runs) for (let i = 0; i < run.length; i += 2) pts.push(run[i]);
  for (const [lx, ly] of pts) {
    const x = pc.x + lx, y = pc.y + ly;
    if (x < 0 || x > h.stageW) continue;
    for (let s = 0; s <= room; s += 3) if (h.solidAt(x, y + s + 1)) { room = Math.max(0, s); break; }
    for (const o of g.pieces) {
      if (o === pc || !standOn(o)) continue;
      for (const oy of curveYs(o, x)) if (oy >= y - 1 && oy - y < room + 1) room = Math.max(0, oy - y - 1);
    }
  }
  return room;
}

function spawn(gs: GraphStage, g: GraphWorld, h: Host, dt: number) {
  const rd = g.round, n = h.players.length;
  const faster = 1 + Math.min(1.5, Math.max(0, n - 2) * 0.08);   // 사람이 많으면 더 자주 온다
  gs.drops.forEach((d, i) => {
    if ((rd.spawnT[i] -= dt * faster) > 0 || g.bodies.length >= BODY_MAX) return;
    rd.spawnT[i] = between(g, d.every);
    const kind: Kind = d.kind === 'mix' ? (rand(g) < d.red ? 'red' : 'blue') : d.kind;
    const x = d.x + d.w / 2 + (rand(g) * 2 - 1) * d.spread * T;
    g.bodies.push({ k: kind, x: Math.max(8, Math.min(h.stageW - 8, x)), y: d.y + 8, vx: 0, vy: kind === 'rain' ? 160 : 40, r: kind === 'rain' ? 4 : 8, t: 0, hit: -1, bounced: false });
  });
  gs.hives.forEach((hv, k) => {
    const i = gs.drops.length + k;
    if ((rd.spawnT[i] -= dt * faster) > 0 || g.bodies.length >= BODY_MAX) return;
    rd.spawnT[i] = between(g, hv.every);
    g.bodies.push({ k: 'bee', x: hv.x + hv.w / 2, y: hv.y + hv.h / 2, vx: 0, vy: 0, r: 7, t: rand(g) * 6, hit: -1, bounced: false });
  });
}

/** 원과 선분: 닿았으면 바깥 방향(단위 벡터)과 파고든 깊이. */
function touch(b: Body, s: Seg): { nx: number; ny: number; depth: number } | null {
  const vx = s.x2 - s.x1, vy = s.y2 - s.y1, L2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((b.x - s.x1) * vx + (b.y - s.y1) * vy) / L2));
  const cx = s.x1 + vx * t, cy = s.y1 + vy * t, dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
  const R = b.r + 2;
  if (d >= R) return null;
  if (d < 1e-6) { const l = Math.sqrt(L2); return { nx: -vy / l, ny: vx / l, depth: R }; }
  return { nx: dx / d, ny: dy / d, depth: R - d };
}

/** 한 몸을 선분들에 부딪힌다. e: 튕김(0 미끄러짐, 1 거울처럼), fr: 미끄러질 때 줄어드는 비율 */
function collide(b: Body, segs: Seg[], e: number, fr: number): number {
  let hit = -1;
  for (const s of segs) {
    if (s.pi === b.skip) continue;
    if (b.x + b.r + 3 < Math.min(s.x1, s.x2) || b.x - b.r - 3 > Math.max(s.x1, s.x2) || b.y + b.r + 3 < Math.min(s.y1, s.y2) || b.y - b.r - 3 > Math.max(s.y1, s.y2)) continue;
    const c = touch(b, s);
    if (!c) continue;
    b.x += c.nx * c.depth; b.y += c.ny * c.depth;
    const vn = b.vx * c.nx + b.vy * c.ny;
    if (vn < 0) {
      b.vx -= (1 + e) * vn * c.nx; b.vy -= (1 + e) * vn * c.ny;
      const tx = -c.ny, ty = c.nx, vt = b.vx * tx + b.vy * ty;
      b.vx -= vt * fr * tx; b.vy -= vt * fr * ty;
    }
    hit = s.pi;
  }
  return hit;
}

function tileBounce(b: Body, h: Host, e: number): boolean {
  if (!h.solidAt(b.x, b.y + b.r) && !h.solidAt(b.x, b.y - b.r) && !h.solidAt(b.x - b.r, b.y) && !h.solidAt(b.x + b.r, b.y)) return false;
  // 가장 가까운 빈 쪽으로 빼낸다
  if (h.solidAt(b.x, b.y + b.r) && b.vy > 0) { b.y = Math.floor((b.y + b.r) / T) * T - b.r - 0.1; b.vy = -b.vy * e; b.vx *= 0.9; }
  else if (h.solidAt(b.x, b.y - b.r) && b.vy < 0) { b.y = Math.ceil((b.y - b.r) / T) * T + b.r + 0.1; b.vy = -b.vy * e; }
  if (h.solidAt(b.x + b.r, b.y) && b.vx > 0) { b.x = Math.floor((b.x + b.r) / T) * T - b.r - 0.1; b.vx = -b.vx * e; }
  else if (h.solidAt(b.x - b.r, b.y) && b.vx < 0) { b.x = Math.ceil((b.x - b.r) / T) * T + b.r + 0.1; b.vx = -b.vx * e; }
  return true;
}

function moveBodies(gs: GraphStage, g: GraphWorld, h: Host, segs: Seg[], dt: number) {
  const keep: Body[] = [];
  const flowers = gs.goals.map((x, i) => [x, i] as const).filter(([x]) => x.kind === 'flower');
  for (const b of g.bodies) {
    b.t += dt;
    let gone = false;
    for (let sub = 0; sub < 2 && !gone; sub++) {
      const d = dt / 2;
      if (b.k === 'bee') {
        if (!b.bounced) {
          // 가장 가까운 꽃으로 날아간다(조금 흔들리며)
          const fl = flowers.map(([x]) => (x as Extract<GoalDef, { kind: 'flower' }>).rect).sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))[0];
          const hv = gs.hives[0], speed = hv ? hv.speed : 90;
          if (fl) {
            const tx = fl.x + fl.w / 2 - b.x, ty = fl.y + fl.h / 2 - b.y, L = Math.hypot(tx, ty) || 1;
            b.vx = (tx / L) * speed + Math.cos(b.t * 5) * 25; b.vy = (ty / L) * speed + Math.sin(b.t * 7) * 25;
          }
        }
        b.x += b.vx * d; b.y += b.vy * d;
        if (!b.bounced && collide(b, segs, 1, 0) >= 0) { b.bounced = true; b.t = 0; const s = Math.hypot(b.vx, b.vy) || 1; b.vx = b.vx / s * 260; b.vy = b.vy / s * 260; }
        if (b.bounced && b.t > 1.6) gone = true;
      } else {
        b.vy = Math.min(b.k === 'rain' ? 420 : 620, b.vy + G_BODY * d);
        b.x += b.vx * d; b.y += b.vy * d;
        const e = b.k === 'rain' ? 0 : 0.25, fr = b.k === 'rain' ? 0 : 0.02;
        const hit = collide(b, segs, e, fr);
        if (hit >= 0) b.hit = hit;
        // 빗물: 곡선 위에서 거의 멈춘 채 오래 있으면 그 자리에서 아래로 샌다(평평한 홈통은 물을 모으지 못한다)
        if (b.k === 'rain' && hit >= 0 && Math.hypot(b.vx, b.vy) < 40) { b.t += d * 2; if (b.t > 2.2) { b.skip = hit; b.vy = 60; b.t = 0; } }
        if (tileBounce(b, h, b.k === 'rain' ? 0 : 0.3)) { if (b.k === 'rain') gone = true; }
      }
      if (b.x < -40 || b.x > h.stageW + 40 || b.y > h.stageH + 40 || b.y < -200) gone = true;
    }
    if (gone) continue;
    // 도름이에게 맞음: 빨간 공과 벌은 잠깐 멈춰 세운다
    if (b.k === 'red' || (b.k === 'bee' && !b.bounced)) {
      const p = h.players.find(q => !q.inDoor && b.x > q.x - b.r && b.x < q.x + q.w + b.r && b.y > q.y - b.r && b.y < q.y + q.h + b.r);
      if (p) { p.stun = 0.9; continue; }
    }
    // 떨어진 채 오래 구르는 공은 사라진다
    if ((b.k === 'blue' || b.k === 'red') && b.t > 12) continue;
    keep.push(b);
  }
  g.bodies = keep;
}

function sledTick(gs: GraphStage, g: GraphWorld, h: Host, segs: Seg[], dt: number) {
  const s = g.sled!, def = gs.sled!;
  if (!s.run) { s.x = def.x; s.y = def.y; return; }
  s.t += dt;
  const rider = h.players[s.rider];
  if (rider && rider.jumpNew && s.grounded) { s.vy = -330; s.grounded = false; }
  const body: Body = { k: 'sled', x: s.x, y: s.y - 9, vx: s.vx, vy: s.vy, r: 9, t: 0, hit: -1, bounced: false };
  s.grounded = false;
  for (let k = 0; k < 4; k++) {
    const d = dt / 4;
    body.vy = Math.min(700, body.vy + G_BODY * d);
    body.x += body.vx * d; body.y += body.vy * d;
    if (collide(body, segs, 0, 0.004) >= 0) s.grounded = true;
    if (tileBounce(body, h, 0)) s.grounded = true;
  }
  s.x = body.x; s.y = body.y + 9; s.vx = body.vx; s.vy = body.vy;
  // 표적: 차례대로 지나야 켜진다
  const next = gs.targets.filter(t => t.order > s.lit).sort((p, q) => p.order - q.order)[0];
  if (next) {
    const ry = rider ? rider.y : s.y - 40;
    if (near(next, s.x, s.y - 10, 12) || (rider && near(next, s.x, ry + 10, 10))) s.lit = next.order;
  }
  const allLit = gs.targets.every(t => t.order <= s.lit);
  const di = gs.goals.length + gs.slots.length;
  if (allLit && gs.targets.length) { g.done[di] = true; s.run = false; s.vx = 0; s.vy = 0; return; }
  s.still = Math.hypot(s.vx, s.vy) < 12 ? s.still + dt : 0;
  if (s.y > h.stageH + 40 || s.x < -30 || s.x > h.stageW + 30 || s.still > 1.5 || s.t > 25) {
    g.round.note = RNOTE.sled; g.round.noteT = 2.5;
    Object.assign(s, sledHome(def));
  }
}

/** 썰매에 탄 도름이 자리(판이 그 도름이를 썰매 위에 붙인다). */
export const riderSpot = (s: SledState) => ({ x: s.x - 11, y: s.y - 14 - 38 });

function goalsTick(gs: GraphStage, g: GraphWorld, h: Host, dt: number) {
  const rd = g.round;
  gs.goals.forEach((go, i) => {
    if (g.done[i]) return;
    if (go.kind === 'basket') {
      const need = h.need(go.need);
      g.bodies = g.bodies.filter(b => {
        if ((b.k !== 'blue' && b.k !== 'red') || !near(go.rect, b.x, b.y, 2)) return true;
        rd.score = b.k === 'blue' ? rd.score + 1 : Math.max(0, rd.score - 2);
        if (b.k === 'red') { rd.note = RNOTE.red; rd.noteT = 2.2; }
        return false;
      });
      if (rd.score >= need) { g.done[i] = true; rd.on = gs.goals.some((x, k) => !g.done[k] && x.kind !== 'basket'); }
      return;
    }
    if (go.kind === 'flower') {
      g.bodies = g.bodies.filter(b => {
        if (b.k !== 'bee' || b.bounced || !near(go.rect, b.x, b.y, 4)) return true;
        rd.hp[i] = Math.max(0, rd.hp[i] - 1);
        return false;
      });
      if (rd.on && rd.hp[i] <= 0) fail(gs, g, RNOTE.flower);
      else if (rd.on && rd.t >= go.hold) { g.done[i] = true; endIfDone(gs, g); }
      return;
    }
    // 새는 집: 바닥(leak 칸)에 떨어진 빗물을 센다. 양동이와 곡선이 받은 물은 세지 않는다
    const bk = g.bucket;
    g.bodies = g.bodies.filter(b => {
      if (b.k !== 'rain') return true;
      if (bk && bk.water < BUCKET_CAP && Math.abs(b.x - bk.x) < 13 && b.y > bk.y - 20 && b.y < bk.y - 4) { bk.water++; return false; }
      if (go.rects.some(r => near(r, b.x, b.y, 2))) { rd.leaks[i]++; return false; }
      return true;
    });
    if (rd.on && rd.leaks[i] > go.max) fail(gs, g, RNOTE.leak);
    else if (rd.on && rd.t >= go.hold) { g.done[i] = true; endIfDone(gs, g); }
  });
  void dt;
}
function endIfDone(gs: GraphStage, g: GraphWorld) {
  if (gs.goals.every((x, k) => g.done[k] || x.kind === 'basket')) { g.round.on = false; g.bodies = g.bodies.filter(b => b.k !== 'bee' && b.k !== 'rain'); }
}
function fail(gs: GraphStage, g: GraphWorld, why: string) {
  const rd = newRound(gs); rd.on = false; rd.note = why; rd.noteT = 3.5; g.round = rd;
  g.bodies = [];
  if (g.bucket) g.bucket.water = 0;
}

/** 홈: 조각 곡선이 홈 모양을 따라 tol 안에 0.8초 머물면 맞은 것. 맞은 조각은 그 자리에 박힌다. */
function slotsTick(gs: GraphStage, g: GraphWorld, dt: number) {
  gs.slots.forEach((sl, si) => {
    const di = gs.goals.length + si;
    if (g.done[di]) return;
    const fitBy = g.pieces.findIndex(pc => pc.state !== 'fall' && fits(pc, sl));
    if (fitBy < 0) { g.fit[si] = 0; return; }
    g.fit[si] += dt;
    if (g.fit[si] >= 0.8) {
      g.done[di] = true;
      const pc = g.pieces[fitBy];
      pc.state = 'fixed'; pc.holders = [];
    }
  });
}

/**
 * 조각을 위아래로만 옮겨 홈에 댔을 때 맞는 높이 차(판 점, +면 아래로). 맞출 수 없으면 null.
 * 홈의 모든 점 밑에 곡선이 있어야 하고, 차이들이 tol 의 두 배 안에 모여 있어야 하며, 조각이 홈 양 끝 밖으로 한 칸 넘게 나가지 않아야 한다.
 */
export function fitOffset(pc: Piece, sl: SlotDef): number | null {
  const tol = sl.tol * T, bx = pieceBox(pc);
  const xs = sl.pts.map(p => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (bx.x < x0 - T - tol || bx.x + bx.w > x1 + T + tol) return null;
  let lo = Infinity, hi = -Infinity;
  for (const [x, y] of sl.pts) {
    const ys = curveYs(pc, x);
    if (!ys.length) { if (x > bx.x + tol && x < bx.x + bx.w - tol) return null; if (x < bx.x - tol || x > bx.x + bx.w + tol) return null; continue; }
    let best = ys[0];
    for (const yy of ys) if (Math.abs(y - yy - (lo === Infinity ? 0 : (lo + hi) / 2)) < Math.abs(y - best - (lo === Infinity ? 0 : (lo + hi) / 2))) best = yy;
    lo = Math.min(lo, y - best); hi = Math.max(hi, y - best);
    if (hi - lo > 2 * tol) return null;
  }
  return (lo + hi) / 2;
}
export function fits(pc: Piece, sl: SlotDef): boolean {
  const off = fitOffset(pc, sl);
  return off != null && Math.abs(off) <= sl.tol * T;
}

/** 홈 모양을 판 점으로(stage.ts 가 읽을 때 한 번). 실패하면 까닭. */
export function slotPoints(latex: string, a: number, b: number, ox: number, oy: number): [number, number][] | string {
  const r = readFormula(latex);
  if (!r.ok) return r.reason;
  if (!(b > a) || b - a > RANGE_MAX) return `홈의 x 범위가 이상해요(${a} ~ ${b})`;
  const pts: [number, number][] = [];
  const n = Math.max(6, Math.ceil((b - a) * 3));
  for (let k = 0; k <= n; k++) {
    const x = a + ((b - a) * k) / n, y = r.formula.f(x);
    if (!Number.isFinite(y)) return '홈 식이 범위 안에서 끊겨 있어요';
    pts.push([ox + x * T, oy - y * T]);
  }
  return pts;
}

/** 주문 결과 글이 '됐다'는 뜻인가(창을 닫아도 되는가). */
export const orderDone = (note: string) => note === FNOTE.made || note === FNOTE.set;

/** 판이 주문을 받는 한 곳: 그 도름이가 그 방 가까이 있는지 보고 넣는다. 화면의 알림 글을 돌려준다. */
export function placeOrder(gs: GraphStage, g: GraphWorld, h: Host, pi: number, order: Order): string {
  return applyOrder(gs, g, order, atFactory(gs, h, pi, order.fac, order.k === 'f' ? 'press' : 'desk'));
}

/** 손님이 주문을 보내기 전에 이 기기에서 먼저 본다(방장과 같은 검사). 문제가 없으면 null. */
export function orderProblem(gs: GraphStage, g: GraphWorld, h: Host, pi: number, order: Order): string | null {
  if (!atFactory(gs, h, pi, order.fac, order.k === 'f' ? 'press' : 'desk')) return FNOTE.far;
  if (order.k === 'f') { const r = readFormula(order.latex); return r.ok ? null : r.reason; }
  const cur = g.factories[order.fac]?.latex;
  if (!cur) return FNOTE.noFormula;
  const r = readFormula(cur);
  if (!r.ok) return r.reason;
  const bad = rangeProblem(order.a, order.b, order.x0) ?? pointProblem(r.formula, order.x0, order.y0);
  if (bad) return bad;
  const shape = makeShape({ latex: cur, a: order.a, b: order.b, x0: order.x0 });
  return typeof shape === 'string' ? shape : null;
}

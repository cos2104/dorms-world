/**
 * 그래프 공장 장치의 legend 읽기(stage.ts 가 부른다). 형식 설명은 kit/STAGE_FORMAT.md '그래프 공장' 절.
 * 남이 쓴 팩이라 값의 모양과 범위를 모두 검사하고, 틀리면 쉬운 한국어로 알려 준다.
 */
import { slotPoints, type GraphStage, type Rect } from './model';
import { LATEX_MAX } from './expr';

const T = 30;
type Need = number | 'half' | 'third' | 'all';

export type GraphLegend =
  | { type: 'press' | 'desk'; factory?: string }
  | { type: 'out'; factory?: string; max?: number }
  | { type: 'stand' | 'bell' | 'bucket' | 'drain' }
  | { type: 'drop'; kind?: 'blue' | 'red' | 'mix' | 'rain'; every?: [number, number]; spread?: number; red?: number }
  | { type: 'hive'; every?: [number, number]; speed?: number }
  | { type: 'basket'; need?: Need; opens?: string[] }
  | { type: 'flower'; hp?: number; hold?: number; opens?: string[] }
  | { type: 'leak'; max?: number; hold?: number; opens?: string[] }
  | { type: 'sled'; opens?: string[] }
  | { type: 'target'; order?: number }
  | { type: 'slot'; latex?: string; a?: number; b?: number; tol?: number; opens?: string[] };

export const GRAPH_KEYS: Record<string, string[]> = {
  press: ['type', 'factory'], desk: ['type', 'factory'], out: ['type', 'factory', 'max'],
  stand: ['type'], bell: ['type'], bucket: ['type'], drain: ['type'],
  drop: ['type', 'kind', 'every', 'spread', 'red'], hive: ['type', 'every', 'speed'],
  basket: ['type', 'need', 'opens'], flower: ['type', 'hp', 'hold', 'opens'], leak: ['type', 'max', 'hold', 'opens'],
  sled: ['type', 'opens'], target: ['type', 'order'], slot: ['type', 'latex', 'a', 'b', 'tol', 'opens'],
};

type At = (c: number, r: number) => string;
type Groups = (cells: [number, number][]) => [number, number][][];

const num = (v: unknown, lo: number, hi: number, what: string, fallback: number): number => {
  if (v == null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${what} 는 ${lo} 부터 ${hi} 사이의 수예요.`);
  return v;
};
const pair = (v: unknown, lo: number, hi: number, what: string, fallback: [number, number]): [number, number] => {
  if (v == null) return fallback;
  if (typeof v === 'number') return [num(v, lo, hi, what, 0), num(v, lo, hi, what, 0)];
  if (!Array.isArray(v) || v.length !== 2) throw new Error(`${what} 는 [작은 수, 큰 수] 로 적어 주세요.`);
  const a = num(v[0], lo, hi, what, 0), b = num(v[1], lo, hi, what, 0);
  if (b < a) throw new Error(`${what} 는 작은 수를 앞에 적어 주세요.`);
  return [a, b];
};
const opensOf = (v: unknown, ch: string, legend: Record<string, { type?: string }>): string[] => {
  const o = v ?? [];
  if (!Array.isArray(o) || !o.length || o.length > 8 || o.some(x => typeof x !== 'string')) throw new Error(`"${ch}" 의 opens 에 여는 다리 글자를 목록으로 적어 주세요(8개까지). 예: ["x"]`);
  for (const x of o) if (legend[x]?.type !== 'bridge') throw new Error(`"${ch}" 가 여는 "${x}" 는 bridge 여야 해요.`);
  return o as string[];
};
const facName = (v: unknown, ch: string) => {
  const f = v ?? 'f';
  if (typeof f !== 'string' || !/^[a-z0-9]{1,8}$/.test(f)) throw new Error(`"${ch}" 의 factory 는 영문 소문자와 숫자 8자까지예요.`);
  return f;
};
const validNeed = (v: unknown): v is Need => v === 'half' || v === 'third' || v === 'all' || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 30);

/** 바닥에 서는 장치(아래가 땅). */
const FLOOR = new Set(['press', 'desk', 'out', 'stand', 'bell', 'bucket', 'drain', 'basket', 'flower']);   // 새는 바닥(leak)은 칸들을 감싼 넓이 전체를 센다

/** 공장 이름 → 공장 차례(같은 이름의 press·desk·out 을 묶는다). */
const facIndex = new WeakMap<GraphStage, Map<string, number>>();
function factory(g: GraphStage, name: string) {
  let m = facIndex.get(g); if (!m) { m = new Map(); facIndex.set(g, m); }
  let i = m.get(name);
  if (i == null) {
    if (g.factories.length >= 4) throw new Error('그래프 공장은 한 스테이지에 넷까지예요.');
    i = g.factories.length; m.set(name, i);
    g.factories.push({ name, press: [], desk: [], out: { x: 0, y: -1, w: 0, h: 0 }, max: 2 });
  }
  return g.factories[i];
}

export function parseGraphLegend(g: GraphStage, ch: string, def: GraphLegend, cells: [number, number][], at: At, groups: Groups, legend: Record<string, { type?: string }>) {
  const t = def.type;
  if (FLOOR.has(t)) for (const [c, r] of cells) if (at(c, r + 1) !== '#') throw new Error(`"${ch}"(${t}) 바로 아래는 땅(#)이어야 해요(지도 ${r + 1}번째 줄 ${c + 1}번째 칸).`);
  const cell = ([c, r]: [number, number]): Rect => ({ x: c * T, y: r * T, w: T, h: T });
  const box = (g2: [number, number][]): Rect => {
    const cs = g2.map(x => x[0]), rs = g2.map(x => x[1]);
    const c0 = Math.min(...cs), c1 = Math.max(...cs), r0 = Math.min(...rs), r1 = Math.max(...rs);
    return { x: c0 * T, y: r0 * T, w: (c1 - c0 + 1) * T, h: (r1 - r0 + 1) * T };
  };
  switch (def.type) {
    case 'press': case 'desk': {
      const f = factory(g, facName(def.factory, ch));
      for (const c of cells) f[def.type].push(cell(c));
      return;
    }
    case 'out': {
      const f = factory(g, facName(def.factory, ch));
      const gs = groups(cells);
      if (gs.length !== 1) throw new Error(`출구 "${ch}" 는 한 곳에만 놓아 주세요(옆으로 이어 놓으면 넓은 출구 하나).`);
      if (f.out.y >= 0) throw new Error(`공장 "${f.name}" 에 출구가 둘이에요.`);
      f.out = box(gs[0]);
      f.max = num(def.max, 1, 6, `출구 "${ch}" 의 max`, 2);
      return;
    }
    case 'stand': for (const c of cells) g.stands.push(cell(c)); return;
    case 'bell': for (const c of cells) g.bells.push(cell(c)); return;
    case 'drain': for (const c of cells) g.drains.push(cell(c)); return;
    case 'bucket': {
      if (cells.length !== 1 || g.bucket) throw new Error('양동이(bucket)는 한 스테이지에 하나예요.');
      g.bucket = { x: cells[0][0] * T + T / 2, y: (cells[0][1] + 1) * T - 0.5 };
      return;
    }
    case 'drop': {
      const kind = def.kind ?? 'blue';
      if (!['blue', 'red', 'mix', 'rain'].includes(kind)) throw new Error(`떨어뜨리는 곳 "${ch}" 의 kind 는 "blue", "red", "mix", "rain" 가운데 하나예요.`);
      const every = pair(def.every, 0.2, 20, `"${ch}" 의 every`, kind === 'rain' ? [0.25, 0.5] : [1.2, 2.2]);
      if (every[0] < 0.2) throw new Error(`"${ch}" 의 every 는 0.2초보다 짧게 둘 수 없어요.`);
      for (const gr of groups(cells)) g.drops.push({ ...box(gr), kind, every, spread: num(def.spread, 0, 30, `"${ch}" 의 spread`, 3), red: num(def.red, 0, 0.9, `"${ch}" 의 red`, 0.3) });
      return;
    }
    case 'hive': {
      for (const gr of groups(cells)) g.hives.push({ ...box(gr), every: pair(def.every, 0.4, 20, `"${ch}" 의 every`, [1.5, 3]), speed: num(def.speed, 30, 260, `"${ch}" 의 speed`, 90) });
      return;
    }
    case 'basket': {
      const need = def.need ?? 6;
      if (!validNeed(need)) throw new Error(`바구니 "${ch}" 의 need 는 1~30 숫자나 "half", "third", "all" 이어야 해요.`);
      const gs = groups(cells);
      if (gs.length !== 1) throw new Error(`바구니 "${ch}" 는 옆으로 이어 놓은 한 덩어리예요.`);
      g.goals.push({ kind: 'basket', ch, rect: box(gs[0]), need: typeof need === 'number' ? need : need === 'all' ? 30 : need === 'half' ? 15 : 10, opens: opensOf(def.opens, ch, legend) });
      return;
    }
    case 'flower': {
      const gs = groups(cells);
      if (gs.length !== 1) throw new Error(`꽃 "${ch}" 은 한 덩어리로 놓아 주세요.`);
      g.goals.push({ kind: 'flower', ch, rect: box(gs[0]), hp: num(def.hp, 1, 30, `꽃 "${ch}" 의 hp`, 5), hold: num(def.hold, 5, 300, `꽃 "${ch}" 의 hold`, 40), opens: opensOf(def.opens, ch, legend) });
      return;
    }
    case 'leak': {
      // 칸 사이에 양동이·거치대가 끼어 있어도 그 사이까지 한 넓이로 센다
      g.goals.push({ kind: 'leak', ch, rects: [box(cells)], max: num(def.max, 0, 99, `"${ch}" 의 max`, 6), hold: num(def.hold, 5, 300, `"${ch}" 의 hold`, 40), opens: opensOf(def.opens, ch, legend) });
      return;
    }
    case 'sled': {
      if (cells.length !== 1 || g.sled) throw new Error('썰매(sled)는 한 스테이지에 하나예요.');
      g.sled = { x: cells[0][0] * T + T / 2, y: (cells[0][1] + 1) * T, opens: opensOf(def.opens, ch, legend) };
      return;
    }
    case 'target': {
      const order = num(def.order, 1, 9, `표적 "${ch}" 의 order`, 1);
      if (!Number.isInteger(order)) throw new Error(`표적 "${ch}" 의 order 는 1 부터 9 까지의 자연수예요.`);
      for (const c of cells) g.targets.push({ ...cell(c), x: c[0] * T + 5, y: c[1] * T + 5, w: T - 10, h: T - 10, order });
      return;
    }
    case 'slot': {
      if (cells.length !== 1) throw new Error(`홈 "${ch}" 은 원점 한 칸에만 적어요(그 칸의 왼쪽 아래가 원점).`);
      if (typeof def.latex !== 'string' || !def.latex || def.latex.length > LATEX_MAX) throw new Error(`홈 "${ch}" 의 latex 에 홈 모양 식을 적어 주세요.`);
      const a = num(def.a, -40, 40, `홈 "${ch}" 의 a`, 0), b = num(def.b, -40, 40, `홈 "${ch}" 의 b`, 4);
      const ox = cells[0][0] * T, oy = (cells[0][1] + 1) * T;
      const pts = slotPoints(def.latex, a, b, ox, oy);
      if (typeof pts === 'string') throw new Error(`홈 "${ch}": ${pts}`);
      g.slots.push({ ch, latex: def.latex, a, b, ox, oy, tol: num(def.tol, 0.15, 0.8, `홈 "${ch}" 의 tol`, 0.4), opens: opensOf(def.opens, ch, legend), pts });
      return;
    }
  }
}

/** 다 읽은 뒤 서로 맞는지 본다. */
export function finishGraph(g: GraphStage, legend: Record<string, { type?: string }>) {
  void legend;
  for (const f of g.factories) {
    if (!f.press.length) throw new Error(`공장 "${f.name}" 에 찍는 방(press)이 없어요.`);
    if (!f.desk.length) throw new Error(`공장 "${f.name}" 에 손잡이 방(desk)이 없어요.`);
    if (f.out.y < 0) throw new Error(`공장 "${f.name}" 에 출구(out)가 없어요.`);
  }
  const used = g.drops.length || g.hives.length || g.goals.length || g.slots.length || g.sled || g.stands.length || g.bells.length || g.bucket;
  if (used && !g.factories.length) throw new Error('그래프 장치를 쓰려면 공장(press, desk, out)이 있어야 해요.');
  if (g.goals.some(x => x.kind === 'flower' || x.kind === 'leak') && !g.bells.length) throw new Error('꽃(flower)이나 새는 바닥(leak)이 있으면 시작 종(bell)을 놓아 주세요.');
  if (g.goals.some(x => x.kind === 'flower') && !g.hives.length) throw new Error('꽃(flower)이 있으면 벌집(hive)도 놓아 주세요.');
  if (g.goals.some(x => x.kind === 'leak') && !g.drops.some(d => d.kind === 'rain')) throw new Error('새는 바닥(leak)이 있으면 비 오는 곳(drop, kind "rain")도 놓아 주세요.');
  if (g.goals.some(x => x.kind === 'basket') && !g.drops.some(d => d.kind !== 'rain')) throw new Error('바구니(basket)가 있으면 공이 떨어지는 곳(drop)도 놓아 주세요.');
  if (g.sled && !g.targets.length) throw new Error('썰매(sled)가 있으면 표적(target)도 놓아 주세요.');
  if (g.targets.length && !g.sled) throw new Error('표적(target)은 썰매(sled)와 함께 써요.');
  const orders = [...new Set(g.targets.map(t => t.order))].sort((a, b) => a - b);
  orders.forEach((o, i) => { if (o !== i + 1) throw new Error('표적 order 는 1 부터 빠짐없이 차례로 적어 주세요.'); });
  if (g.drains.length && !g.bucket) throw new Error('물 버리는 곳(drain)이 있으면 양동이(bucket)도 놓아 주세요.');
}

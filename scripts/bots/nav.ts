/**
 * 봇의 길 찾기. 판의 물리(platform/sim.ts)를 도름이 한 명(또는 받쳐 주는 친구와 함께)으로 그대로 굴려
 * '어디에 설 수 있고, 거기서 어떤 조작을 하면 어디에 내려서는지'를 잰다. 손으로 정한 점프 거리는 쓰지 않는다.
 * 지도·켜진 다리·상자 자리가 같으면 다시 재지 않는다(팩 하나를 2·8·30명으로 돌릴 때 함께 쓴다).
 */
import { createWorld, step, PW, PH, type Pad, type World } from '../../platform/sim';
import { T, type Rect, type Stage } from '../../platform/stage';

/** 조작 한 토막: 좌우, 뛰기(토막 첫 걸음에 새로 누름), 걸음 수. */
export type Seg = [m: -1 | 0 | 1, j: 0 | 1, n: number];
export type NavNode = { id: number; c: number; feet: number; x: number };
/** boost: at 칸에 친구가 level 명 쌓여 서 있고, 그 맨 위에 hop 으로 올라가 segs 로 뛴다. */
export type NavEdge = { from: number; to: number; cost: number; segs: Seg[]; boost?: { at: number; level: number; hop: Seg[] } };

export const STAY: Pad = { m: 0, j: false };
export const X0 = (c: number) => c * T + (T - PW) / 2;
const DT = 1 / 60;

export function* padsOf(segs: Seg[]): Generator<Pad> {
  for (const [m, j, n] of segs) for (let k = 0; k < n; k++) yield { m, j: j === 1 && k === 0 };
}
export const segFrames = (segs: Seg[]) => segs.reduce((a, s) => a + s[2], 0);

/** 맨땅에서 해 보는 조작들. 달리며 뛰기는 손을 떼는 때만 다르고, 위로 뛰었다가 옆으로 가는 것도 있다. */
const MOVES: Seg[][] = [];
for (const d of [-1, 1] as const) {
  MOVES.push([[d, 0, 10]]);
  for (const k of [5, 9, 14, 20, 28, 38, 50]) MOVES.push([[d, 1, 1], [d, 0, k - 1]]);
  for (const [wait, k] of [[8, 10], [14, 12], [20, 20], [24, 30]]) MOVES.push([[0, 1, 1], [0, 0, wait - 1], [d, 0, k]]);
}
MOVES.push([[0, 1, 1]]);
/** 친구 머리 위에서 해 보는 조작들(옆으로 걸어 내려가기는 땅에서 이미 잰다). */
const LAUNCH: Seg[][] = MOVES.filter(s => s.length > 1 || s[0][1] === 1);

export function navSignature(active: Set<string>, crates: Rect[]) {
  // 밀리는 중인 상자는 걸음마다 조금씩 옮겨 간다. 5px 안쪽 차이는 같은 지도로 보고 다시 재지 않는다(어긋나면 길을 다시 찾는다)
  return [...active].sort().join('') + '|' + crates.map(c => `${Math.round(c.x / 5)},${Math.round(c.y / 5)}`).join(';');
}

export class Nav {
  readonly nodes: NavNode[] = [];
  private byCol = new Map<number, NavNode[]>();
  private out = new Map<number, NavEdge[]>();
  private bout = new Map<string, NavEdge[]>();
  private probes = new Map<number, World>();

  constructor(readonly stage: Stage, readonly active: Set<string>, readonly crates: Rect[]) {
    const solid = (c: number, r: number) => {
      if (c < 0 || c >= stage.cols) return true;
      if (r < 0 || r >= stage.rows) return false;
      if (stage.solid[r * stage.cols + c]) return true;
      for (const b of stage.bridges) if ((b.mode === 'appear') === active.has(b.ch) && b.cells.some(([bc, br]) => bc === c && br === r)) return true;
      return false;
    };
    for (let c = 0; c < stage.cols; c++) {
      const tops = new Set<number>();
      for (let r = 1; r < stage.rows; r++) if (solid(c, r) && !solid(c, r - 1)) tops.add(r * T);
      const cx = X0(c) + PW / 2;
      for (const k of crates) if (cx > k.x - PW / 2 + 2 && cx < k.x + k.w + PW / 2 - 2) tops.add(k.y);
      for (const feet of [...tops].sort((a, b) => a - b)) if (this.standsAt(c, feet)) {
        const n: NavNode = { id: this.nodes.length, c, feet, x: X0(c) };
        this.nodes.push(n);
        if (!this.byCol.has(c)) this.byCol.set(c, []);
        this.byCol.get(c)!.push(n);
      }
    }
  }

  /** k 명이 든 시험용 세계. 상자는 아무도 못 밀고, 열쇠는 줍지 않는다. */
  private probe(k: number): World {
    let w = this.probes.get(k);
    if (!w) {
      w = createWorld(this.stage, Array.from({ length: k }, () => ({ color: '#fff' })));
      w.crates = this.crates.map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h, vy: 0, need: 99, pushers: 0 }));
      w.key.used = true;
      this.probes.set(k, w);
    }
    for (const p of w.players) Object.assign(p, { vx: 0, vy: 0, on: false, jumpHeld: false, jumpBuf: 0, coyote: 0, jn: null, inDoor: false, carry: null, aHeld: false, aNew: false });
    w.crates.forEach((c, i) => { c.x = this.crates[i].x; c.y = this.crates[i].y; c.vy = 0; });
    return w;
  }
  private tick(w: World, pads: Pad[]) { w.active = new Set(this.active); step(w, pads, DT); }

  private standsAt(c: number, feet: number) {
    const w = this.probe(1), p = w.players[0];
    p.x = X0(c); p.y = feet - PH;
    for (let f = 0; f < 3; f++) this.tick(w, [STAY]);
    return p.on && Math.abs(p.y + PH - feet) < 0.01 && Math.abs(p.x - X0(c)) < 0.01;
  }

  /** 서 있는 도름이가 어느 칸에 있는가(친구 머리 위면 그 밑의 칸). */
  nodeAt(x: number, feet: number): NavNode | null {
    const cs = [Math.floor((x + PW / 2) / T), Math.floor((x + 2) / T), Math.floor((x + PW - 2) / T)];
    for (const c of cs) { const hit = this.byCol.get(c)?.find(n => Math.abs(n.feet - feet) < 1); if (hit) return hit; }
    const below = (this.byCol.get(cs[0]) ?? []).filter(n => n.feet >= feet - 1).sort((a, b) => a.feet - b.feet)[0];
    return below ?? null;
  }

  /** 조작을 그대로 굴려 내려선 칸. 떨어져 시작 자리로 돌아가거나 내려서지 못하면 null. */
  private land(w: World, mi: number, segs: Seg[]): { node: NavNode; frames: number } | null {
    const p = w.players[mi], pads = w.players.map(() => STAY);
    this.tick(w, pads);
    let frames = 1, lastY = p.y;
    const fallen = () => p.y > this.stage.rows * T || Math.abs(p.y - lastY) > 120;
    for (const pad of padsOf(segs)) { pads[mi] = pad; this.tick(w, pads); frames++; if (fallen()) return null; lastY = p.y; }
    pads[mi] = STAY;
    for (let f = 0; f < 150 && !(p.on && p.vy === 0); f++) { this.tick(w, pads); frames++; if (fallen()) return null; lastY = p.y; }
    if (!p.on) return null;
    const node = this.nodeAt(p.x, p.y + PH);
    return node && Math.abs(node.feet - (p.y + PH)) < 1 ? { node, frames } : null;
  }

  edges(id: number): NavEdge[] {
    const hit = this.out.get(id); if (hit) return hit;
    const n = this.nodes[id], list: NavEdge[] = [], best = new Map<number, NavEdge>();
    for (const segs of MOVES) {
      let to: NavNode | null = null, frames = 0;
      // 걷기는 한 번, 뛰기는 1.4px 씩 비켜 선 자리에서도 같은 데 내려서야 받는다(실제로 설 때 1.5px 안쪽으로 어긋난다)
      for (const dx of segs.length === 1 && segs[0][1] === 0 ? [0] : [0, -1.4, 1.4]) {
        const w = this.probe(1), p = w.players[0];
        p.x = n.x + dx; p.y = n.feet - PH; p.on = true;
        const r = this.land(w, 0, segs);
        if (!r || (to && r.node !== to)) { to = null; break; }
        to = r.node; frames = Math.max(frames, r.frames);
      }
      if (!to || to === n) continue;
      const prev = best.get(to.id);
      if (!prev || prev.cost > frames) best.set(to.id, { from: id, to: to.id, cost: frames, segs });
    }
    list.push(...best.values());
    this.out.set(id, list);
    return list;
  }

  /** 친구가 at 칸에 level 명 쌓여 서 있을 때, from 칸에서 그 머리 위로 올라가 뛰어 닿는 칸들. */
  boostEdges(from: number, level: number): NavEdge[] {
    const key = `${from}:${level}`, hit = this.bout.get(key); if (hit) return hit;
    const o = this.nodes[from], list: NavEdge[] = [], best = new Map<number, NavEdge>();
    for (const at of this.nodes) {
      const dc = at.c - o.c;
      if (at === o || Math.abs(dc) > 2 || Math.abs(at.feet - o.feet) > T) continue;
      const d = (dc > 0 ? 1 : -1) as 1 | -1;
      for (const hopK of [4, 7, 11, 16]) {
        const hop: Seg[] = [[d, 1, 1], [d, 0, hopK - 1]];
        const w = this.probe(level + 1), mover = w.players[level];
        const stackUp = () => {
          w.players.slice(0, level).forEach((h, k) => { h.x = at.x; h.y = at.feet - PH * (k + 1); h.on = true; });
          mover.x = o.x; mover.y = o.feet - PH; mover.on = true;
          for (let f = 0; f < 4; f++) this.tick(w, w.players.map(() => STAY));
        };
        stackUp();
        const top = w.players[level - 1];
        if (Math.abs(top.y - (at.feet - PH * level)) > 0.5) break;   // 친구가 그 칸에 쌓여 서지 못한다
        const pads = w.players.map(() => STAY);
        for (const pad of padsOf(hop)) { pads[level] = pad; this.tick(w, pads); }
        pads[level] = STAY;
        for (let f = 0; f < 90 && !mover.on; f++) this.tick(w, pads);
        if (!(mover.on && Math.abs(mover.y + PH - top.y) < 0.5)) continue;
        if (!alignOn(w, level, top.x, pads, t => this.tick(w, t))) continue;
        const sx = mover.x;
        for (const segs of LAUNCH) {
          stackUp(); mover.x = sx; mover.y = top.y - PH; mover.on = true;
          const r = this.land(w, level, segs);
          if (!r || r.node === at || r.node === o) continue;
          const cost = segFrames(hop) + 20 + r.frames + 90 * level;
          const prev = best.get(r.node.id);
          if (!prev || prev.cost > cost) best.set(r.node.id, { from, to: r.node.id, cost, segs, boost: { at: at.id, level, hop } });
        }
        break;
      }
    }
    list.push(...best.values());
    this.bout.set(key, list);
    return list;
  }

  /** 가장 적게 걸리는 길. boost 0 이면 친구 머리를 딛지 않는다. */
  path(from: NavNode, goal: (n: NavNode) => boolean, boost = 0, helperAt: (id: number) => boolean = () => true): NavEdge[] | null {
    if (goal(from)) return [];
    const dist = new Map<number, number>([[from.id, 0]]), prev = new Map<number, NavEdge>(), done = new Set<number>();
    const open = [from.id];
    while (open.length) {
      open.sort((a, b) => dist.get(b)! - dist.get(a)!);
      const id = open.pop()!;
      if (done.has(id)) continue;
      done.add(id);
      if (goal(this.nodes[id])) {
        const out: NavEdge[] = [];
        for (let cur = id; cur !== from.id;) { const e = prev.get(cur)!; out.unshift(e); cur = e.from; }
        return out;
      }
      const es = this.edges(id).concat(boost ? Array.from({ length: boost }, (_, k) => this.boostEdges(id, k + 1)).flat().filter(e => helperAt(e.boost!.at)) : []);
      for (const e of es) {
        const nd = dist.get(id)! + e.cost;
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, e); open.push(e.to); }
      }
    }
    return null;
  }

  /** 걸어서(친구 머리 없이) 닿는 칸 모두. */
  reach(from: NavNode[]): Set<number> {
    const seen = new Set(from.map(n => n.id)), todo = from.map(n => n.id);
    while (todo.length) for (const e of this.edges(todo.pop()!)) if (!seen.has(e.to)) { seen.add(e.to); todo.push(e.to); }
    return seen;
  }

  cost(from: NavNode, goal: (n: NavNode) => boolean, boost = 0, helperAt?: (id: number) => boolean) {
    const p = this.path(from, goal, boost, helperAt);
    return p ? p.reduce((a, e) => a + e.cost, 0) : Infinity;
  }
}

/** 친구 머리 위에서 그 친구 한가운데로 천천히 걸어 맞춘다(떨어지지 않게 한 걸음씩). */
export function alignOn(w: World, mi: number, x: number, pads: Pad[], tick: (pads: Pad[]) => void) {
  const p = w.players[mi];
  for (let f = 0; f < 40; f++) {
    const dx = x - p.x;
    if (Math.abs(dx) <= 1.5) { pads[mi] = STAY; return p.on; }
    pads[mi] = { m: dx > 0 ? 1 : -1, j: false };
    tick(pads);
    if (!p.on) { pads[mi] = STAY; return false; }
  }
  pads[mi] = STAY;
  return false;
}

/** 그래프 공장 시험 도우미: 스테이지를 읽고, 공장에서 조각을 찍고, 조각을 원하는 자리에 놓거나 꽂고, 판을 굴린다. */
import { readFileSync } from 'node:fs';
import { parseStage, type Stage } from '../platform/stage';
import { createWorld, hostOf, step, type Pad, type World } from '../platform/sim';
import { placeOrder, FNOTE, T, HANDLE, type Piece } from '../platform/graph/model';
import { readFormula } from '../platform/graph/expr';

export function loadStage(pack: string, file: string): Stage {
  const dir = new URL(`../packs/${pack}/stages/`, import.meta.url);
  const json = JSON.parse(readFileSync(new URL(`${file}.json`, dir), 'utf8').replace(/^﻿/, ''));
  return parseStage(readFileSync(new URL(`${file}.map.txt`, dir), 'utf8'), json);
}
export const makeWorld = (st: Stage, n = 2, seed = 7) => createWorld(st, Array.from({ length: n }, () => ({ color: '#F4F7FF' })), seed);

/** 도름이 pi 를 공장 방 앞에 세우고 식 → 점·범위를 넣는다. 찍힌 조각을 돌려준다(못 찍으면 까닭을 던진다). */
export function stamp(w: World, latex: string, a: number, b: number, x0: number, pi = 0, fac = 0): Piece {
  const gs = w.stage.graph, f = gs.factories[fac], p = w.players[pi];
  p.x = f.press[0].x + 4; p.y = f.press[0].y + T - p.h;
  const n1 = placeOrder(gs, w.g, hostOf(w), pi, { k: 'f', fac, latex });
  if (n1 !== FNOTE.set) throw new Error(`식: ${n1}`);
  const r = readFormula(w.g.factories[fac].latex);
  if (!r.ok) throw new Error(r.reason);
  p.x = f.desk[0].x + 4; p.y = f.desk[0].y + T - p.h;
  const before = w.g.nextId;
  const n2 = placeOrder(gs, w.g, hostOf(w), pi, { k: 'h', fac, x0, y0: r.formula.f(x0), a, b });
  if (n2 !== FNOTE.made) throw new Error(`손잡이: ${n2}`);
  return w.g.pieces.find(q => q.id === before)!;
}

/** 조각을 거치대 si 에 꽂는다(들고 가서 꽂은 것과 같은 자리). */
export function plant(w: World, pc: Piece, si: number) {
  const st = w.stage.graph.stands[si];
  pc.state = 'planted'; pc.stand = si; pc.holders = []; pc.x = st.x + st.w / 2; pc.y = st.y - 2 * T + 6;
}
/** 조각을 잡는 곳이 (x, y) 에 오게 들고 있다가 놓는다(떨어진다). */
export function dropAt(w: World, pc: Piece, x: number, y: number) { pc.state = 'fall'; pc.holders = []; pc.vy = 0; pc.x = x; pc.y = y; }
/** 도름이 pi 가 조각을 들고 (x 자리에) 서 있게 한다. */
export function holdBy(w: World, pc: Piece, pi: number) { pc.state = 'held'; pc.holders = [pi]; }

export function run(w: World, seconds: number, pads: (i: number, t: number) => Pad | undefined = () => undefined, until?: (w: World) => boolean) {
  const n = Math.round(seconds * 60);
  for (let k = 0; k < n; k++) {
    step(w, w.players.map((_, i) => pads(i, k / 60)), 1 / 60);
    if (until?.(w)) return true;
  }
  return false;
}
export const handleTop = (pc: Piece) => ({ x: pc.x, y: pc.y - HANDLE });
export const cellX = (c: number) => c * T + T / 2;
export { T };

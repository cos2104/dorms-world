/**
 * 그래프 공장 그리기. 색은 look.ts 의 PALETTE 와 sprite.ts 의 물감만 쓴다(점 그림 화풍).
 * 판 좌표(px)로 그리는 것(drawGraphWorld)과 화면 위쪽 알림 줄(graphHud)로 나뉜다.
 */
import { PALETTE } from '../look';
import { INKS } from '../sprite';
import { BUCKET_CAP, HANDLE, T, allGoals, pieceBox, type GraphStage, type GraphWorld, type Piece } from './model';

const N = PALETTE.navy, Y = PALETTE.key, BL = PALETTE.outline;

/** 화면에 보일 식: canonLatex 가 만든 LaTeX 를 읽기 쉬운 글로. 알아보지 못한 명령은 지운다. */
export function latexText(latex: string): string {
  // 안쪽부터 푼다: 한 자리 지수 → 제곱근 → 분수(여러 겹이면 되풀이)
  let s = latex.replace(/\^\{(\d)\}/g, (_, d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]);
  for (let k = 0; k < 6; k++) {
    s = s.replace(/\\sqrt\{([^{}]*)\}/g, (_, a) => `√${wrap(a)}`)
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => `${wrap(a)}/${wrap(b)}`)
      .replace(/\^\{([^{}]*)\}/g, (_, a) => `^${wrap(a)}`);
  }
  s = s
    .replace(/\\cdot\s*/g, '·').replace(/\\times\s*/g, '×').replace(/\\pi/g, 'π')
    .replace(/\\left|\\right/g, '').replace(/\\(sin|cos|tan|ln|log|exp|sec|csc|cot|arcsin|arccos|arctan|sinh|cosh|tanh)/g, '$1')
    .replace(/\\operatorname\{([a-z]+)\}/g, '$1').replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '');
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}
const wrap = (a: string) => (/^[\w.]+$/.test(a) ? a : `(${a})`);

function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string = N, fg: string = PALETTE.paper) {
  c.font = '700 12px Galmuri11, monospace'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const wd = Math.ceil(c.measureText(text).width) + 8;
  c.fillStyle = bg; c.fillRect(Math.round(x - wd / 2), Math.round(y - 12), wd, 16);
  c.fillStyle = fg; c.fillText(text, Math.round(x), Math.round(y));
}

/** 모눈종이: 한 칸마다 옅은 선, 다섯 칸마다 진한 선과 칸 번호(넓이와 높이를 세어 계산하게). */
export function drawGrid(c: CanvasRenderingContext2D, cols: number, rows: number) {
  const W = cols * T, H = rows * T;
  c.save();
  c.globalAlpha = 0.16; c.fillStyle = BL;
  for (let x = 0; x <= cols; x++) c.fillRect(x * T, 0, 1, H);
  for (let y = 0; y <= rows; y++) c.fillRect(0, y * T, W, 1);
  c.globalAlpha = 0.34;
  for (let x = 0; x <= cols; x += 5) c.fillRect(x * T - 1, 0, 2, H);
  for (let y = rows; y >= 0; y -= 5) c.fillRect(0, y * T - 1, W, 2);
  c.globalAlpha = 0.7; c.fillStyle = N; c.font = '10px Galmuri11, monospace'; c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  for (let x = 0; x <= cols; x += 5) c.fillText(String(x), x * T + 3, 11);
  for (let y = 5; y <= rows; y += 5) c.fillText(String(y), 3, (rows - y) * T - 3);   // 바닥부터 센 높이
  c.restore();
}

function poly(c: CanvasRenderingContext2D, pc: Piece, width: number, color: string) {
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const run of pc.shape.runs) {
    c.beginPath();
    run.forEach(([x, y], i) => (i ? c.lineTo(pc.x + x, pc.y + y) : c.moveTo(pc.x + x, pc.y + y)));
    c.stroke();
  }
}

function drawPiece(c: CanvasRenderingContext2D, pc: Piece, now: number, solid: (x: number, y: number) => boolean) {
  const fixed = pc.state === 'fixed';
  // 손잡이(지나는 점에서 아래로, 늘 세워 든다). 땅에 놓인 조각은 땅 위로 나온 만큼만 그린다
  let len = HANDLE;
  if (pc.state !== 'held') for (let k = 2; k <= HANDLE; k += 2) if (solid(pc.x, pc.y - HANDLE + k)) { len = k; break; }
  c.fillStyle = N; c.fillRect(Math.round(pc.x) - 3, Math.round(pc.y) - HANDLE, 6, len);
  c.fillStyle = PALETTE.door; c.fillRect(Math.round(pc.x) - 1, Math.round(pc.y) - HANDLE + 2, 2, Math.max(0, len - 4));
  const gy = pc.y - HANDLE + len;
  poly(c, pc, 7, N);
  poly(c, pc, 3, fixed ? PALETTE.grass : pc.ignore > 0 ? PALETTE.skyLow : Y);
  // 지나는 점과 잡는 곳
  c.fillStyle = N; c.fillRect(Math.round(pc.x) - 4, Math.round(pc.y) - HANDLE - 4, 8, 8);
  c.fillStyle = PALETTE.button; c.fillRect(Math.round(pc.x) - 2, Math.round(pc.y) - HANDLE - 2, 4, 4);
  if (pc.state !== 'held' && !fixed) {
    const bob = Math.floor(now / 400) % 2;
    c.fillStyle = N; c.fillRect(Math.round(pc.x) - 5, Math.round(gy) - 3 + bob, 10, 6);
    c.fillStyle = Y; c.fillRect(Math.round(pc.x) - 3, Math.round(gy) - 1 + bob, 6, 2);
  }
  if (pc.state === 'held' && pc.shape.need > 1) {
    const b = pieceBox(pc);
    label(c, `${Math.min(pc.holders.length, pc.shape.need)}/${pc.shape.need}`, pc.x, Math.round(b.y) - 6, pc.holders.length >= pc.shape.need ? N : PALETTE.button);
  }
}

function block(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
  c.fillStyle = N; c.fillRect(x, y, w, h);
  c.fillStyle = fill; c.fillRect(x + 2, y + 2, w - 4, h - 4);
}

function drawStations(c: CanvasRenderingContext2D, gs: GraphStage, g: GraphWorld, now: number) {
  gs.factories.forEach((f, fi) => {
    for (const r of f.press) {
      block(c, r.x + 1, r.y - 14, 28, 44, PALETTE.skyLow);
      c.fillStyle = N; c.fillRect(r.x + 9, r.y - 22, 12, 9); c.fillStyle = Y; c.fillRect(r.x + 11, r.y - 20, 8, 5);
      c.fillStyle = N; c.fillRect(r.x + 6, r.y + 2, 18, 3); c.fillRect(r.x + 6, r.y + 9, 12, 3);
      label(c, '찍는 방', r.x + T / 2, r.y - 28);
      const lat = g.factories[fi]?.latex;
      if (lat) label(c, `y = ${latexText(lat)}`, r.x + T / 2, r.y - 46, PALETTE.paper, N);
    }
    for (const r of f.desk) {
      c.fillStyle = N; c.fillRect(r.x, r.y + 8, 30, 6); c.fillRect(r.x + 3, r.y + 14, 4, 16); c.fillRect(r.x + 23, r.y + 14, 4, 16);
      c.fillStyle = PALETTE.crate; c.fillRect(r.x + 2, r.y + 9, 26, 3);
      c.fillStyle = Y; c.fillRect(r.x + 4, r.y + 3, 22, 5); c.fillStyle = N; for (let k = 0; k < 5; k++) c.fillRect(r.x + 6 + k * 4, r.y + 3, 1, 3);
      label(c, '손잡이 방', r.x + T / 2, r.y - 8);
    }
    const o = f.out;
    c.fillStyle = N; c.fillRect(o.x, o.y + o.h - 5, o.w, 5);
    c.fillStyle = PALETTE.grass; c.fillRect(o.x + 2, o.y + o.h - 4, o.w - 4, 2);
    for (let x = o.x + 4; x < o.x + o.w - 2; x += 10) { c.fillStyle = N; c.fillRect(x, o.y + o.h - 10, 2, 5); }
    label(c, '출구', o.x + o.w / 2, o.y + o.h + 16);
  });
  for (const st of gs.stands) {
    c.fillStyle = N; c.fillRect(st.x + 12, st.y - 2 * T + 6, 6, 2 * T + 24); c.fillRect(st.x + 4, st.y + T - 6, 22, 6);
    c.fillStyle = PALETTE.door; c.fillRect(st.x + 14, st.y - 2 * T + 8, 2, 2 * T + 18);
    c.fillStyle = Y; c.fillRect(st.x + 10, st.y - 2 * T + 2, 10, 6);
  }
  for (const b of gs.bells) {
    const ring = g.round.on ? Math.round(Math.sin(now / 90) * 2) : 0;
    c.fillStyle = N; c.fillRect(b.x + 13, b.y + 2, 4, 6); c.fillRect(b.x + 5 + ring, b.y + 7, 20, 16); c.fillRect(b.x + 2 + ring, b.y + 21, 26, 5); c.fillRect(b.x + 6, b.y + 26, 18, 4);
    c.fillStyle = Y; c.fillRect(b.x + 7 + ring, b.y + 9, 16, 12); c.fillRect(b.x + 4 + ring, b.y + 22, 22, 2);
    if (!g.round.on) label(c, '시작 종', b.x + T / 2, b.y - 6);
  }
  for (const d of gs.drops) {
    if (d.kind === 'rain') {
      c.fillStyle = N; c.fillRect(d.x - 6, d.y + 4, d.w + 12, 18); c.fillRect(d.x + 4, d.y - 2, d.w - 8, 8);
      c.fillStyle = PALETTE.paper; c.fillRect(d.x - 4, d.y + 6, d.w + 8, 14); c.fillRect(d.x + 6, d.y, d.w - 12, 8);
    } else {
      c.fillStyle = N; c.fillRect(d.x + 3, d.y, d.w - 6, 14); c.fillStyle = PALETTE.skyLow; c.fillRect(d.x + 5, d.y + 2, d.w - 10, 10);
      c.fillStyle = N; c.fillRect(d.x + 9, d.y + 14, d.w - 18, 4);
    }
  }
  for (const h of gs.hives) {
    block(c, h.x + 2, h.y + 2, 26, 26, Y);
    c.fillStyle = N; for (let k = 0; k < 3; k++) c.fillRect(h.x + 5, h.y + 8 + k * 6, 20, 2);
    c.fillRect(h.x + 12, h.y + 20, 6, 6);
  }
  gs.goals.forEach((go, i) => {
    const done = g.done[i];
    if (go.kind === 'basket') {
      const r = go.rect;
      c.fillStyle = N; c.fillRect(r.x, r.y + 6, r.w, r.h - 6); c.fillStyle = PALETTE.crate; c.fillRect(r.x + 3, r.y + 8, r.w - 6, r.h - 11);
      c.fillStyle = N; for (let x = r.x + 8; x < r.x + r.w - 4; x += 8) c.fillRect(x, r.y + 8, 2, r.h - 11);
      label(c, done ? '다 담았어요' : `파란 공 ${Math.min(g.round.score, go.need)}/${go.need}`, r.x + r.w / 2, r.y - 6, done ? PALETTE.grass : N, done ? N : PALETTE.paper);
    } else if (go.kind === 'flower') {
      const r = go.rect, cx = r.x + r.w / 2, base = r.y + r.h;
      c.fillStyle = PALETTE.grass; c.fillRect(cx - 2, base - 22, 4, 22);
      for (const [dx, dy] of [[-8, -30], [8, -30], [0, -38], [0, -22]]) { c.fillStyle = N; c.fillRect(cx + dx - 6, base + dy - 6, 12, 12); c.fillStyle = INKS.m; c.fillRect(cx + dx - 4, base + dy - 4, 8, 8); }
      c.fillStyle = Y; c.fillRect(cx - 4, base - 34, 8, 8);
      const hp = g.round.hp[i];
      for (let k = 0; k < go.hp; k++) { c.fillStyle = N; c.fillRect(cx - go.hp * 5 + k * 10, base - 56, 8, 8); c.fillStyle = k < hp ? PALETTE.button : PALETTE.skyLow; c.fillRect(cx - go.hp * 5 + k * 10 + 1, base - 55, 6, 6); }
    } else {
      for (const r of go.rects) { c.fillStyle = N; c.fillRect(r.x + 2, r.y + r.h - 6, r.w - 4, 4); c.fillStyle = INKS.k; c.fillRect(r.x + 4, r.y + r.h - 5, r.w - 8, 2); }
      const r = go.rects[0];
      label(c, `샌 물 ${g.round.leaks[i]}/${go.max}`, r.x + r.w / 2, r.y - 6, g.round.leaks[i] > go.max * 0.7 ? PALETTE.button : N);
    }
  });
  for (const d of gs.drains) {
    c.fillStyle = N; c.fillRect(d.x + 3, d.y + 20, 24, 10); c.fillStyle = PALETTE.skyLow; for (let x = d.x + 6; x < d.x + 26; x += 5) c.fillRect(x, d.y + 22, 2, 6);
    label(c, '물 버리는 곳', d.x + T / 2, d.y + 6);
  }
  gs.slots.forEach((sl, si) => {
    const done = g.done[gs.goals.length + si], fit = g.fit[si];
    c.save();
    c.strokeStyle = done ? PALETTE.grass : fit > 0 ? Y : N; c.lineWidth = done ? 6 : 4; c.lineCap = 'round';
    if (!done) c.setLineDash([8, 7]);
    c.beginPath(); sl.pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
    c.restore();
    c.fillStyle = N; c.fillRect(sl.ox - 3, sl.oy - 3, 6, 6);
  });
  gs.targets.forEach(t => {
    const lit = g.sled ? g.sled.lit >= t.order : false;
    block(c, t.x, t.y, t.w, t.h, lit ? Y : PALETTE.paper);
    c.fillStyle = N; c.font = '700 12px Galmuri11, monospace'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText('ABCDEFGHI'[t.order - 1], t.x + t.w / 2, t.y + t.h - 6);
  });
}

function drawBodies(c: CanvasRenderingContext2D, g: GraphWorld, now: number) {
  for (const b of g.bodies) {
    const x = Math.round(b.x), y = Math.round(b.y);
    if (b.k === 'rain') { c.fillStyle = N; c.fillRect(x - 2, y - 5, 4, 9); c.fillStyle = INKS.t; c.fillRect(x - 1, y - 4, 2, 7); continue; }
    if (b.k === 'bee') {
      const flap = Math.floor(now / 70) % 2;
      c.fillStyle = PALETTE.paper; c.fillRect(x - 6, y - 9 - flap, 5, 5); c.fillRect(x + 1, y - 9 - flap, 5, 5);
      c.fillStyle = N; c.fillRect(x - 7, y - 5, 14, 10); c.fillStyle = Y; c.fillRect(x - 5, y - 3, 10, 6);
      c.fillStyle = N; c.fillRect(x - 2, y - 3, 2, 6); c.fillRect(x + 2, y - 3, 1, 6);
      continue;
    }
    const fill = b.k === 'blue' ? BL : PALETTE.button;
    c.fillStyle = N; c.fillRect(x - 7, y - 8, 14, 16); c.fillRect(x - 8, y - 7, 16, 14);
    c.fillStyle = fill; c.fillRect(x - 6, y - 6, 12, 12); c.fillRect(x - 7, y - 5, 14, 10);
    c.fillStyle = PALETTE.paper; c.fillRect(x - 4, y - 4, 3, 3);
  }
}

function drawBucket(c: CanvasRenderingContext2D, g: GraphWorld) {
  const b = g.bucket;
  if (!b) return;
  const x = Math.round(b.x - 12), y = Math.round(b.y - 20);
  c.fillStyle = N; c.fillRect(x, y, 24, 20); c.fillRect(x - 2, y, 28, 3);
  c.fillStyle = INKS.a; c.fillRect(x + 2, y + 3, 20, 15);
  const lv = Math.round((b.water / BUCKET_CAP) * 13);
  if (lv) { c.fillStyle = INKS.t; c.fillRect(x + 2, y + 18 - lv, 20, lv); }
  if (b.water >= BUCKET_CAP) label(c, '가득 찼어요', b.x, y - 6, PALETTE.button);
}

function drawSled(c: CanvasRenderingContext2D, g: GraphWorld) {
  const s = g.sled;
  if (!s) return;
  const x = Math.round(s.x), y = Math.round(s.y);
  c.fillStyle = N; c.fillRect(x - 16, y - 12, 32, 6); c.fillRect(x - 18, y - 4, 36, 3); c.fillRect(x - 12, y - 7, 3, 4); c.fillRect(x + 9, y - 7, 3, 4); c.fillRect(x + 16, y - 7, 4, 4);
  c.fillStyle = PALETTE.door; c.fillRect(x - 14, y - 11, 28, 3);
  if (!s.run) label(c, '썰매', x, y + 16);
}

/** 판 좌표로 그린다. 그래프 장치가 없는 스테이지에서는 아무것도 하지 않는다. */
export function drawGraphBack(c: CanvasRenderingContext2D, gs: GraphStage, g: GraphWorld, cols: number, rows: number, now: number) {
  if (!gs.factories.length) return;
  drawGrid(c, cols, rows);
  drawStations(c, gs, g, now);
}
export function drawGraphFront(c: CanvasRenderingContext2D, gs: GraphStage, g: GraphWorld, now: number, solid: (x: number, y: number) => boolean) {
  if (!gs.factories.length) return;
  for (const pc of g.pieces) drawPiece(c, pc, now, solid);
  drawSled(c, g);
  drawBucket(c, g);
  drawBodies(c, g, now);
}

/** 화면 위쪽 한 줄(판이 돌아가는 동안의 남은 시간·점수, 알림). 없으면 빈 글. */
export function graphHud(gs: GraphStage, g: GraphWorld): string {
  if (!gs.factories.length) return '';
  if (g.round.noteT > 0 && g.round.note) return g.round.note;
  const parts: string[] = [];
  gs.goals.forEach((go, i) => {
    if (g.done[i]) return;
    if ((go.kind === 'flower' || go.kind === 'leak') && g.round.on) parts.push(`버틸 시간 ${Math.max(0, Math.ceil(go.hold - g.round.t))}초`);
  });
  if (gs.sled && g.sled?.run) parts.push(`표적 ${g.sled.lit}/${gs.targets.length}`);
  const left = allGoals(gs).filter((_, i) => !g.done[i]).length;
  if (!parts.length && left === 0) return '';
  return [...new Set(parts)].join(' · ');
}

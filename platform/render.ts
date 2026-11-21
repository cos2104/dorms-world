/** 그리기. 캔버스 2D, 점 그림이 뭉개지지 않게 늘 정수 자리에 그린다. */
import { ATLAS, BODY_SHADES, MOTION, PALETTE, SPRITES, VIEW_H, VIEW_W, type SpriteName } from './look';
import { T, type Stage } from './stage';
import { BOX_PART, actionAt, atDoor, bridgeSolid, createWorld, type Action, type Item, type Player, type World } from './sim';
import { sideText, stepText, type Line } from './equation';
import { INKS, type Sprite } from './sprite';

const BASE = import.meta.env.BASE_URL;
const images = new Map<string, HTMLImageElement>();
let ready: Promise<void> | null = null;

function load(name: string, file: string) {
  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => { images.set(name, img); resolve(); };
    img.onerror = () => reject(new Error(`그림을 불러오지 못했어요: ${file}`));
    img.src = `${BASE}sprites/${file}`;
  });
}

export function loadAssets() {
  ready ??= Promise.all([load('atlas', 'doreumi-atlas.png'), ...SPRITES.map(n => load(n, `hf_${n}.png`))]).then(() => undefined);
  return ready;
}
const spr = (n: SpriteName | 'atlas') => images.get(n)!;

const hexToRgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const tintCache = new Map<string, HTMLCanvasElement | HTMLImageElement>();
/** 몸 색만 갈아입힌다: 흰 몸은 플레이어 색으로, 그늘과 테두리는 같은 색을 어둡게. */
function tinted(color: string) {
  const key = color.toLowerCase();
  const hit = tintCache.get(key); if (hit) return hit;
  const atlas = spr('atlas');
  if (key === '#f4f7ff') { tintCache.set(key, atlas); return atlas; }
  const cv = document.createElement('canvas'); cv.width = atlas.naturalWidth; cv.height = atlas.naturalHeight;
  const g = cv.getContext('2d')!; g.drawImage(atlas, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height), a = d.data, base = hexToRgb(key);
  const map = new Map(BODY_SHADES.map(([from, k]) => [from, base.map(v => Math.round(v * k))]));
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 3]) continue;
    const to = map.get(((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]).toString(16).padStart(6, '0'));
    if (to) { a[i] = to[0]; a[i + 1] = to[1]; a[i + 2] = to[2]; }
  }
  g.putImageData(d, 0, 0); tintCache.set(key, cv); return cv;
}

function drawDoreumi(c: CanvasRenderingContext2D, p: Player, now: number) {
  const moving = p.on && Math.abs(p.vx) > 0;
  const frame = [0, 1, 2, 1][Math.floor(p.walk) % 4];
  let name: string;
  if (p.turnT > 0 || !p.side) name = moving && !p.turnT ? `front_${frame}` : 'front_1';
  else if (!p.on) name = `${p.side}_1`;
  else name = moving ? `${p.side}_${frame}` : `${p.side}_1`;
  const [sx, sy, sw, sh] = ATLAS[name] ?? ATLAS.front_1;   // 모르는 그림 이름이어도 그리기가 멈추지 않게
  const bob = moving ? (Math.floor(now / MOTION.walkBobMs) % 2 ? -1 : 0) : (Math.sin(now / MOTION.idleBreathMs * Math.PI * 2 + p.i) > 0.3 ? -1 : 0);
  c.drawImage(tinted(p.color), sx, sy, sw, sh, Math.round(p.x + p.w / 2 - sw / 2), Math.round(p.y + p.h - sh + 1 + bob), sw, sh);
}

export type Camera = { x: number; y: number; scale: number };

/** 화면이 따라갈 자리. me 가 있으면 내 도름이를, 없으면(함께 보는 큰 화면) 모두가 담기게. */
export function cameraFor(w: World, me: number | null, prev?: Camera): Camera {
  const sw = w.stage.cols * T, sh = w.stage.rows * T;
  const alive = w.players.filter(p => !p.inDoor);
  let scale = 1, cx = sw / 2;
  if (me != null && w.players[me] && !w.players[me].inDoor) cx = w.players[me].x + w.players[me].w / 2;
  else if (alive.length) {
    const xs = alive.map(p => p.x);
    const lo = Math.min(...xs), hi = Math.max(...xs) + 22;
    cx = (lo + hi) / 2;
    scale = Math.min(1, Math.max(VIEW_W / sw, 0.5, VIEW_W / (hi - lo + 240)));
  } else if (!w.players.length) cx = w.stage.spawn.x;   // 아직 아무도 없는 큰 화면은 시작 자리를 비춘다
  else if (w.stage.door) cx = w.stage.door.x + T;
  const vw = VIEW_W / scale;
  let x = Math.max(0, Math.min(sw - vw, cx - vw / 2));
  if (sw < vw) x = (sw - vw) / 2;
  if (prev) { x = prev.x + (x - prev.x) * 0.15; scale = prev.scale + (scale - prev.scale) * 0.1; }
  return { x, y: sh - VIEW_H / scale, scale };
}

function drawStage(c: CanvasRenderingContext2D, w: World, now: number, me: number | null, names?: readonly string[]) {
  const s = w.stage;
  for (const b of s.bridges) {
    if (!bridgeSolid(w, b.ch, b.mode)) continue;
    const has = new Set(b.cells.map(([cc, r]) => `${cc},${r}`));
    for (const [cc, r] of b.cells) {
      if (has.has(`${cc},${r - 1}`)) { c.fillStyle = PALETTE.crate; c.fillRect(cc * T + 9, r * T, 12, T); c.fillStyle = PALETTE.outline; c.fillRect(cc * T + 9, r * T, 3, T); c.fillRect(cc * T + 18, r * T, 3, T); }
      else c.drawImage(spr('plank'), 0, 0, 30, 15, cc * T, r * T - 2, T, 15);
    }
  }
  for (let r = 0; r < s.rows; r++) for (let cc = 0; cc < s.cols; cc++) {
    if (!s.solid[r * s.cols + cc]) continue;
    const top = r === 0 || !s.solid[(r - 1) * s.cols + cc];
    c.drawImage(spr(top ? 'tile' : 'soil'), cc * T, r * T, T, T);
  }
  for (const d of s.decos) drawSprite(c, d.sprite, d.x, d.y, 2);
  s.scales.forEach((_, si) => drawScale(c, w, si, now));
  for (const l of s.levers) drawLever(c, w, l, now);
  s.buttons.forEach((b, i) => {
    const down = w.pressed[i] >= w.needs[i], h = down ? 16 : 26;
    for (let x = b.x - 3; x < b.x + b.w; x += T) c.drawImage(spr('button'), x, b.y + 8 - h, 30, h);
    if (w.needs[i] > 1) label(c, `${Math.min(w.pressed[i], w.needs[i])}/${w.needs[i]}`, b.x + b.w / 2, b.y - 26);
  });
  if (s.door) { const img = spr(w.doorOpen ? 'door_open' : 'door'); c.drawImage(img, s.door.x + s.door.w / 2 - 33, s.door.y + s.door.h - 86, w.doorOpen ? 82 : 66, 86); }
  for (const b of w.crates) {
    c.drawImage(spr('crate'), Math.round(b.x), Math.round(b.y), b.w, b.h);
    if (b.need > 1 && b.pushers > 0 && b.pushers < b.need) label(c, `${b.pushers}/${b.need}`, b.x + b.w / 2, b.y - 8);
  }
  for (const g of s.signs) drawSign(c, g.x, g.y);
  const order = w.players.filter(p => !p.inDoor).sort((a, b) => Number(a.i === me) - Number(b.i === me));
  for (const p of order) drawDoreumi(c, p, now);
  // 통은 도름이 앞에 그린다(통 앞에 서도 구슬이 담겼는지 비었는지 보이게)
  for (const b of s.bins) drawBin(c, b.x, b.y, !s.scales[b.scale].hasAddSub || w.scales[b.scale].mode === 'add');
  // 든 것은 머리 바로 위에, 번호표는 그 위로 올린다(번호표가 든 것을 가리지 않게)
  const lift = (p: Player) => (p.carry ? (p.carry.kind === 'box' ? 21 : 13) : 0);
  for (const p of order) if (p.carry) { const size = p.carry.kind === 'box' ? 18 : 10; drawItem(c, p.carry.kind, Math.round(p.x + p.w / 2 - size / 2), Math.round(p.y - size - 3), size, s.scales[p.carry.scale]?.skin[p.carry.kind]); }
  for (const p of order) tag(c, p, p.i === me, lift(p), names?.[p.i]);
  if (!w.key.used) c.drawImage(spr('key'), Math.round(w.key.x), Math.round(w.key.y), 32, 18);
  if (me != null && w.players[me] && !w.players[me].inDoor) {
    const p = w.players[me];
    if (s.door && atDoor(w, p)) label(c, '확인을 눌러 들어가요', Math.max(84, Math.min(s.cols * T - 84, s.door.x + s.door.w / 2)), s.door.y - 6);   // 지도 끝에 선 문에서도 글이 잘리지 않게
    const act = actionAt(w, p);
    // 발밑 둘째 줄에 적는다(머리 위는 접시와, 발밑 첫 줄은 레버 이름표와 겹친다). 같은 말이 저울 알림으로 떠 있으면 두 번 적지 않는다
    if (act && !(act.do === 'no' && w.scales[act.scale].noteT > 0)) label(c, actionText(w, act), Math.max(70, Math.min(s.cols * T - 70, p.x + p.w / 2)), p.y + p.h + 46);
    for (const g of s.signs) if (Math.abs(g.x + T / 2 - (p.x + p.w / 2)) < 50 && Math.abs(g.y - p.y) < 70) bubble(c, g.texts[me % g.texts.length], g.x + T / 2, g.y - 10);
  }
}

// ---------- 저울 ----------
const INK = PALETTE.navy, MARBLE = PALETTE.button, TRAY = PALETTE.skyLow;

/**
 * 좁은 화면용: 내 도름이에게 가장 가까운 저울의 풀이 판(마지막 세 줄)과 지금 할 수 있는 일을 글로 돌려준다.
 * 휴대폰 세로에서는 판이 작게 줄어 캔버스 안 글자를 읽을 수 없어서, 같은 글을 판 아래에 함께 적는다.
 */
export function nearText(w: World, me: number | null): string {
  const p = me != null ? w.players[me] : null;
  if (!p || p.inDoor || !w.scales.length) return '';
  let best = -1, near = 420;
  w.stage.scales.forEach((d, i) => { const dist = Math.abs((d.pans[0].x + d.pans[1].x + d.pans[1].w) / 2 - p.x - p.w / 2); if (dist < near) { near = dist; best = i; } });
  if (best < 0) return '';
  const sc = w.scales[best], act = actionAt(w, p);
  const lines = sc.lines.slice(-3).map(l => `${sideText(l[0], l[1])} = ${sideText(l[2], l[3])}`);
  return [...lines, sc.noteT > 0 && sc.note ? sc.note : act ? actionText(w, act) : ''].join('\n').trim();
}

/** 확인을 누르면 일어날 일을 쉬운 말로. */
function actionText(w: World, a: Action) {
  if (a.do === 'no') return a.why;
  if (a.do === 'lever') { const l = w.stage.levers[a.lever]; return l.does === 'divide' ? '확인: 똑같이 나누기' : w.scales[l.scale].mode === 'add' ? '확인: 빼기로 바꾸기' : '확인: 더하기로 바꾸기'; }
  if (a.do === 'take') return a.kind === 'box' ? '확인: 상자 들기' : '확인: 구슬 들기';
  if (a.do === 'place') return '확인: 올려놓기';
  return a.do === 'discard' ? '확인: 통에 버리기' : '확인: 구슬 꺼내기';
}

const spriteCache = new WeakMap<Sprite, HTMLCanvasElement>();
/** 글자 그림을 그린다. cell 은 한 점의 크기(px). 한 번 그려 둔 것을 다시 쓴다. */
function drawSprite(c: CanvasRenderingContext2D, sp: Sprite, x: number, y: number, cell: number) {
  let cv = spriteCache.get(sp);
  if (!cv) {
    cv = document.createElement('canvas'); cv.width = sp.w; cv.height = sp.h;
    const g = cv.getContext('2d')!;
    sp.rows.forEach((row, r) => { for (let k = 0; k < sp.w; k++) if (row[k] !== '.') { g.fillStyle = INKS[row[k]]; g.fillRect(k, r, 1, 1); } });
    spriteCache.set(sp, cv);
  }
  c.drawImage(cv, Math.round(x), Math.round(y), sp.w * cell, sp.h * cell);
}

function drawItem(c: CanvasRenderingContext2D, kind: Item, x: number, y: number, size: number, skin?: Sprite) {
  if (skin) { drawSprite(c, skin, x + Math.floor((size - skin.w) / 2), y + size - skin.h, 1); return; }   // 팩의 그림(칸 바닥에 맞춘다)
  if (kind === 'box') {
    c.fillStyle = INK; c.fillRect(x, y, size, size);
    c.fillStyle = PALETTE.crate; c.fillRect(x + 2, y + 2, size - 4, size - 4);
    c.fillStyle = INK; c.font = `700 ${size >= 18 ? 12 : 10}px Galmuri11, monospace`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText('x', x + size / 2, y + size - 5);
  } else {
    c.fillStyle = INK; c.fillRect(x + 1, y, size - 2, size); c.fillRect(x, y + 1, size, size - 2);
    c.fillStyle = MARBLE; c.fillRect(x + 2, y + 1, size - 4, size - 2); c.fillRect(x + 1, y + 2, size - 2, size - 4);
    c.fillStyle = PALETTE.paper; c.fillRect(x + 2, y + 2, 2, 2);
  }
}

/** 접시 위에 놓인 것. 상자는 왼쪽 칸에 세 개씩, 구슬은 오른쪽 칸에 다섯 개씩 묶어 열 개가 한 줄이다(세기 쉽게). */
function drawPan(c: CanvasRenderingContext2D, pan: { x: number; y: number; w: number }, dy: number, boxes: number, marbles: number, skin: { box?: Sprite; marble?: Sprite } = {}) {
  const top = Math.round(pan.y + T - 7 + dy), split = Math.round(pan.x + pan.w * BOX_PART);
  c.fillStyle = INK; c.fillRect(pan.x, top, pan.w, 7); c.fillRect(pan.x, top - 5, 3, 5); c.fillRect(pan.x + pan.w - 3, top - 5, 3, 5); c.fillRect(split - 1, top - 4, 2, 4);
  c.fillStyle = TRAY; c.fillRect(pan.x + 2, top + 2, pan.w - 4, 3);
  for (let i = 0; i < boxes; i++) drawItem(c, 'box', pan.x + 7 + (i % 3) * 21, top - 19 - Math.floor(i / 3) * 20, 18, skin.box);
  // 풍선(구슬 수가 음수일 때): 접시 구슬 칸에 줄로 매여 떠 있다
  for (let i = 0; i < -marbles; i++) {
    const col = i % 5, bx = split + 12 + col * 17, by = top - 30 - Math.floor(i / 5) * 15 - (col % 2) * 5;   // 다섯 개씩 한 줄(아홉 개여도 구슬 칸 안, 매단 줄 안쪽)
    c.fillStyle = INK; c.fillRect(bx + 4, by + 11, 1, top - by - 11);
    c.fillRect(bx + 1, by, 8, 12); c.fillRect(bx, by + 1, 10, 9);
    c.fillStyle = PALETTE.grass; c.fillRect(bx + 2, by + 1, 6, 10); c.fillRect(bx + 1, by + 2, 8, 7);   // 열쇠(노랑)·구슬(빨강)과 다른 색
    c.fillStyle = PALETTE.paper; c.fillRect(bx + 2, by + 2, 2, 2);
  }
  for (let i = 0; i < marbles; i++) { const col = i % 10; drawItem(c, 'marble', split + 4 + col * 10 + (col >= 5 ? 4 : 0), top - 10 - Math.floor(i / 10) * 10, 9, skin.marble); }
}

function drawScale(c: CanvasRenderingContext2D, w: World, si: number, now: number) {
  const def = w.stage.scales[si], sc = w.scales[si], [L, R] = def.pans;
  const cx = Math.round((L.x + L.w / 2 + R.x + R.w / 2) / 2), beamY = L.y - 2 * T + 10;
  const warn = def.spill > 0 && sc.tilt !== 0 ? sc.tiltT / def.spill : 0;      // 쏟아지기까지 얼마나 왔나
  const jitter = (sc.shake > 0 ? Math.round(Math.sin(now / 28) * 2) : 0) + (warn > 0.5 ? Math.round(Math.sin(now / 40) * (warn - 0.5) * 6) : 0);
  const dyL = -sc.lean * 10 + jitter, dyR = sc.lean * 10 - jitter;
  const lx = L.x + L.w / 2, rx = R.x + R.w / 2;
  // 기둥과 받침
  c.fillStyle = INK; c.fillRect(cx - 5, beamY, 10, def.floor - beamY); c.fillRect(cx - 24, def.floor - 8, 48, 8);
  c.fillStyle = PALETTE.outline; c.fillRect(cx - 2, beamY + 4, 3, def.floor - beamY - 14);
  // 저울대(점 그림이라 계단으로 기운다)
  for (let x = lx; x < rx; x += 6) { const t = (x - lx) / (rx - lx), y = Math.round(beamY + dyL + (dyR - dyL) * t); c.fillStyle = INK; c.fillRect(Math.round(x), y, 6, 6); c.fillStyle = PALETTE.outline; c.fillRect(Math.round(x), y + 1, 6, 2); }
  c.fillStyle = PALETTE.key; c.fillRect(cx - 5, beamY - 3, 10, 12); c.fillStyle = INK; c.fillRect(cx - 2, beamY, 4, 6);
  // 줄
  for (const [pan, dy, mid] of [[L, dyL, lx], [R, dyR, rx]] as const) {
    const top = Math.round(beamY + dy + 6), bottom = Math.round(pan.y + T - 7 + dy);
    c.fillStyle = INK; c.fillRect(Math.round(mid) - 1, top, 2, 8);
    for (const ex of [pan.x + 1, pan.x + pan.w - 3]) { const steps = 10; for (let k = 0; k < steps; k++) { const t = k / steps; c.fillRect(Math.round(mid + (ex - mid) * t), Math.round(top + 8 + (bottom - 5 - top - 8) * t), 2, Math.ceil((bottom - 5 - top - 8) / steps) + 1); } }
  }
  drawPan(c, L, dyL, sc.line[0], sc.line[1], def.skin);
  drawPan(c, R, dyR, sc.line[2], sc.line[3], def.skin);
  if (warn > 0) { c.fillStyle = INK; c.fillRect(cx - 22, beamY + 16, 44, 7); c.fillStyle = PALETTE.button; c.fillRect(cx - 20, beamY + 18, Math.round(40 * (1 - Math.min(1, warn))), 3); }
  drawBoard(c, sc.lines, sc.solved, cx, beamY - 12);
  if (sc.noteT > 0 && sc.note) label(c, sc.note, cx, beamY + 46);   // 저울대 바로 아래(레버 이름표와 겹치지 않는 자리)
}

/** 풀이 판. 수평이던 식이 한 줄씩 쌓이고, 줄 사이에 양변에 한 일이 적힌다. 등호를 한 줄에 맞춘다. */
function drawBoard(c: CanvasRenderingContext2D, lines: Line[], solved: boolean, cx: number, bottom: number) {
  const shown = lines.slice(-4), EQ = 20, NOTE = 15, W = 236;
  const h = shown.length * EQ + (shown.length - 1) * NOTE + 12;
  let y = bottom - h;
  c.fillStyle = INK; c.fillRect(cx - W / 2 - 2, y - 2, W + 4, h + 4);
  c.fillStyle = PALETTE.paper; c.fillRect(cx - W / 2, y, W, h);
  y += 6;
  shown.forEach((ln, i) => {
    if (i > 0) {
      const all = lines.length - shown.length + i;
      c.font = '11px Galmuri11, monospace'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = PALETTE.outline;
      c.fillText(stepText(lines[all - 1], ln), cx, y + 11);
      y += NOTE;
    }
    const last = i === shown.length - 1;
    if (last && solved) { c.fillStyle = PALETTE.key; c.fillRect(cx - W / 2 + 4, y, W - 8, EQ - 2); }
    c.font = `${last ? '700 ' : ''}14px Galmuri11, monospace`; c.textBaseline = 'alphabetic'; c.fillStyle = INK;
    c.textAlign = 'right'; c.fillText(sideText(ln[0], ln[1]), cx - 9, y + 14);
    c.textAlign = 'center'; c.fillText('=', cx, y + 14);
    c.textAlign = 'left'; c.fillText(sideText(ln[2], ln[3]), cx + 9, y + 14);
    y += EQ;
  });
}

/** 통. 꺼낼 수 있을 때는 구슬이 담겨 보이고, 버리는 때는 비어 있다. */
function drawBin(c: CanvasRenderingContext2D, x: number, y: number, full: boolean) {
  c.fillStyle = INK; c.fillRect(x + 1, y + 8, 28, 5); c.fillRect(x + 3, y + 13, 24, 17);
  c.fillStyle = PALETTE.outline; c.fillRect(x + 5, y + 15, 20, 13);
  c.fillStyle = PALETTE.skyLow; c.fillRect(x + 7, y + 15, 3, 13);
  if (full) for (const [mx, my] of [[5, 1], [14, 0], [9, -6]]) drawItem(c, 'marble', x + mx, y + my, 9);
  else { c.fillStyle = INK; c.fillRect(x + 4, y + 9, 22, 3); }
}

/** 레버. 더하기·빼기 레버는 고른 쪽으로 눕고 그 말이 위에 적힌다. 나누기 레버는 걸리면 덜컹거린다. */
function drawLever(c: CanvasRenderingContext2D, w: World, l: { x: number; y: number; scale: number; does: 'addsub' | 'divide' }, now: number) {
  const sc = w.scales[l.scale];
  const lean = l.does === 'addsub' ? (sc.mode === 'sub' ? -1 : 1) : sc.shake > 0 ? Math.sign(Math.sin(now / 30)) : 0;
  c.fillStyle = INK; c.fillRect(l.x + 4, l.y + 22, 22, 8);
  c.fillStyle = PALETTE.outline; c.fillRect(l.x + 6, l.y + 24, 18, 3);
  for (let k = 0; k < 3; k++) { c.fillStyle = INK; c.fillRect(l.x + 13 + lean * k * 4, l.y + 15 - k * 6, 4, 8); }
  c.fillStyle = INK; c.fillRect(l.x + 10 + lean * 12, l.y - 5, 10, 10);
  c.fillStyle = l.does === 'divide' ? PALETTE.key : PALETTE.button; c.fillRect(l.x + 12 + lean * 12, l.y - 3, 6, 6);
  label(c, l.does === 'divide' ? '나누기' : sc.mode === 'sub' ? '빼기' : '더하기', l.x + 15, l.y + T + 20);   // 이름표는 받침 아래 땅에(머리 높이에 두면 도름이 번호표가 가린다)
}

function label(c: CanvasRenderingContext2D, text: string, x: number, y: number) {
  c.font = '700 12px Galmuri11, monospace'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const wd = Math.ceil(c.measureText(text).width) + 8;
  c.fillStyle = PALETTE.navy; c.fillRect(Math.round(x - wd / 2), Math.round(y - 12), wd, 16);
  c.fillStyle = PALETTE.paper; c.fillText(text, Math.round(x), Math.round(y));
}

/** 머리 위 표: 보통은 차례 번호, 교사가 승인한 닉네임이 있으면 그 닉네임(남이 쓴 글자라 열 글자로 자르고 글자로만 그린다). */
function tag(c: CanvasRenderingContext2D, p: Player, mine: boolean, lift = 0, name = '') {
  const x = Math.round(p.x + p.w / 2), y = Math.round(p.y - 8 - lift);
  const text = name ? [...name].slice(0, 10).join('') : String(p.i + 1), big = name ? 2 : 0;
  c.font = `700 ${10 + big}px Galmuri11, monospace`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const wd = Math.ceil(c.measureText(text).width) + 6;
  c.fillStyle = mine ? PALETTE.key : PALETTE.paper; c.fillRect(Math.round(x - wd / 2), y - 10 - big, wd, 12 + big + (name ? 1 : 0));
  c.fillStyle = PALETTE.navy; c.fillText(text, x, y);
}

// 표지 그림은 임시(점으로 직접 그림). 화풍에 맞는 그림으로 바꿀 자리.
function drawSign(c: CanvasRenderingContext2D, x: number, y: number) {
  c.fillStyle = PALETTE.door; c.fillRect(x + 13, y + 12, 4, 18);
  c.fillStyle = PALETTE.outline; c.fillRect(x + 3, y + 1, 24, 15);
  c.fillStyle = PALETTE.paper; c.fillRect(x + 5, y + 3, 20, 11);
  c.fillStyle = PALETTE.navy; c.fillRect(x + 8, y + 6, 14, 2); c.fillRect(x + 8, y + 10, 9, 2);
}

function bubble(c: CanvasRenderingContext2D, text: string, x: number, y: number) {
  c.font = '14px Galmuri11, monospace'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const wd = Math.ceil(c.measureText(text).width) + 16;
  c.fillStyle = PALETTE.navy; c.fillRect(Math.round(x - wd / 2) - 2, Math.round(y - 26) - 2, wd + 4, 28);
  c.fillStyle = PALETTE.paper; c.fillRect(Math.round(x - wd / 2), Math.round(y - 26), wd, 24);
  c.fillStyle = PALETTE.navy; c.fillText(text, Math.round(x), Math.round(y - 9));
}

export function render(c: CanvasRenderingContext2D, w: World, cam: Camera, now: number, me: number | null, names?: readonly string[]) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.imageSmoothingEnabled = false;
  c.drawImage(spr('bg'), 0, 0, VIEW_W, VIEW_H);
  c.setTransform(cam.scale, 0, 0, cam.scale, -Math.round(cam.x * cam.scale), -Math.round(cam.y * cam.scale));
  drawStage(c, w, now, me, names);
  c.setTransform(1, 0, 0, 1, 0, 0);
}

/** 카드의 맵 미리보기. 같은 그리기 코드로 스테이지 전체를 작게 그린다. */
export function renderPreview(canvas: HTMLCanvasElement, stage: Stage) {
  const c = canvas.getContext('2d')!;
  const sw = stage.cols * T, sh = stage.rows * T;
  const scale = Math.max(canvas.width / sw, canvas.height / sh);   // 카드 칸을 채운다(넘치는 쪽은 가운데 기준으로 자름)
  c.imageSmoothingEnabled = false;
  c.drawImage(spr('bg'), 0, 0, canvas.width, canvas.height);
  c.setTransform(scale, 0, 0, scale, Math.round((canvas.width - sw * scale) / 2), Math.round(canvas.height - sh * scale));
  const w = createWorld(stage, [{ color: '#F4F7FF' }, { color: '#FFB3C7' }, { color: '#A8DDF5' }]);
  w.players.forEach((p, i) => { p.x = stage.spawn.x + i * 26; p.y = stage.spawn.y - p.h; p.on = true; });
  drawStage(c, w, 0, null);
  c.setTransform(1, 0, 0, 1, 0, 0);
}

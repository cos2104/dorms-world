/**
 * 2D 협력 물리. 화면과 떼어 놓아 시험과 방장 계산에 그대로 쓴다.
 * 시안(design-lab/game.js)에서 형이 직접 해 본 움직임(속도·점프·서로 비켜 가기·머리 위 올라타기)을 옮겼다.
 */
import { T, resolveNeed, type Rect, type ScaleDef, type Stage } from './stage';
import { MAX_BOXES, MAX_MARBLES, commonDivisor, isolated, makeEquation, rng, sameLine, stepOf, type Line } from './equation';

export const G = 1900, SPEED = 175, JUMP = Math.sqrt(2 * G * 108), CRATE_SPEED = 55;
export const PW = 22, PH = 38;
export const JUMP_BUFFER = 0.2, COYOTE = 0.09;

/**
 * m 좌우, j 뛰기(누르고 있는 중), a 확인(열린 문에 들어가기).
 * jn 은 뛰기를 새로 누른 횟수(늘어나기만 한다). 뛰기 키 하나를 누른 채 다른 뛰기 키를 눌러도,
 * 한 프레임 안에 뗐다 다시 눌러도 '새로 누름'이 빠지지 않게 조작 쪽에서 세어 보낸다. 없으면 j 가 바뀌는 순간으로 본다.
 * 한 사람의 조작은 jn 을 늘 넣거나 늘 빼거나 한 가지로 보낸다(섞어 보내지 않는다).
 */
export type Pad = { m: -1 | 0 | 1; j: boolean; a?: boolean; jn?: number };
export const NO_PAD: Pad = { m: 0, j: false };

export type Player = Rect & {
  i: number;              // 들어온 차례(0부터). 표지 글과 번호표에 쓴다
  color: string;
  vx: number; vy: number;
  on: boolean;            // 무언가를 딛고 있다
  side: 'left' | 'right' | null;
  turnT: number;          // 방향을 바꾼 직후 정면을 보여 주는 남은 시간
  walk: number;
  pressing: -1 | 0 | 1;   // 상자를 미는 방향
  pressCrate: number;
  jumpHeld: boolean;
  jn: number | null;       // 마지막으로 본 뛰기 누름 횟수
  jumpBuf: number;         // 뛰기를 누른 뒤 기억하는 남은 시간(착지 직전에 눌러도 착지하면 뛴다)
  coyote: number;          // 발이 떨어진 뒤에도 뛸 수 있는 남은 시간(턱 끝에서 살짝 늦게 눌러도 뛴다)
  aHeld: boolean;          // 확인 단추를 누르고 있는 중
  aNew: boolean;           // 이번 걸음에 확인을 새로 눌렀다
  carry: Carry | null;     // 머리 위로 든 구슬이나 상자(한 번에 하나)
  doorLock: boolean;       // 문을 막 드나든 뒤, 확인에서 손을 뗄 때까지 다시 드나들지 않는다
  want: -1 | 0 | 1;        // 이번 걸음에 가려던 방향
  inDoor: boolean;
};

export type Crate = Rect & { vy: number; need: number; pushers: number };

export type Item = 'box' | 'marble';
/** from: 0 왼쪽 접시, 1 오른쪽 접시, -1 통에서 꺼낸 것. 떨어지거나 방을 나가면 꺼낸 접시로 돌아간다. */
export type Carry = { kind: Item; scale: number; from: 0 | 1 | -1 };

/**
 * 저울 하나의 지금 모습. 상자 하나가 x, 구슬 하나가 1이다(x 는 화면에 보이지 않는다).
 * 한쪽만 손대면 기울고, 양쪽에 같은 일을 하면 다시 수평이 된다. 수평이 될 때마다 풀이 판에 한 줄이 적힌다.
 */
export type ScaleState = {
  x: number;
  line: Line;                 // 접시 위: [왼 상자, 왼 구슬, 오른 상자, 오른 구슬]. 구슬 수가 음수면 그만큼 풍선
  mode: 'sub' | 'add';        // 더하기·빼기 레버의 자리(통이 버리는 곳인지 꺼내는 곳인지)
  tilt: -1 | 0 | 1;           // -1 왼쪽이 무겁다, 1 오른쪽이 무겁다
  lean: number;               // 그리기용. tilt 를 부드럽게 따라간다
  tiltT: number;              // 기운 채로 지난 시간
  calm: number;               // 수평으로 지난 시간
  lines: Line[];              // 풀이 판. 마지막 줄이 쏟아졌을 때 돌아갈 자리다
  solved: boolean;            // x 만 남았다
  shake: number;              // 레버가 걸려 덜컹거리는 남은 시간
  note: string; noteT: number;
};
export const BOX_PART = 0.4;  // 접시의 왼쪽 이만큼이 상자 칸, 나머지가 구슬 칸
const CALM = 0.5;             // 이만큼 수평이 이어져야 한 줄로 친다(스쳐 지나가는 수평은 적지 않는다)
const HOLD = 1.5;             // x 만 남은 채 이만큼 가만히 수평이어야 풀린 것으로 친다(마구 누르다 스친 것은 치지 않는다)

export type World = {
  stage: Stage;
  players: Player[];
  crates: Crate[];
  needs: number[];                 // 단추별 필요 인원(방 인원으로 풀어 둔 값)
  pressed: number[];               // 단추별 지금 밟은 사람 수
  active: Set<string>;             // 켜진 다리 글자
  key: { x: number; y: number; holder: number | null; used: boolean };
  scales: ScaleState[];
  doorOpen: boolean;
  won: boolean;
  t: number;
};

export const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** seed 는 저울의 식을 뽑는 씨앗이다. 같은 씨앗이면 같은 식이 나온다. */
export function createWorld(stage: Stage, players: { color: string }[], seed = 1): World {
  const n = players.length;
  return {
    stage,
    players: players.map((p, i) => spawnPlayer(stage, i, p.color)),
    crates: stage.crates.map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h, vy: 0, need: resolveNeed(c.need, n), pushers: 0 })),
    needs: stage.buttons.map(b => resolveNeed(b.need, n)),
    pressed: stage.buttons.map(() => 0),
    active: new Set(),
    key: { x: stage.key!.x, y: stage.key!.y, holder: null, used: false },
    scales: stage.scales.map((def, si) => {
      const eq = makeEquation(def.spec, rng(seed * 7919 + si * 104729 + 17));
      return { x: eq.x, line: eq.line, mode: 'add', tilt: 0, lean: 0, tiltT: 0, calm: 0, lines: [[...eq.line] as Line], solved: false, shake: 0, note: '', noteT: 0 };
    }),
    doorOpen: false, won: false, t: 0,
  };
}

const cellSolid = (stage: Stage, c: number, r: number) => c < 0 || c >= stage.cols || r < 0 || (r < stage.rows && !!stage.solid[r * stage.cols + c]);

/** 그 자리에 설 수 있는가: 지도 안이고, 몸이 땅과 안 겹치고, 발밑에 땅이 있다. */
function standable(stage: Stage, x: number, y: number) {
  if (x < 0 || x + PW > stage.cols * T || y < 0) return false;
  const me = { x, y, w: PW, h: PH };
  for (const b of stage.crates) if (overlap(me, b)) return false;                                   // 상자 자리에는 세우지 않는다
  // 단추·다리·열쇠·문 자리에도 세우지 않는다(시작하자마자 단추가 눌리거나 열쇠를 줍지 않게)
  for (const b of stage.buttons) if (overlap(me, { x: b.x - 3, y: b.y - T, w: b.w + 6, h: T + 8 })) return false;
  for (const b of stage.bridges) for (const [c, r] of b.cells) if (overlap(me, { x: c * T, y: r * T, w: T, h: T })) return false;
  if (stage.key && overlap(me, { x: stage.key.x, y: stage.key.y, w: 32, h: 18 })) return false;
  if (stage.door && overlap(me, stage.door)) return false;
  const c0 = Math.floor(x / T), c1 = Math.floor((x + PW - 0.01) / T), r0 = Math.floor(y / T), r1 = Math.floor((y + PH - 0.01) / T);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (cellSolid(stage, c, r)) return false;
  const fr = Math.floor((y + PH + 1) / T);
  for (let c = c0; c <= c1; c++) if (fr < stage.rows && stage.solid[fr * stage.cols + c]) return true;
  return false;
}

const slotCache = new WeakMap<Stage, { x: number; y: number }[]>();

/**
 * 시작 자리 목록. @ 에서 오른쪽으로 설 수 있는 데까지 한 줄(열 명), 그 머리 위로 두 줄,
 * 그래도 모자라면 바닥 줄을 오른쪽으로 더 잇는다. 벽·구덩이·상자를 만나면 거기서 줄이 끝난다.
 */
function slots(stage: Stage) {
  const hit = slotCache.get(stage); if (hit) return hit;
  const bx = stage.spawn.x + 4, by = stage.spawn.y - PH - 1;
  const ground: number[] = [];
  for (let k = 0; k < 30; k++) { const x = bx + k * 24; if (k > 0 && !standable(stage, x, by)) break; ground.push(x); }
  for (let k = 1; ground.length < 30; k++) { const x = bx - k * 24; if (!standable(stage, x, by)) break; ground.push(x); }   // 오른쪽이 막히면 왼쪽으로도 잇는다
  const out = ground.slice(0, 10).map(x => ({ x, y: by }));
  for (let row = 1; row <= 2; row++) for (const x of ground.slice(0, 10)) {
    const y = by - row * (PH + 1);
    const c0 = Math.floor(x / T), c1 = Math.floor((x + PW - 0.01) / T);
    let free = y >= 0;
    for (let r = Math.floor(y / T); free && r <= Math.floor((y + PH - 0.01) / T); r++) for (let c = c0; c <= c1; c++) if (cellSolid(stage, c, r)) free = false;
    // 아래 줄에 그 칸이 있어야 딛고 선다
    if (free && out.some(sl => sl.x === x && sl.y === y + PH + 1)) out.push({ x, y });
  }
  for (const x of ground.slice(10)) out.push({ x, y: by });
  slotCache.set(stage, out);
  return out;
}

/** i 번째 도름이가 설 자리. 자리가 모자라면 시작 칸 안에 겹쳐 서고, 겹친 사람끼리는 조금씩 떨어진다. */
export function spawnAt(stage: Stage, i: number) {
  const list = slots(stage);
  return list[i] ?? { x: stage.spawn.x + (i % 3) * 4, y: stage.spawn.y - PH - 1 };
}

function spawnPlayer(stage: Stage, i: number, color: string): Player {
  const at = spawnAt(stage, i);
  return {
    i, color, x: at.x, y: at.y, w: PW, h: PH,
    vx: 0, vy: 0, on: false, side: null, turnT: 0, walk: 0, pressing: 0, pressCrate: -1, jumpHeld: false, jn: null, jumpBuf: 0, coyote: 0, aHeld: false, aNew: false, carry: null, doorLock: false, want: 0, inDoor: false,
  };
}

/** 사람이 늘거나 줄면 필요 인원을 다시 푼다(늦게 들어온 사람, 나간 사람). */
export function setPlayerCount(w: World, colors: string[]) {
  while (w.players.length < colors.length) w.players.push(spawnPlayer(w.stage, w.players.length, colors[w.players.length]));
  if (w.players.length > colors.length) {
    if (w.key.holder != null && w.key.holder >= colors.length) dropKey(w);
    for (const p of w.players.slice(colors.length)) returnCarry(w, p);
    w.players.length = colors.length;
  }
  w.players.forEach((p, i) => { p.color = colors[i]; });
  const n = w.players.length;
  w.stage.crates.forEach((c, i) => { w.crates[i].need = resolveNeed(c.need, n); });
  w.needs = w.stage.buttons.map(b => resolveNeed(b.need, n));
}

/**
 * 가운데 사람이 나갔다: 그 도름이만 빼고 뒤 번호를 하나씩 당긴다(남은 도름이의 색과 자리는 그대로).
 * 열쇠를 들고 있었으면 내려놓는다(땅을 딛고 있었으면 그 발밑에, 공중이었으면 처음 자리로).
 * 든 구슬이나 상자는 꺼낸 접시로 돌아간다.
 */
export function removePlayer(w: World, i: number) {
  const p = w.players[i];
  if (!p) return;
  if (w.key.holder === i) {
    if (p.on && !p.inDoor) { w.key.holder = null; w.key.x = p.x + p.w / 2 - 16; w.key.y = p.y + p.h - 18; }
    else dropKey(w);
  } else if (w.key.holder != null && w.key.holder > i) w.key.holder--;
  returnCarry(w, p);
  w.players.splice(i, 1);
  w.players.forEach((q, k) => { q.i = k; });
  const n = w.players.length;
  w.stage.crates.forEach((c, k) => { w.crates[k].need = resolveNeed(c.need, n); });
  w.needs = w.stage.buttons.map(b => resolveNeed(b.need, n));
}

/** 들고 있던 것을 내려놓는다. 접시에서 꺼낸 것은 그 접시로 돌아간다(식이 사라지지 않게). */
function returnCarry(w: World, p: Player) {
  const c = p.carry; p.carry = null;
  if (!c || c.from < 0) return;
  const sc = w.scales[c.scale];
  const k = c.from * 2 + (c.kind === 'box' ? 0 : 1);
  if (sc && !sc.solved && sc.line[k] < (c.kind === 'box' ? MAX_BOXES : MAX_MARBLES)) sc.line[k]++;   // 그새 접시가 가득 찼으면 버린 셈 친다
}

function dropKey(w: World) { w.key.holder = null; w.key.x = w.stage.key!.x; w.key.y = w.stage.key!.y; }

export function bridgeSolid(w: World, ch: string, mode: 'appear' | 'vanish') {
  return mode === 'appear' ? w.active.has(ch) : !w.active.has(ch);
}

function tileSolid(w: World, c: number, r: number) {
  const s = w.stage;
  if (c < 0 || c >= s.cols || r < 0) return true;
  if (r >= s.rows) return false;
  return !!s.solid[r * s.cols + c];
}

/** 다리 칸 가운데 지금 막힌 칸과 겹치는가. */
function hitsBridge(w: World, r: Rect) {
  for (const b of w.stage.bridges) {
    if (!bridgeSolid(w, b.ch, b.mode)) continue;
    for (const [c, rr] of b.cells) if (overlap(r, { x: c * T, y: rr * T, w: T, h: T })) return true;
  }
  return false;
}

function hitsTiles(w: World, r: Rect) {
  const c0 = Math.floor(r.x / T), c1 = Math.floor((r.x + r.w - 0.01) / T);
  const r0 = Math.floor(r.y / T), r1 = Math.floor((r.y + r.h - 0.01) / T);
  for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) if (tileSolid(w, cc, rr)) return true;
  return false;
}

function crateAt(w: World, r: Rect, skip = -1) {
  for (let i = 0; i < w.crates.length; i++) if (i !== skip && overlap(r, w.crates[i])) return i;
  return -1;
}

/** 사람이 막히는가. 다리가 갑자기 생긴 자리에 이미 들어가 있던 사람은 빠져나올 수 있게 한다. */
function blocked(w: World, r: Rect, insideBridge: boolean) {
  return hitsTiles(w, r) || crateAt(w, r) >= 0 || (!insideBridge && hitsBridge(w, r));
}

/**
 * 도름이끼리는 서로 막힌다(옆으로 못 지나가고, 머리는 딛고 설 수 있다). 지나가려면 뛰어넘는다.
 * 이미 겹쳐 있는 친구(같은 칸에서 시작했거나 상자에 밀려 겹친 경우)에게서는 빠져나올 수 있다.
 */
function otherAt(w: World, p: Player, r: Rect): Player | null {
  for (const q of w.players) {
    if (q === p || q.inDoor || !overlap(r, q) || overlap(p, q)) continue;
    return q;
  }
  return null;
}

/** 한 번에 1/60초보다 길게 건너뛰지 않는다(긴 걸음 한 번에 바닥을 뚫지 않게 잘게 나눈다). */
export function step(w: World, pads: (Pad | undefined)[], dt: number) {
  for (let left = Math.min(dt, 0.25); left > 1e-6; left -= 1 / 60) tick(w, pads, Math.min(left, 1 / 60));
}

function tick(w: World, pads: (Pad | undefined)[], dt: number) {
  if (w.won) return;
  w.t += dt;
  const stage = w.stage;
  for (const p of w.players) { const a = !!pads[p.i]?.a; p.aNew = a && !p.aHeld; p.aHeld = a; }
  for (const p of w.players) {
    if (p.inDoor) continue;
    const { m, j, jn } = pads[p.i] ?? NO_PAD;
    p.vx = m * SPEED;
    if (m) { const side = m > 0 ? 'right' : 'left'; if (side !== p.side) { p.side = side; p.turnT = 0.18; } }
    if (p.turnT > 0) p.turnT -= dt;
    p.pressing = 0; p.pressCrate = -1; p.want = m;
    // 뛰기: 누른 순간을 잠깐 기억하고(JUMP_BUFFER), 발이 막 떨어진 직후에도 받아 준다(COYOTE).
    // 착지 몇 프레임 전에 누르거나 턱에 막혀 연달아 뛸 때 누름이 버려지지 않게 한다.
    // 공중에서 미리 눌러 그대로 누르고 있으면 착지하자마자 뛴다(기억은 손을 뗀 뒤부터 줄어든다).
    // 한 번 누름에 한 번만 뛴다: 누르고 있는 동안 저절로 다시 뛰지는 않는다.
    const pressed = jn != null && p.jn != null ? jn !== p.jn : j && !p.jumpHeld;
    p.jn = jn ?? null;   // 조작이 끊긴 동안(다른 도름이를 움직이는 중, 신호가 빠진 걸음)에는 기준을 지운다. 돌아온 첫 걸음은 횟수 대신 '누르고 있나'가 바뀐 것으로 본다
    if (pressed) p.jumpBuf = JUMP_BUFFER;
    p.jumpHeld = j;
    p.coyote = p.on ? COYOTE : p.coyote - dt;
    if (p.jumpBuf > 0 && p.coyote > 0) { p.vy = -JUMP; p.on = false; p.jumpBuf = 0; p.coyote = 0; }
    else if (p.jumpBuf > 0 && !j) p.jumpBuf -= dt;
    p.vy = Math.min(p.vy + G * dt, 900);
    const inside = hitsBridge(w, p);

    // 가로: 막히면 제자리에 서지 않고 맞닿는 자리까지 다가간다(틈이 남으면 밀기 판정이 흔들린다)
    const nx = p.x + p.vx * dt;
    const free = (x: number) => { const r = { x, y: p.y, w: p.w, h: p.h }; return !blocked(w, r, inside) && !otherAt(w, p, r); };
    if (!m || free(nx)) p.x = nx;
    else { let x = p.x; while (Math.abs(x + m - p.x) <= Math.abs(nx - p.x) + 1 && free(x + m)) x += m; if (free(x)) p.x = x; }

    // 세로
    const ny = p.y + p.vy * dt;
    const ry = { x: p.x, y: ny, w: p.w, h: p.h };
    const touch = otherAt(w, p, ry);
    const under = p.vy > 0 ? touch : null;
    const onHead = !!under && p.y + p.h <= under.y + 2;
    const bonk = p.vy < 0 && !!touch && touch.y + touch.h <= p.y + 2;   // 머리 위에 친구가 서 있으면 못 뛰어오른다
    if (blocked(w, ry, inside) || onHead || bonk) {
      if (p.vy > 0) {
        p.on = true;
        let y = p.y;
        while (y < ny && !blocked(w, { x: p.x, y: y + 1, w: p.w, h: p.h }, inside) && !(onHead && y + 1 + p.h > under!.y)) y += 1;
        // 1px 걸음으로 다가가면 1px 안쪽 틈이 남는다. 땅·다리·상자 윗면은 정수 자리라 발을 그 면에, 친구 머리 위면 머리에 딱 붙인다.
        // 떠 있는 틈이 사람마다 달라서 머리 위 친구가 옆에서 다가오는 사람과 '겹친다'고 잘못 판정되던 것을 막는다.
        const snap = onHead ? under!.y - p.h : Math.ceil(y + p.h - 1e-6) - p.h;
        if (snap > y && snap - y < 1 + 1e-6 && !blocked(w, { x: p.x, y: snap, w: p.w, h: p.h }, inside) && !(onHead ? false : otherAt(w, p, { x: p.x, y: snap, w: p.w, h: p.h }))) y = snap;
        p.y = y;
      }
      p.vy = 0;
    } else { p.y = ny; p.on = false; }
    if (Math.abs(p.vx) > 0 && p.on) p.walk += dt * 10; else p.walk *= 0.8;

    if (p.y > stage.rows * T + 60) { // 떨어지면 시작 자리로
      const at = spawnAt(stage, p.i);
      p.x = at.x; p.y = at.y; p.vx = 0; p.vy = 0; p.jumpBuf = 0;   // 누른 채 떨어졌어도 되살아난 자리에서 저절로 뛰지 않는다
      if (w.key.holder === p.i) dropKey(w);
      returnCarry(w, p);
    }
  }

  // 상자: 한쪽에서 미는 사람이 맞은편보다 필요 인원만큼 많아야 움직인다(같은 수로 맞서면 멈춘다)
  w.crates.forEach((b, ci) => {
    const r = pushers(w, ci, 1), l = pushers(w, ci, -1);
    const dir: -1 | 0 | 1 = r.length > l.length ? 1 : l.length > r.length ? -1 : 0, count = Math.abs(r.length - l.length);
    for (const p of dir > 0 ? r : dir < 0 ? l : []) { p.pressing = dir as -1 | 1; p.pressCrate = ci; }
    b.pushers = count;
    const solidUnder = (rect: Rect) => hitsTiles(w, rect) || hitsBridge(w, rect) || crateAt(w, rect, ci) >= 0;
    if (solidUnder({ x: b.x + 1, y: b.y + b.h, w: b.w - 2, h: 1 }) && dir && count >= b.need) {
      const dx = dir * CRATE_SPEED * dt;
      const nb = { x: b.x + dx, y: b.y, w: b.w, h: b.h };
      // 상자 앞에 선 사람은 같이 밀려 간다. 그 사람이 벽에 막혀 더 못 가면 상자도 멈춘다(사람이 상자에 묻히지 않게).
      const ahead = w.players.filter(p => !p.inDoor && overlap(p, nb) && !overlap(p, b));
      const squeezed = ahead.some(p => { const m = { x: p.x + dx, y: p.y, w: p.w, h: p.h }; const q = otherAt(w, p, m); return hitsTiles(w, m) || hitsBridge(w, m) || crateAt(w, m, ci) >= 0 || (!!q && !ahead.includes(q)); });
      // 다리가 상자 자리에 갑자기 생겼으면(단추로 켜짐) 사람처럼 빠져나올 수 있게 한다. 아니면 다리가 꺼질 때까지 상자가 박혀 있었다
      const stuck = hitsBridge(w, b);
      if (!hitsTiles(w, nb) && (stuck || !hitsBridge(w, nb)) && crateAt(w, nb, ci) < 0 && !squeezed) {
        for (const p of ahead) { const m = { x: p.x + dx, y: p.y, w: p.w, h: p.h }; if (!hitsTiles(w, m)) p.x += dx; }
        // 상자에 탄 사람은 같이 간다. 다리나 다른 친구에 막히면 그 사람만 제자리에 남는다(몸이 겹치지 않게). 앞사람부터 옮겨야 붙어 선 줄이 끊기지 않는다
        const riders = w.players.filter(p => !p.inDoor && p.on && p.x + p.w > b.x && p.x < b.x + b.w && Math.abs(p.y + p.h - b.y) < 2).sort((p, q) => (q.x - p.x) * dir);
        for (const p of riders) { const m = { x: p.x + dx, y: p.y, w: p.w, h: p.h }; if (!hitsTiles(w, m) && !hitsBridge(w, m) && !otherAt(w, p, m)) p.x += dx; }
        b.x = nb.x;
      }
    }
    // 아래가 비면 떨어진다. 구멍 폭이 상자와 같을 때 쏙 들어가도록 칸에 맞춘다
    const below = { x: b.x + 5, y: b.y + b.h, w: b.w - 10, h: 2 };
    if (!solidUnder(below)) {
      if (b.vy === 0) b.x = Math.round(b.x / T) * T;
      b.vy = Math.min(b.vy + G * dt, 600);
      let ny = b.y + b.vy * dt;
      if (solidUnder({ x: b.x, y: ny, w: b.w, h: b.h })) { ny = Math.floor((ny + b.h) / T) * T - b.h; b.vy = 0; }
      b.y = ny;
      if (b.y > stage.rows * T + 60) { const home = stage.crates[ci]; b.x = home.x; b.y = home.y; b.vy = 0; }   // 지도 아래로 빠진 상자는 처음 자리로
    } else b.vy = 0;
  });

  // 안전망: 그래도 상자와 겹친 사람(떨어진 상자에 깔림 등)은 그 상자 위 빈 자리로 올려 준다
  for (const p of w.players) {
    if (p.inDoor) continue;
    const ci = crateAt(w, p);
    if (ci < 0) continue;
    const b = w.crates[ci];
    const okAt = (x: number) => { const r = { x, y: b.y - p.h, w: p.w, h: p.h }; return !hitsTiles(w, r) && crateAt(w, r) < 0 && !w.players.some(q => q !== p && !q.inDoor && overlap(r, q)); };
    const near = Math.max(b.x, Math.min(b.x + b.w - p.w, p.x));
    let spot: number | null = null;
    for (let d = 0; d <= b.w && spot == null; d += 4) for (const x of [near + d, near - d]) if (x >= b.x - p.w / 2 && x <= b.x + b.w - p.w / 2 && okAt(x)) { spot = x; break; }
    if (spot != null) { p.x = spot; p.y = b.y - p.h; p.vy = 0; }
    else { const at = spawnAt(stage, p.i); p.x = at.x; p.y = at.y; p.vx = 0; p.vy = 0; p.jumpBuf = 0; if (w.key.holder === p.i) dropKey(w); returnCarry(w, p); }
  }

  // 겹친 도름이끼리는 조금씩 떨어진다(같은 칸에서 시작했거나 되살아난 자리에 친구가 있던 경우). 갈 곳이 막혀 있으면 그대로 둔다.
  for (let a = 0; a < w.players.length; a++) for (let c = a + 1; c < w.players.length; c++) {
    const p = w.players[a], q = w.players[c];
    if (p.inDoor || q.inDoor || !overlap(p, q)) continue;
    if (Math.abs(p.y - q.y) > p.h - 4) continue;                       // 머리 위에 막 올라서는 중이면 건드리지 않는다
    const [left, right] = p.x < q.x || (p.x === q.x && p.i < q.i) ? [p, q] : [q, p];
    const mv = (o: Player, d: number) => { const r = { x: o.x + d, y: o.y, w: o.w, h: o.h }; if (!hitsTiles(w, r) && !hitsBridge(w, r) && crateAt(w, r) < 0) o.x += d; };
    mv(left, -0.5); mv(right, 0.5);
  }

  scaleTick(w, dt);

  // 단추와 다리
  w.active = new Set();
  stage.buttons.forEach((btn, bi) => {
    const n = w.players.filter(p => !p.inDoor && p.on && overlap({ x: p.x, y: p.y + 2, w: p.w, h: p.h }, btn)).length;
    w.pressed[bi] = n;
    if (n >= w.needs[bi]) for (const ch of btn.opens) w.active.add(ch);
  });
  w.scales.forEach((sc, si) => { if (sc.solved) for (const ch of stage.scales[si].opens) w.active.add(ch); });

  // 열쇠와 문
  const k = w.key, door = stage.door!;
  if (!k.used) {
    if (k.holder == null) {
      for (const p of w.players) if (!p.inDoor && overlap(p, { x: k.x, y: k.y, w: 32, h: 18 })) { k.holder = p.i; break; }
    } else {
      const p = w.players[k.holder];
      if (!p) dropKey(w);
      else {
        k.x = p.x + p.w / 2 - 16; k.y = p.y - 26;
        if (overlap(p, door)) { w.doorOpen = true; k.used = true; k.holder = null; }
      }
    }
  }
  if (w.doorOpen) {
    for (const p of w.players) {
      const a = p.aHeld, pressed = p.aNew;
      if (!a) p.doorLock = false;
      // 확인을 누른 채 문 앞에 서면 들어간다. 문 안에서 확인을 새로 누르면 다시 나온다(먼저 들어간 친구가 도우러 나올 수 있다).
      if (!p.inDoor && a && !p.doorLock && atDoor(w, p)) { returnCarry(w, p); p.inDoor = true; p.doorLock = true; p.vx = 0; p.vy = 0; }
      else if (p.inDoor && pressed) { p.inDoor = false; p.doorLock = true; p.x = door.x + door.w / 2 - p.w / 2; p.y = door.y + door.h - p.h; p.vx = 0; p.vy = 0; }
    }
    if (w.players.length > 0 && w.players.every(p => p.inDoor)) w.won = true;
  }
}

/**
 * 상자를 d 쪽으로 미는 사람들. 처리 순서와 상관없이 맞닿음으로만 센다:
 * 상자 면에 붙어 그쪽을 누르는 사람, 그리고 그 사람 등에 붙어 같은 쪽을 누르는 사람(줄 서서 밀기).
 * 줄 가운데 누군가 누르지 않으면 그 뒤는 세지 않는다.
 */
function pushers(w: World, ci: number, d: -1 | 1): Player[] {
  const b = w.crates[ci], GAP = 1.6;
  const cand = w.players.filter(p => !p.inDoor && p.want === d);
  const vert = (a: Rect, c: Rect) => a.y + a.h > c.y + 2 && a.y < c.y + c.h - 2;
  const front = (p: Player) => (d > 0 ? p.x + p.w : p.x), back = (p: Player) => (d > 0 ? p.x : p.x + p.w);
  const edge = d > 0 ? b.x : b.x + b.w;
  // 상자 위에 선 친구가 미는 쪽 끝으로 걸쳐 있으면 그 친구의 몸이 상자 면 앞을 막는다. 그 친구 등에 붙어 누르는 사람도 상자를 미는 것으로 센다.
  const riders = w.players.filter(p => !p.inDoor && p.on && Math.abs(p.y + p.h - b.y) < 2 && (d > 0 ? p.x < b.x && p.x + p.w > b.x : p.x + p.w > b.x + b.w && p.x < b.x + b.w));
  const chain = cand.filter(p => !riders.includes(p) && (vert(p, b) && Math.abs(front(p) - edge) <= GAP || riders.some(r => vert(p, r) && Math.abs(front(p) - back(r)) <= GAP)));
  for (let grew = true; grew;) {
    grew = false;
    for (const q of cand) if (!chain.includes(q) && !riders.includes(q) && chain.some(s => vert(q, s) && Math.abs(front(q) - back(s)) <= GAP)) { chain.push(q); grew = true; }
  }
  return chain;
}

// ---------- 저울 ----------

/** 접시 밑에 서서 손이 닿는 자리(접시 칸부터 땅까지). */
export const panZone = (def: ScaleDef, side: 0 | 1): Rect => ({ x: def.pans[side].x, y: def.pans[side].y, w: def.pans[side].w, h: def.floor - def.pans[side].y });
const beside = (p: Rect, r: Rect) => overlap(p, { x: r.x - 6, y: r.y - T, w: r.w + 12, h: r.h + T });

export type Action =
  | { do: 'lever'; lever: number }
  | { do: 'place' | 'take'; scale: number; side: 0 | 1; kind: Item }
  | { do: 'discard' | 'draw'; scale: number }
  | { do: 'no'; scale: number; why: string };

/** 지금 자리에서 확인을 누르면 일어날 일. 화면의 안내 글과 실제 동작이 같은 판단을 쓴다. */
export function actionAt(w: World, p: Player): Action | null {
  const s = w.stage;
  if (p.inDoor || atDoor(w, p)) return null;
  for (let i = 0; i < s.levers.length; i++) if (!w.scales[s.levers[i].scale].solved && beside(p, s.levers[i])) return { do: 'lever', lever: i };
  for (const b of s.bins) {
    const sc = w.scales[b.scale], free = !s.scales[b.scale].hasAddSub;
    if (sc.solved || !beside(p, b)) continue;
    if (p.carry && p.carry.scale !== b.scale) return { do: 'no', scale: b.scale, why: NOTE.otherBin };   // 남의 통에 버려 레버를 건너뛰지 못하게
    if (p.carry) return free || sc.mode === 'sub' ? { do: 'discard', scale: b.scale } : { do: 'no', scale: b.scale, why: NOTE.addOnly };
    return free || sc.mode === 'add' ? { do: 'draw', scale: b.scale } : { do: 'no', scale: b.scale, why: NOTE.subOnly };
  }
  for (let si = 0; si < s.scales.length; si++) {
    const sc = w.scales[si], def = s.scales[si];
    if (sc.solved) continue;
    for (const side of [0, 1] as const) {
      if (!overlap(p, panZone(def, side))) continue;
      const boxes = sc.line[side * 2], marbles = sc.line[side * 2 + 1];
      if (p.carry) {
        if (p.carry.scale !== si) return { do: 'no', scale: si, why: NOTE.otherScale };
        if (p.carry.kind === 'box' ? boxes >= MAX_BOXES : marbles >= MAX_MARBLES) return { do: 'no', scale: si, why: NOTE.full };
        return { do: 'place', scale: si, side, kind: p.carry.kind };
      }
      const atBoxes = p.x + p.w / 2 < def.pans[side].x + def.pans[side].w * BOX_PART;
      if (!atBoxes && marbles < 0) return { do: 'no', scale: si, why: NOTE.balloon };
      const kind: Item | null = atBoxes ? (boxes ? 'box' : marbles > 0 ? 'marble' : null) : (marbles > 0 ? 'marble' : boxes ? 'box' : null);
      return kind ? { do: 'take', scale: si, side, kind } : null;
    }
  }
  return null;
}

/**
 * 저울 알림 글은 모두 여기에 있다. 손님에게는 글이 아니라 이 목록의 번호가 간다(platform/sync.ts):
 * 방장 기기가 다른 사람 화면에 아무 글이나 띄우지 못하게, 화면에 뜨는 글은 그 기기의 코드가 만든 것뿐이다.
 * 알림 글을 새로 지을 때는 반드시 여기에 더한다.
 */
export const NOTE = {
  otherBin: '다른 저울의 통이에요', addOnly: '지금은 더하기라 버릴 수 없어요', subOnly: '지금은 빼기라 꺼낼 수 없어요',
  otherScale: '다른 저울에서 가져온 것이에요', full: '접시가 가득 찼어요', balloon: '풍선은 뗄 수 없어요. 구슬을 올리면 하나씩 터져요',
  sameBoxes: '양쪽 상자 수가 같으면 x 를 알 수 없어요', tilted: '저울이 기울어 있으면 나눌 수 없어요', uneven: '똑같이 나눌 수 없어요',
  spilled: '저울이 쏟아져서 처음 식으로 돌아갔어요',
} as const;
export const NOTE_LIST: readonly string[] = Object.values(NOTE);
export const dividedNote = (g: number) => `${g}묶음으로 나눠 한 묶음만 남겼어요`;

const say = (sc: ScaleState, text: string) => { sc.note = text; sc.noteT = 2.2; };

/**
 * 접시를 되돌린다. 그 저울의 것을 들고 있던 손도 비운다.
 * toStart 면 처음 식으로(풀이 판도 첫 줄만 남긴다), 아니면 마지막으로 수평이던 줄로.
 */
function revert(w: World, si: number, why: string, toStart = false) {
  const sc = w.scales[si];
  if (toStart) sc.lines.length = 1;
  sc.line = [...sc.lines[sc.lines.length - 1]] as Line;
  for (const p of w.players) if (p.carry?.scale === si) p.carry = null;
  sc.tiltT = 0; sc.calm = 0; say(sc, why);
}

/**
 * 수평인 지금의 식을 풀이 판에 적는다. 같은 갈래의 일(구슬 더하고 빼기, 상자 더하고 빼기)을 이어서 하면
 * 앞 줄에서 본 순 결과 한 줄로 모으고(1씩 세 번 빼면 '3을 뺀다'), 앞 줄로 되돌아가면 줄을 지운다.
 * 양쪽 상자 수가 같아 x 를 알 수 없으면 적지 않고 앞 줄로 되돌린다(false).
 */
function record(w: World, si: number): boolean {
  const sc = w.scales[si], n = sc.lines.length, last = sc.lines[n - 1], cur = sc.line;
  if (sameLine(cur, last)) return true;
  if (cur[0] === cur[2]) { revert(w, si, NOTE.sameBoxes); return false; }
  const before = sc.lines[n - 2];
  const family = (k: string) => (k === 'sub' || k === 'add' ? 'm' : k === 'subx' || k === 'addx' ? 'x' : '');
  if (before && sameLine(cur, before)) sc.lines.pop();
  else if (before && family(stepOf(before, last).kind) && family(stepOf(before, last).kind) === family(stepOf(before, cur).kind)) sc.lines[n - 1] = [...cur] as Line;
  else sc.lines.push([...cur] as Line);
  if (sc.lines.length > 8) sc.lines.splice(1, 1);
  return true;
}

function scaleTick(w: World, dt: number) {
  const s = w.stage;
  for (const p of w.players) {
    if (!p.aNew || p.inDoor) continue;
    const act = actionAt(w, p);
    if (!act) continue;
    if (act.do === 'no') { say(w.scales[act.scale], act.why); continue; }
    if (act.do === 'lever') {
      const lever = s.levers[act.lever], sc = w.scales[lever.scale];
      if (lever.does === 'addsub') { sc.mode = sc.mode === 'add' ? 'sub' : 'add'; continue; }
      // 나누기: 수평일 때, 접시 위 모든 묶음이 똑같이 나뉠 때만 된다
      const g = commonDivisor(sc.line);
      if (sc.tilt !== 0) { sc.shake = 0.5; say(sc, NOTE.tilted); }
      else if (g <= 1) { sc.shake = 0.5; say(sc, NOTE.uneven); }
      else if (record(w, lever.scale)) { sc.line = sc.line.map(v => v / g) as Line; sc.calm = 0; say(sc, dividedNote(g)); }   // 방금 수평이 된 식을 먼저 적고 나눈다(빼기 줄이 빠지지 않게)
      continue;
    }
    const sc = w.scales[act.scale];
    if (act.do === 'place') { sc.line[act.side * 2 + (act.kind === 'box' ? 0 : 1)]++; p.carry = null; }
    else if (act.do === 'take') { sc.line[act.side * 2 + (act.kind === 'box' ? 0 : 1)]--; p.carry = { kind: act.kind, scale: act.scale, from: act.side }; }
    else if (act.do === 'discard') p.carry = null;
    else p.carry = { kind: 'marble', scale: act.scale, from: -1 };
  }

  w.scales.forEach((sc, si) => {
    const def = s.scales[si];
    if (sc.noteT > 0) sc.noteT -= dt;
    if (sc.shake > 0) sc.shake -= dt;
    const left = sc.line[0] * sc.x + sc.line[1], right = sc.line[2] * sc.x + sc.line[3];
    sc.tilt = sc.solved ? 0 : left > right ? -1 : right > left ? 1 : 0;
    sc.lean += (sc.tilt - sc.lean) * Math.min(1, dt * 7);
    if (sc.solved) return;
    if (sc.tilt) {
      sc.calm = 0; sc.tiltT += dt;
      if (def.spill > 0 && sc.tiltT >= def.spill) revert(w, si, NOTE.spilled, true);
      return;
    }
    sc.tiltT = 0; sc.calm += dt;
    if (sc.calm < CALM) return;
    if (!record(w, si)) return;
    if (isolated(sc.line) && sc.calm >= HOLD) { sc.solved = true; for (const p of w.players) if (p.carry?.scale === si) p.carry = null; }
  });
}

/** 열린 문 앞에 서 있는가(확인을 누르면 들어갈 수 있는 자리). */
export function atDoor(w: World, p: Player) {
  const d = w.stage.door!;
  return w.doorOpen && !p.inDoor && overlap(p, { x: d.x + 6, y: d.y + 20, w: d.w - 12, h: d.h - 20 });
}

/** 방장이 내보내고 나머지가 받아 그리는 세계 요약(작게). */
export type Snapshot = {
  t: number; open: boolean; won: boolean; act: string[]; pr: number[];
  key: [number, number, number, number];           // x, y, 든 사람(-1 없음), 쓴 여부
  cr: [number, number, number][];                  // x, y, 미는 사람 수
  pl: [number, number, number, number, number][];  // x, y, vx, 상태 비트, 걷기
  sc: number[][];                                  // 저울마다: 왼 상자, 왼 구슬, 오른 상자, 오른 구슬, 통(0 더하기 1 빼기), 풀림, 기울기
  ca: number[];                                    // 사람마다 든 것: 0 없음, 1 구슬, 2 상자
};

export function snapshot(w: World): Snapshot {
  return {
    t: +w.t.toFixed(2), open: w.doorOpen, won: w.won, act: [...w.active], pr: w.pressed.slice(),
    key: [Math.round(w.key.x), Math.round(w.key.y), w.key.holder ?? -1, w.key.used ? 1 : 0],
    cr: w.crates.map(c => [Math.round(c.x * 10) / 10, Math.round(c.y), c.pushers]),
    pl: w.players.map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.vx), (p.on ? 1 : 0) | (p.inDoor ? 2 : 0) | (p.side === 'left' ? 4 : p.side === 'right' ? 8 : 0) | (p.turnT > 0 ? 16 : 0), Math.round(p.walk * 10) / 10]),
    sc: w.scales.map(sc => [...sc.line, sc.mode === 'sub' ? 1 : 0, sc.solved ? 1 : 0, sc.tilt]),
    ca: w.players.map(p => (p.carry ? (p.carry.kind === 'box' ? 2 : 1) : 0)),
  };
}

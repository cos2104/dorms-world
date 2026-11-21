/**
 * 세계 요약. 방장만 물리를 돌리고, 손님은 방장이 초당 스무 번 보내는 요약을 받아 같은 그림을 그린다.
 * 요약은 화면에 보이는 것 전부와, 방장이 바뀌었을 때 새 방장이 그대로 이어 갈 수 있는 값(속도·저울의 시간들)을 담는다.
 * 저울의 답(x)은 싣지 않는다: 방 정보의 씨앗으로 모두가 같은 식을 뽑는다.
 * 여기는 순수한 계산뿐이다(화면도 연결도 모른다). 받은 요약은 남이 보낸 글이므로 모양을 검사하고 나서 쓴다.
 */
import { MAX_BOXES, MAX_MARBLES, type Line } from './equation';
import { colorFor } from './identity';
import { MAX_SEATS } from './room-rules';
import { NOTE_LIST, NO_PAD, dividedNote, setPlayerCount, type Carry, type Pad, type World } from './sim';
import { T } from './stage';

/** 방장이 요약을 보내는 간격(물리 걸음 수). 60 / 3 = 초당 20번. */
export const SNAP_EVERY = 3;
const P = 8, C = 4, S_HEAD = 8;   // 도름이·상자 하나가 차지하는 칸 수, 저울 머리 칸 수
const LINES_MAX = 8;
/**
 * 저울 알림은 글이 아니라 번호로 싣는다: 0 없음, 1부터 sim.ts NOTE_LIST 의 차례, 100 + g 는 'g묶음으로 나눠…'.
 * 다른 기기가 보낸 글자를 화면에 그대로 그리는 칸은 요약에 하나도 없다(다리 글자 a 는 조회에만 쓴다).
 */
const DIVIDED = 100;
const noteCode = (text: string) => { const i = NOTE_LIST.indexOf(text); if (i >= 0) return i + 1; const m = /^(\d{1,2})묶음으로/.exec(text); return m && dividedNote(+m[1]) === text ? DIVIDED + +m[1] : 0; };
const noteText = (code: number) => (code >= DIVIDED ? (code - DIVIDED >= 2 && code - DIVIDED <= MAX_MARBLES ? dividedNote(code - DIVIDED) : '') : NOTE_LIST[code - 1] ?? '');

export type Wire = {
  r: number;                              // 판 번호(방 정보의 run). 지난 판의 요약은 버린다
  n: number;                              // 보낸 차례
  t: number;                              // 지난 시간(초)
  f: number;                              // 1 문이 열림, 2 모두 들어가 끝남
  k: [number, number, number, number];    // 열쇠: x, y, 든 사람(-1 없음), 문을 여는 데 씀
  a: string;                              // 켜진 다리 글자들
  b: number[];                            // 단추마다 밟은 사람 수
  c: number[];                            // 상자마다 4칸: x, y, 떨어지는 속도, 미는 사람 수
  p: number[];                            // 도름이마다 8칸: 자리 번호, x, y, vx, vy, 상태, 걷기, 든 것
  s: number[][];                          // 저울마다: 통(0 더하기 1 빼기), 풀림, 기울기, 기운 시간, 수평 시간, 덜컹, 알림 시간, 알림 번호, 그리고 지금 식 4칸 + 풀이 판 줄마다 4칸
};

const r1 = (v: number) => Math.round(v * 10) / 10, r2 = (v: number) => Math.round(v * 100) / 100;
const ON = 1, IN_DOOR = 2, LEFT = 4, RIGHT = 8, TURN = 16, LOCK = 32, A_HELD = 64, J_HELD = 128;

const packCarry = (c: Carry | null) => (c ? (c.kind === 'box' ? 2 : 1) + 3 * (c.from + 1) + 9 * c.scale : 0);
function unpackCarry(v: number, scales: number): Carry | null {
  if (!v) return null;
  const kind = v % 3, from = Math.floor(v / 3) % 3 - 1, scale = Math.floor(v / 9);
  if ((kind !== 1 && kind !== 2) || scale >= scales) return null;
  return { kind: kind === 2 ? 'box' : 'marble', scale, from: from as 0 | 1 | -1 };
}

/** 방장: 지금 세계를 요약으로. seats 는 도름이 차례대로의 자리 번호(방 정보의 order). */
export function toWire(w: World, seats: readonly number[], run: number, n: number): Wire {
  const p: number[] = [];
  w.players.forEach((q, i) => {
    const bits = (q.on ? ON : 0) | (q.inDoor ? IN_DOOR : 0) | (q.side === 'left' ? LEFT : q.side === 'right' ? RIGHT : 0) | (q.turnT > 0 ? TURN : 0) | (q.doorLock ? LOCK : 0) | (q.aHeld ? A_HELD : 0) | (q.jumpHeld ? J_HELD : 0);
    p.push(seats[i] ?? i, r1(q.x), r1(q.y), Math.round(q.vx), Math.round(q.vy), bits, r1(q.walk % 4), packCarry(q.carry));
  });
  return {
    r: run, n, t: r2(w.t), f: (w.doorOpen ? 1 : 0) | (w.won ? 2 : 0),
    k: [Math.round(w.key.x), Math.round(w.key.y), w.key.holder ?? -1, w.key.used ? 1 : 0],
    a: [...w.active].join(''),
    b: w.pressed.slice(),
    c: w.crates.flatMap(c => [r1(c.x), r1(c.y), Math.round(c.vy), c.pushers]),
    p,
    s: w.scales.map(sc => [sc.mode === 'sub' ? 1 : 0, sc.solved ? 1 : 0, sc.tilt, r2(sc.tiltT), r2(sc.calm), r2(Math.max(0, sc.shake)), r2(Math.max(0, sc.noteT)), sc.noteT > 0 ? noteCode(sc.note) : 0, ...sc.line, ...sc.lines.flat()]),
  };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const whole = (v: unknown, lo: number, hi: number): v is number => num(v) && Number.isInteger(v) && v >= lo && v <= hi;
const nums = (v: unknown, max: number): v is number[] => Array.isArray(v) && v.length <= max && v.every(num);

/** 받은 요약의 모양을 검사한다. 어긋나면 null(그 요약은 버린다). 세계에 맞는지는 applyWire 가 다시 본다. */
export function readWire(x: unknown): Wire | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!whole(o.r, 0, 1e9) || !whole(o.n, 0, 1e12) || !num(o.t) || o.t < 0 || !whole(o.f, 0, 3)) return null;
  if (!nums(o.k, 4) || o.k.length !== 4 || typeof o.a !== 'string' || o.a.length > 64) return null;
  if (!nums(o.b, 200) || !nums(o.c, 200 * C) || o.c.length % C || !nums(o.p, MAX_SEATS * P) || o.p.length % P) return null;
  for (let i = 0; i < o.p.length; i += P) if (!whole(o.p[i], 0, MAX_SEATS - 1) || !whole(o.p[i + 5], 0, 255) || !whole(o.p[i + 7], 0, 9 * 64)) return null;
  if (!Array.isArray(o.s) || o.s.length > 16) return null;
  for (const s of o.s) {
    if (!Array.isArray(s) || s.length < S_HEAD + 8 || s.length > S_HEAD + 4 + LINES_MAX * 4 || (s.length - S_HEAD) % 4) return null;
    if (!s.every(num) || !whole(s[7], 0, DIVIDED + MAX_MARBLES)) return null;
    for (let i = S_HEAD; i < s.length; i++) if (!whole(s[i], -MAX_MARBLES, MAX_MARBLES)) return null;
  }
  return o as unknown as Wire;
}

/** 요약에 적힌 도름이들의 자리 번호. */
export const wireSeats = (wire: Wire) => { const out: number[] = []; for (let i = 0; i < wire.p.length; i += P) out.push(wire.p[i]); return out; };

/**
 * 손님: 요약을 세계에 덮어쓴다. 세계는 같은 스테이지·같은 씨앗으로 만들어 둔 것이어야 한다.
 * 스테이지와 맞지 않는 요약(상자·저울·단추 수가 다름)은 쓰지 않고 false 를 돌려준다.
 */
export function applyWire(w: World, wire: Wire): boolean {
  const st = w.stage;
  if (wire.b.length !== st.buttons.length || wire.c.length !== st.crates.length * C || wire.s.length !== st.scales.length) return false;
  const seats = wireSeats(wire);
  if (w.players.length !== seats.length || w.players.some((q, i) => q.color !== colorFor(seats[i]))) setPlayerCount(w, seats.map(colorFor));
  const sw = st.cols * T, sh = st.rows * T, inX = (v: number) => Math.max(-T, Math.min(sw + T, v)), inY = (v: number) => Math.max(-4 * T, Math.min(sh + 4 * T, v));

  w.t = Math.min(wire.t, 86_400); w.doorOpen = !!(wire.f & 1); w.won = !!(wire.f & 2);
  const holder = wire.k[2];
  w.key = { x: inX(wire.k[0]), y: inY(wire.k[1]), holder: Number.isInteger(holder) && holder >= 0 && holder < seats.length ? holder : null, used: !!wire.k[3] };
  w.active = new Set(wire.a);
  w.pressed = wire.b.map(v => Math.max(0, Math.min(MAX_SEATS, v | 0)));
  w.crates.forEach((c, i) => { c.x = inX(wire.c[i * C]); c.y = inY(wire.c[i * C + 1]); c.vy = fast(wire.c[i * C + 2]); c.pushers = Math.max(0, Math.min(MAX_SEATS, wire.c[i * C + 3] | 0)); });
  w.players.forEach((q, i) => {
    const o = i * P, bits = wire.p[o + 5];
    q.x = inX(wire.p[o + 1]); q.y = inY(wire.p[o + 2]); q.vx = fast(wire.p[o + 3]); q.vy = fast(wire.p[o + 4]);
    q.on = !!(bits & ON); q.inDoor = !!(bits & IN_DOOR);
    q.side = bits & LEFT ? 'left' : bits & RIGHT ? 'right' : null;
    q.turnT = bits & TURN ? 0.1 : 0; q.doorLock = !!(bits & LOCK);
    q.aHeld = !!(bits & A_HELD); q.aNew = false; q.jumpHeld = !!(bits & J_HELD); q.jn = null; q.jumpBuf = 0;
    q.walk = ((wire.p[o + 6] % 4) + 4) % 4;              // 걷는 그림 번호가 음수가 되지 않게
    q.carry = unpackCarry(wire.p[o + 7], w.scales.length);
  });
  w.scales.forEach((sc, i) => {
    const s = wire.s[i];
    const line = (at: number): Line => [box(s[at]), s[at + 1], box(s[at + 2]), s[at + 3]];
    sc.mode = s[0] ? 'sub' : 'add'; sc.solved = !!s[1];
    sc.tilt = s[2] < 0 ? -1 : s[2] > 0 ? 1 : 0;
    sc.tiltT = Math.max(0, s[3]); sc.calm = Math.max(0, s[4]); sc.shake = Math.max(0, Math.min(1, s[5])); sc.noteT = Math.max(0, Math.min(5, s[6]));
    sc.note = sc.noteT > 0 ? noteText(s[7]) : '';
    sc.line = line(S_HEAD);
    sc.lines = []; for (let at = S_HEAD + 4; at < s.length; at += 4) sc.lines.push(line(at));
  });
  return true;
}
const box = (v: number) => Math.max(0, Math.min(MAX_BOXES, v));
/** 속도는 물리가 내는 범위 안으로 자른다(방장이 바뀌어 이 세계를 이어 굴릴 때 터무니없는 속도가 남지 않게). */
const fast = (v: number) => Math.max(-1000, Math.min(1000, v));

// ---------- 요약 사이를 부드럽게 잇기 ----------

/** 받은 요약 가운데 마지막 둘과 받은 때(밀리초). */
export type Track = { a: Wire | null; b: Wire | null; ta: number; tb: number; gap: number };
export const newTrack = (): Track => ({ a: null, b: null, ta: 0, tb: 0, gap: 1000 * SNAP_EVERY / 60 });

/** 새 요약을 받았다. 지난 판의 것이거나 차례가 뒤로 간 것은 버린다(false). */
export function pushWire(track: Track, wire: Wire, run: number, now: number): boolean {
  if (wire.r !== run) return false;
  if (track.b && track.b.r === wire.r && wire.n <= track.b.n) return false;
  if (track.b) track.gap += (Math.max(16, Math.min(250, now - track.tb)) - track.gap) * 0.2;   // 요약이 오는 간격을 느리게 따라간다
  track.a = track.b; track.ta = track.tb; track.b = wire; track.tb = now;
  return true;
}

/**
 * 그릴 때마다: 마지막 요약을 세계에 덮어쓴 뒤, 도름이·상자의 자리만 앞 요약과 마지막 요약 사이로 되돌려 잇는다.
 * 요약 한 번 간격만큼 늦게 그려서 그 사이를 고르게 채운다. 멀리 건너뛴 것(되살아남·문에서 나옴)은 잇지 않는다.
 */
export function blend(w: World, track: Track, now: number, dt: number): boolean {
  const b = track.b;
  if (!b || !applyWire(w, b)) return false;
  const a = track.a;
  // 저울대의 기울기는 방장과 같은 식으로 스스로 따라간다(요약에 싣지 않는다)
  for (const sc of w.scales) sc.lean += (sc.tilt - sc.lean) * Math.min(1, dt * 7);
  if (!a || a.r !== b.r || a.p.length !== b.p.length || a.c.length !== b.c.length) return true;
  const k = Math.max(0, Math.min(1, (now - track.gap - track.ta) / Math.max(1, track.tb - track.ta)));
  if (k >= 1) return true;
  const mix = (from: number, to: number, far: number) => (Math.abs(to - from) > far ? to : from + (to - from) * k);
  w.players.forEach((q, i) => {
    const o = i * P;
    if (a.p[o] !== b.p[o] || ((a.p[o + 5] ^ b.p[o + 5]) & IN_DOOR)) return;
    q.x = mix(a.p[o + 1], b.p[o + 1], 48); q.y = mix(a.p[o + 2], b.p[o + 2], 90);
  });
  w.crates.forEach((c, i) => { c.x = mix(a.c[i * C], b.c[i * C], 48); c.y = mix(a.c[i * C + 1], b.c[i * C + 1], 90); });
  const h = w.key.holder != null ? w.players[w.key.holder] : null;
  if (h && !w.key.used) { w.key.x = h.x + h.w / 2 - 16; w.key.y = h.y - 26; }
  return true;
}

// ---------- 손님의 조작: 보내는 쪽과 받는 쪽 ----------
/** 조작은 바뀌면 바로 보낸다(초당 서른 번까지). 안 바뀌어도 1초마다 다시 보내고, 방장은 3.5초 넘게 소식이 없는 조작을 놓은 것으로 본다. */
export const PAD_MIN_MS = 33, PAD_REPEAT_MS = 1000, PAD_STALE_MS = 3500;

/**
 * 손님: 내 조작을 방장에게 보낸다. 짧게 누른 확인도 빠지지 않게 모아 둔다.
 * 되풀이 보내기는 1초에 한 번뿐이라(방 서버를 지나가는 글 수를 줄인다), 받는 방장이 바뀌면 again() 을 불러 바로 다시 보낸다.
 */
export function padSender(send: (p: Pad) => void) {
  let at = -1e12, key = '', held = false;
  const push = (p: Pad, now: number) => {
    held ||= !!p.a;
    if (now - at < PAD_MIN_MS) return;
    const out: Pad = { m: p.m, j: p.j, a: held, jn: p.jn };
    const k = `${out.m}${out.j ? 1 : 0}${held ? 1 : 0}${out.jn}`;
    if (k !== key || now - at >= PAD_REPEAT_MS) { send(out); key = k; at = now; }
    held = false;
  };
  /** 받는 쪽이 바뀌었다(방장이 바뀌었거나 다시 붙었다): 바뀐 것이 없어도 다음 번에 바로 보낸다. */
  push.again = () => { key = ''; };
  return push;
}

/** 방장: 손님들의 마지막 조작. 새 조작이 올 때까지 마지막 것을 그대로 이어 쓴다(누르고 있는 동안 글이 오지 않아도 계속 걷는다). */
export class GuestPads {
  private pads = new Map<number, { pad: Pad; at: number; tap: boolean }>();   // tap: 아직 걸음에 쓰이지 않은 짧은 확인 누름
  set(seat: number, pad: Pad, now: number) { this.pads.set(seat, { pad, at: now, tap: !!pad.a || !!this.pads.get(seat)?.tap }); }
  /** 이번 걸음에 쓸 조작. 한참(3.5초) 소식이 없으면 손을 뗀 것으로 본다(연결이 죽은 사람의 도름이가 혼자 걷지 않게). */
  get(seat: number, now: number): Pad {
    const g = this.pads.get(seat);
    if (!g || now - g.at >= PAD_STALE_MS) return NO_PAD;
    return g.tap && !g.pad.a ? { ...g.pad, a: true } : g.pad;
  }
  /** 걸음이 한 번 돌았다: 짧은 확인(누름과 뗌이 걸음 한 번 사이에 함께 온 것)도 한 걸음은 쓰였다. */
  stepped() { for (const g of this.pads.values()) g.tap = false; }
  clear() { this.pads.clear(); }
}

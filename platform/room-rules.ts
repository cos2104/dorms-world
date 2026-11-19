/**
 * 방의 규칙. 방 서버(room-server/)와 시험이 같은 코드를 쓴다. 화면도 Workers 기능도 쓰지 않는 순수한 계산이다.
 *
 * 방을 지나가는 것은 자리 번호, 조작 신호, 세계 요약, 방 정보(팩·스테이지·씨앗·공개 여부·차례)뿐이다. 어디에도 저장하지 않는다.
 * 누가 보낸 글이든 믿지 않는다: 모양과 크기를 검사하고, 모르는 것은 버리고, 조작 신호는 검사한 값으로 다시 써서 넘긴다.
 */
import { validRoomCode } from './room-code';

export const MAX_SEATS = 30;
/** 메시지 크기 상한(바이트). 손님은 조작 신호뿐이라 작고, 방장만 세계 요약을 보낸다. */
export const LIMITS = { guest: 256, snap: 32 * 1024, host: 2048, perSec: 40, burst: 80 } as const;
/** 연결을 끊을 때의 까닭 번호(브라우저가 읽을 수 있는 4000번대). */
export const CLOSE = { bad: 4000, full: 4003, none: 4004, tooBig: 4007, tooFast: 4008, taken: 4009, replaced: 4010 } as const;
export const PUBLIC_TTL = 30_000;

export const ORIGINS = ['https://dorms-world.vercel.app', 'https://dorms.school'];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
/** 방 서버를 쓸 수 있는 곳: 운영 두 주소와 이 컴퓨터(개발). extra 는 같은 와이파이의 휴대폰으로 시험할 때만 넣는다. */
export const originAllowed = (origin: string | null | undefined, extra: readonly string[] = []) =>
  !!origin && (ORIGINS.includes(origin) || LOCAL.test(origin) || extra.includes(origin));

export type View = 'play' | 'pad';
/**
 * 방 정보. pack 이 비었거나 stage 가 -1 이면 방장이 고르는 중이다.
 * run 은 판 번호(시작하거나 다시 할 때마다 는다), order 는 도름이 차례대로 적은 자리 번호, big 은 함께 보기 방.
 */
export type RoomInfo = { pack: string; stage: number; seed: number; run: number; pub: boolean; big: boolean; order: number[] };
export const emptyRoom = (pub = false, big = false): RoomInfo => ({ pack: '', stage: -1, seed: 1, run: 0, pub, big, order: [] });

export type PublicRoom = { code: string; pack: string; stage: number; count: number };

const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const PACK_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;

/** 방장이 보낸 방 정보를 검사해 깨끗한 값으로 돌려준다. 하나라도 어긋나면 null(그 메시지는 버린다). */
export function cleanRoomInfo(x: unknown): RoomInfo | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const pack = o.pack;
  if (typeof pack !== 'string' || pack.length > 64 || (pack !== '' && !PACK_ID.test(pack))) return null;
  if (!int(o.stage, -1, 99) || !int(o.seed, 1, 2147483647) || !int(o.run, 0, 1_000_000_000)) return null;
  if (typeof o.pub !== 'boolean' || typeof o.big !== 'boolean') return null;
  const order = o.order;
  if (!Array.isArray(order) || order.length > MAX_SEATS || !order.every(s => int(s, 0, MAX_SEATS - 1)) || new Set(order).size !== order.length) return null;
  return { pack, stage: o.stage, seed: o.seed, run: o.run, pub: o.pub, big: o.big, order: order.slice() as number[] };
}

/** 손님의 조작 신호. 검사한 값만 남긴다(m 좌우, j 뛰기, a 확인, n 뛰기를 누른 횟수). */
export type WirePad = { m: -1 | 0 | 1; j: 0 | 1; a: 0 | 1; n: number };
export function cleanPad(x: unknown): WirePad | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (o.m !== -1 && o.m !== 0 && o.m !== 1) return null;
  if ((o.j !== 0 && o.j !== 1) || (o.a !== 0 && o.a !== 1) || !int(o.n, 0, 1_000_000_000)) return null;
  return { m: o.m, j: o.j, a: o.a, n: o.n };
}

export type JoinQuery = { mode: 'create' | 'join'; view: View | 'auto'; id: string; pub: boolean; big: boolean };
const TAB_ID = /^[0-9a-f]{16}$/;
/** 주소 뒤에 붙은 값(문자열)을 읽는다. 모양이 어긋난 값은 기본값으로 둔다. */
export function readJoinQuery(q: { get(name: string): string | null }): JoinQuery {
  const view = q.get('view'), id = q.get('id') ?? '';
  return { mode: q.get('mode') === 'create' ? 'create' : 'join', view: view === 'play' || view === 'pad' ? view : 'auto', id: TAB_ID.test(id) ? id : '', pub: q.get('pub') === '1', big: q.get('big') === '1' };
}

/** 연결 하나에 붙여 두는 값. 방이 잠들었다 깨어도 이 값으로 다시 세운다(방장의 것에만 방 정보가 함께 있다). */
export type Saved = { code: string; seat: number; key: number; rank: number; view: View; id: string; host: boolean; info?: RoomInfo };

type Conn<S> = { sock: S; seat: number; key: number; rank: number; view: View; id: string; host: boolean; tokens: number; at: number };

export type Out<S> = {
  send(sock: S, text: string): void;
  close(sock: S, code: number, reason: string): void;
  /** 연결에 붙여 둘 값이 바뀌었다(없어도 된다). */
  save?(sock: S, saved: Saved): void;
  /** 공개 방 목록에 올리거나(값), 내린다(null). */
  lobby?(code: string, room: PublicRoom | null): void;
};

const bytes = (s: string) => (s.length * 3 < 256 ? s.length : new TextEncoder().encode(s).length);

/**
 * 방 하나. 방장은 가장 먼저 들어온 연결이고, 방장이 나가면 그다음으로 오래된 연결이 방장이 된다
 * (게임 화면을 보고 있는 연결을 먼저 고른다. 조작기만 쓰는 연결은 세계를 갖고 있지 않아서다).
 */
export class RoomCore<S> {
  code = '';
  info: RoomInfo = emptyRoom();
  private conns = new Map<number, Conn<S>>();
  private nextKey = 1;
  private nextRank = 1;

  constructor(private out: Out<S>) {}

  get size() { return this.conns.size; }
  get hostSeat() { for (const c of this.conns.values()) if (c.host) return c.seat; return -1; }
  seats(): [number, 0 | 1][] { return [...this.conns.values()].sort((a, b) => a.seat - b.seat).map(c => [c.seat, c.view === 'pad' ? 1 : 0]); }

  /** 잠들었다 깬 방을 연결에 붙여 둔 값으로 다시 세운다. */
  restore(sock: S, s: Saved) {
    if (!validRoomCode(s.code) || !int(s.seat, 0, MAX_SEATS - 1) || this.conns.has(s.seat)) return;
    this.code = s.code;
    this.conns.set(s.seat, { sock, seat: s.seat, key: s.key, rank: s.rank, view: s.view, id: s.id, host: s.host, tokens: LIMITS.burst, at: 0 });
    this.nextKey = Math.max(this.nextKey, s.key + 1); this.nextRank = Math.max(this.nextRank, s.rank + 1);
    if (s.host && s.info) this.info = cleanRoomInfo(s.info) ?? this.info;
  }

  private save(c: Conn<S>) {
    this.out.save?.(c.sock, { code: this.code, seat: c.seat, key: c.key, rank: c.rank, view: c.view, id: c.id, host: c.host, ...(c.host ? { info: this.info } : {}) });
  }
  private toAll(text: string, but?: Conn<S>) { for (const c of this.conns.values()) if (c !== but) this.out.send(c.sock, text); }
  private who() { this.toAll(JSON.stringify({ t: 'who', host: this.hostSeat, seats: this.seats() })); }
  private report() {
    if (!this.out.lobby || !this.code) return;
    this.out.lobby(this.code, this.info.pub && this.conns.size > 0 ? { code: this.code, pack: this.info.pack, stage: this.info.stage, count: this.conns.size } : null);
  }
  /** 방장이 없으면 새로 뽑는다. 뽑았으면 true. */
  private elect(skip?: Conn<S>): boolean {
    if (this.hostSeat >= 0) return false;
    const live = [...this.conns.values()].filter(c => c !== skip).sort((a, b) => a.rank - b.rank);
    const next = live.find(c => c.view === 'play') ?? live[0];
    if (!next) return false;
    next.host = true; next.view = 'play';
    this.save(next);
    return true;
  }

  /** 들어오지 못한 연결에는 까닭 번호를 글로 먼저 알리고 끊는다(끊김 번호가 늦게 닿는 경우에도 까닭을 알 수 있게). */
  private refuse(sock: S, code: number, reason: string): null {
    this.out.send(sock, JSON.stringify({ t: 'no', c: code }));
    this.out.close(sock, code, reason);
    return null;
  }

  /** 새 연결. 들어오지 못하면 까닭을 알리고 끊은 뒤 null 을 돌려준다. */
  join(sock: S, code: string, q: JoinQuery): Saved | null {
    if (!validRoomCode(code)) return this.refuse(sock, CLOSE.bad, 'code');
    const same = q.id ? [...this.conns.values()].find(c => c.id === q.id) : undefined;
    if (q.mode === 'create' && this.conns.size > 0 && !same) return this.refuse(sock, CLOSE.taken, 'taken');
    if (q.mode === 'join' && this.conns.size === 0) return this.refuse(sock, CLOSE.none, 'none');
    if (!same && this.conns.size >= MAX_SEATS) return this.refuse(sock, CLOSE.full, 'full');
    if (this.conns.size === 0) { this.code = code; this.info = emptyRoom(q.pub, q.big); }

    let conn: Conn<S>;
    if (same) {
      // 같은 창이 다시 붙었다(와이파이가 잠깐 끊긴 경우). 앉아 있던 자리를 그대로 잇고 옛 연결은 끊는다.
      this.out.close(same.sock, CLOSE.replaced, 'replaced');
      conn = { ...same, sock, key: this.nextKey++, tokens: LIMITS.burst, at: 0 };
      if (!conn.host && q.view !== 'auto') conn.view = q.view;
    } else {
      let seat = 0; while (this.conns.has(seat)) seat++;
      const host = this.hostSeat < 0;
      const view: View = host ? 'play' : q.view === 'auto' ? (this.info.big ? 'pad' : 'play') : q.view;
      conn = { sock, seat, key: this.nextKey++, rank: this.nextRank++, view, id: q.id, host, tokens: LIMITS.burst, at: 0 };
    }
    this.conns.set(conn.seat, conn);
    this.save(conn);
    this.out.send(sock, JSON.stringify({ t: 'hi', me: conn.seat, host: this.hostSeat, seats: this.seats(), room: this.info }));
    this.toAll(JSON.stringify({ t: 'who', host: this.hostSeat, seats: this.seats() }), conn);
    this.report();
    return { code: this.code, seat: conn.seat, key: conn.key, rank: conn.rank, view: conn.view, id: conn.id, host: conn.host };
  }

  /** 연결이 끊겼다. key 가 다르면 이미 다른 연결이 그 자리를 이은 것이라 아무것도 하지 않는다. */
  leave(seat: number, key: number) {
    const c = this.conns.get(seat);
    if (!c || c.key !== key) return;
    this.conns.delete(seat);
    if (c.host) this.elect();
    if (this.conns.size) this.who();
    this.report();
  }

  /** 받은 글 한 통. now 는 밀리초. */
  message(seat: number, key: number, text: string, now: number) {
    const c = this.conns.get(seat);
    if (!c || c.key !== key) return;
    // 빈도: 초당 40통까지(잠깐 몰리는 것은 80통까지 봐준다). 넘으면 끊는다.
    c.tokens = Math.min(LIMITS.burst, c.tokens + (c.at ? (now - c.at) * LIMITS.perSec / 1000 : 0)); c.at = now;
    if (--c.tokens < 0) return this.kick(c, CLOSE.tooFast, 'fast');
    const size = bytes(text);
    if (size > (c.host ? LIMITS.snap : LIMITS.guest)) return this.kick(c, CLOSE.tooBig, 'big');
    let msg: unknown;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const t = (msg as { t?: unknown }).t;

    if (t === 'p') {                                   // 조작 신호: 손님 → 방장에게만
      if (c.host) return;
      const pad = cleanPad(msg), host = this.conns.get(this.hostSeat);
      if (pad && host) this.out.send(host.sock, JSON.stringify({ t: 'p', s: c.seat, ...pad }));
    } else if (t === 's') {                            // 세계 요약: 방장 → 게임 화면을 보는 손님에게
      if (!c.host) return;
      for (const o of this.conns.values()) if (o !== c && o.view === 'play') this.out.send(o.sock, text);
    } else if (t === 'room') {                         // 방 정보: 방장만 바꾼다
      if (!c.host || size > LIMITS.host) return;
      const info = cleanRoomInfo((msg as { room?: unknown }).room);
      if (!info) return;
      this.info = info;
      this.save(c);
      this.toAll(JSON.stringify({ t: 'room', room: info }), c);
      this.report();
    } else if (t === 'view') {                         // 게임 화면으로 볼지, 조작기로만 쓸지
      const v = (msg as { v?: unknown }).v;
      if (c.host || (v !== 'play' && v !== 'pad') || v === c.view) return;
      c.view = v; this.save(c); this.who();
    } else if (t === 'yield') {                        // 방장이 자리를 비운다(화면을 내려 둠): 게임 화면을 보는 다음 사람에게 넘긴다
      if (!c.host) return;
      const next = [...this.conns.values()].filter(o => o !== c && o.view === 'play').sort((a, b) => a.rank - b.rank)[0];
      if (!next) return;
      c.host = false; next.host = true;
      this.save(c); this.save(next); this.who();
    } else if (t === 'hb') {                           // 방장의 살아 있음 알림: 공개 방 목록을 새로 고친다
      if (!c.host) return;
      this.report();
      this.out.send(c.sock, '{"t":"hb"}');
    }
  }

  private kick(c: Conn<S>, code: number, reason: string) {
    this.out.close(c.sock, code, reason);
    this.leave(c.seat, c.key);
  }
}

/** 공개 방 목록. 30초 넘게 소식이 없는 방은 뺀다. */
export class PublicList {
  private rooms = new Map<string, PublicRoom & { at: number }>();
  report(code: string, room: PublicRoom | null, now: number) {
    if (!validRoomCode(code)) return;
    if (!room) { this.rooms.delete(code); return; }
    if (this.rooms.size >= 500 && !this.rooms.has(code)) this.list(now);          // 넘치면 묵은 것부터 치운다
    if (this.rooms.size >= 500 && !this.rooms.has(code)) return;
    this.rooms.set(code, { code, pack: String(room.pack).slice(0, 64), stage: room.stage | 0, count: Math.max(0, Math.min(MAX_SEATS, room.count | 0)), at: now });
  }
  list(now: number): PublicRoom[] {
    for (const [code, r] of this.rooms) if (now - r.at > PUBLIC_TTL) this.rooms.delete(code);
    return [...this.rooms.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)).slice(0, 50).map(({ code, pack, stage, count }) => ({ code, pack, stage, count }));
  }
}

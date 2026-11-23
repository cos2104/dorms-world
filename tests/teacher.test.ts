/**
 * 교사 방의 규칙을 화면도 방 서버도 없이 본다: 출입증 확인, 닉네임 신청과 승인, 순위와 쓰임 알림, 주소마다의 횟수 제한,
 * 손님 조작의 되풀이 간격(1초)과 방장이 바뀔 때의 이어 가기, 순위 읽기.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { joinRoom, type NickState, type RankNews, type RoomLink } from '../platform/net';
import {
  ASK_GAP, CLOSE, GATE, Gate, LIMITS, MAX_SEATS, PASS_GAP, RANK, RoomCore, cleanLine, cleanNick, cleanTitle, dormsUrl, ipKey, readClassInfo, readJoinQuery, readNames, readPass, readRankReply, verifyPass,
  type JoinQuery, type PassClaims, type RankReport, type RoomInfo, type Saved, type UseReport,
 RUN_MAX, nextRun, cleanRoomInfo } from '../platform/room-rules';
import { NO_PAD, type Pad } from '../platform/sim';
import { GuestPads, PAD_REPEAT_MS, PAD_STALE_MS, padSender } from '../platform/sync';
import { readRanks } from '../src/ranks';
import { mmss } from '../platform/text';

// 출입증은 도름스가 만든다. 여기서는 계약에 적힌 식 그대로, 방 서버의 확인 코드와 다른 길(node:crypto)로 만들어 본다.
const SECRET = 'test-secret-0123456789abcdef0123456789';
const NOW = 1_763_800_000;
const TEACHER = '11111111-2222-4333-8444-555555555555', OTHER = '99999999-2222-4333-8444-555555555555';
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function makePass(claims: Record<string, unknown> = {}, secret = SECRET) {
  const body = b64(JSON.stringify({ u: TEACHER, n: '창욱쌤', a: 1, iat: NOW - 60, exp: NOW - 60 + 12 * 3600, c: 1, ...claims }));
  return `v1.${body}.${b64(createHmac('sha256', secret).update(`v1.${body}`).digest())}`;
}

describe('교사 출입증', () => {
  it('도름스가 만든 출입증은 서명과 기한이 맞으면 받는다', async () => {
    const claims = await verifyPass(makePass(), SECRET, NOW);
    expect(claims).toEqual({ u: TEACHER, n: '창욱쌤', a: 1, iat: NOW - 60, exp: NOW - 60 + 12 * 3600, c: 1 });
    expect((await verifyPass(makePass({ c: undefined }), SECRET, NOW))?.c).toBe(0);                // 동의 기록이 없는 출입증
    expect(readPass(makePass({ a: 0 }), NOW)).toMatchObject({ n: '창욱쌤', a: 0 });       // 화면은 서명을 보지 않고 닉네임만 읽는다
  });

  it('변조된 출입증은 받지 않는다: 가운데를 바꿨거나, 서명이 틀렸거나, 다른 비밀값으로 만든 것', async () => {
    const pass = makePass(), [v, body, sig] = pass.split('.');
    const forged = b64(JSON.stringify({ u: OTHER, n: '가짜', a: 1, iat: NOW - 60, exp: NOW + 3600 }));
    expect(await verifyPass(`${v}.${forged}.${sig}`, SECRET, NOW)).toBeNull();
    expect(await verifyPass(`${v}.${body}.${sig.slice(0, -2)}AA`, SECRET, NOW)).toBeNull();
    expect(await verifyPass(makePass({}, 'another-secret-0123456789abcdef012345'), SECRET, NOW)).toBeNull();
    expect(await verifyPass(`v2.${body}.${sig}`, SECRET, NOW)).toBeNull();
    expect(await verifyPass(`${v}.${body}`, SECRET, NOW)).toBeNull();
    expect(readPass(`${v}.${forged}.${sig}`, NOW)).toMatchObject({ n: '가짜' });           // 그래서 화면에 적힌 닉네임은 믿는 값이 아니다
  });

  it('기한이 지났거나, 아직 오지 않은 때의 것이거나, 12시간보다 긴 출입증은 받지 않는다', async () => {
    expect(await verifyPass(makePass({ iat: NOW - 13 * 3600, exp: NOW - 3600 }), SECRET, NOW)).toBeNull();
    expect(await verifyPass(makePass({ exp: NOW }), SECRET, NOW)).toBeNull();
    expect(await verifyPass(makePass({ iat: NOW + 3600, exp: NOW + 7200 }), SECRET, NOW)).toBeNull();
    expect(await verifyPass(makePass({ iat: NOW - 60, exp: NOW + 30 * 24 * 3600 }), SECRET, NOW)).toBeNull();
    expect(await verifyPass(makePass({ exp: NOW + 1 }), SECRET, NOW)).not.toBeNull();
    expect(readPass(makePass({ exp: NOW - 1 }), NOW)).toBeNull();                          // 화면도 기한이 지난 것은 버린다
  });

  it('비밀값이 없거나 32자가 안 되면 어떤 출입증도 받지 않는다', async () => {
    for (const secret of [undefined, null, '', 'short']) expect(await verifyPass(makePass({}, secret || 'x'.repeat(40)), secret, NOW)).toBeNull();
    expect(await verifyPass(makePass({}, 'short'), 'short', NOW)).toBeNull();
  });

  it('모양이 어긋난 출입증은 받지 않는다: 회원 번호, 닉네임, 길이, 글이 아닌 것', async () => {
    for (const bad of [{ u: 'me' }, { u: 'ABCDEF12-2222-4333-8444-555555555555' }, { n: '' }, { n: 7 }, { n: '\u202E\n' }, { iat: 'x' }, { exp: 1.5 }]) expect(await verifyPass(makePass(bad), SECRET, NOW)).toBeNull();
    for (const bad of [null, 7, {}, '', 'v1..', 'x'.repeat(900), `v1.${'A'.repeat(20)}.${'A'.repeat(43)}`]) expect(await verifyPass(bad, SECRET, NOW)).toBeNull();
    const long = await verifyPass(makePass({ n: '가'.repeat(60) }), SECRET, NOW);
    expect([...long!.n].length).toBe(40);                                                  // 긴 닉네임은 잘라서 받는다
    expect((await verifyPass(makePass({ n: '  창욱\u200B\n쌤  ' }), SECRET, NOW))!.n).toBe('창욱 쌤');
  });
});

describe('사람이 쓴 한 줄 글(닉네임 · 방 제목)', () => {
  it('닉네임은 10자, 방 제목은 20자까지. 넘으면 받지 않는다(자르지 않는다)', () => {
    expect(cleanNick('가나다라마바사아자차')).toBe('가나다라마바사아자차');
    expect(cleanNick('가나다라마바사아자차카')).toBe('');
    expect(cleanTitle('1'.repeat(20))).toBe('1'.repeat(20));
    expect(cleanTitle('1'.repeat(21))).toBe('');
    expect(cleanNick('🐳🐳🐳🐳🐳🐳🐳🐳🐳🐳')).toBe('🐳🐳🐳🐳🐳🐳🐳🐳🐳🐳');                  // 글자 수는 눈에 보이는 글자로 센다
  });

  it('제어 문자 · 줄바꿈 · 보이지 않는 글자를 빼고 한 줄로 만든다', () => {
    expect(cleanNick('  도름\n\t이  ')).toBe('도름 이');
    expect(cleanNick('a\u0000b\u001Fc\u007F')).toBe('abc');
    expect(cleanNick('\u202Eevil\u2066\u200B\u200D\uFEFF')).toBe('evil');                  // 글자 방향을 뒤집는 글자, 폭 없는 글자
    expect(cleanNick('줄\u2028바\u2029꿈')).toBe('줄 바 꿈');
    expect(cleanNick('z\u0301\u0302\u0303\u0304\u0305')).toBe('ź\u0302');                   // 겹겹이 쌓은 결합 기호는 하나만 남긴다
    expect(cleanNick('\uD83D')).toBe('');                                                  // 짝 잃은 글자 조각
    for (const bad of ['', '   ', '\n\n', null, undefined, 7, {}, ['a']]) expect(cleanNick(bad)).toBe('');
    expect(cleanNick('<b>굵게</b>')).toBe('<b>굵게</b>');                                  // 꺾쇠는 그대로 둔다(그리는 쪽이 이스케이프한다)
    expect(cleanLine('x'.repeat(1000), 10)).toBe('');
  });

  it('받은 교사 방 정보와 닉네임 목록은 모양이 맞는 것만 남긴다', () => {
    expect(readClassInfo({ title: '3학년 2반', rank: 1, t: [0, 4] })).toEqual({ title: '3학년 2반', rank: true, teachers: [0, 4] });
    expect(readClassInfo({ title: '', rank: 0, t: [] })).toEqual({ title: '', rank: false, teachers: [] });
    expect(readClassInfo({ title: '가'.repeat(21), rank: 1, t: [] })).toMatchObject({ title: '' });
    for (const bad of [null, 'x', { title: 3, t: [] }, { title: 'a', t: [99] }, { title: 'a', t: 'x' }]) expect(readClassInfo(bad)).toBeNull();
    expect(readNames([[1, '달팽이'], [1, '겹침'], [2, '가나다라마바사아자차카'], [31, '밖'], ['x', 'y'], [3, '\u202E'], null, [4, '<b>굵게</b>']])).toEqual([[1, '달팽이'], [4, '<b>굵게</b>']]);
    expect(readNames('x')).toEqual([]);
  });
});

// ---------- 방의 규칙: 교사 방 ----------
type Sock = { name: string; got: string[]; closed: [number, string] | null; saved: Saved | null };
const sock = (name: string): Sock => ({ name, got: [], closed: null, saved: null });
const J = (o: Partial<JoinQuery> = {}): JoinQuery => ({ mode: 'join', view: 'auto', id: '', pub: false, big: false, ...o });
const CODE = 'ABCDEF';
const INFO: RoomInfo = { pack: 'math/graph-factory', stage: 1, seed: 77, run: 3, pub: false, big: false, order: [0, 1, 2] };
const CLAIMS: PassClaims = { u: TEACHER, n: '창욱쌤', a: 1, iat: NOW - 60, exp: NOW + 3600, c: 1 };
/** 방 하나. 출입증은 '맞는 것'을 good, 다른 교사의 것을 other 로 흉내 낸다(서명 확인은 위에서 따로 본다). */
function room(withPass = true) {
  const ranks: RankReport[] = [], uses: UseReport[] = [], agrees: { teacher: string; version: number }[] = [];
  const core: RoomCore<Sock> = new RoomCore<Sock>({
    send: (s, t) => { if (!s.closed) s.got.push(t); },
    close: (s, code, reason) => { s.closed ??= [code, reason]; },
    save: (s, saved) => { s.saved = saved; },
    ...(withPass ? { pass: (seat: number, key: number, pass: string, setup: { title: string; rank: boolean; agree: boolean }) => core.grant(seat, key, pass === 'good' ? CLAIMS : pass === 'new' ? { ...CLAIMS, c: 0 } : pass === 'other' ? { ...CLAIMS, u: OTHER } : null, setup, 0) } : {}),
    agree: a => agrees.push(a),
    rank: r => ranks.push(r),
    use: u => uses.push(u),
  });
  const enter = (name: string, q: Partial<JoinQuery> = {}, now = 0) => { const s = sock(name); core.join(s, CODE, J(q), now); return s; };
  const say = (s: Sock, msg: unknown, now = 0) => core.message(s.saved!.seat, s.saved!.key, typeof msg === 'string' ? msg : JSON.stringify(msg), now);
  const bye = (s: Sock) => core.leave(s.saved!.seat, s.saved!.key);
  const all = (s: Sock, t: string) => s.got.map(x => { try { return JSON.parse(x); } catch { return {}; } }).filter(m => m.t === t);
  const last = (s: Sock, t: string) => all(s, t).pop();
  /** 선생님이 방을 만들고 출입증을 낸다. */
  const teach = (setup: { title?: string; rank?: 0 | 1 } = { title: '3학년 2반', rank: 1 }) => { const t = enter('선생님', { mode: 'create' }); say(t, { t: 'pass', v: 'good', ...setup }); return t; };
  return { core, ranks, uses, enter, say, bye, all, last, teach, agrees };
}

describe('판 번호', () => {
  it('다음 판 번호는 1 씩 오르고, 상한에 닿았거나 이상한 값이면 1 로 돌아간다(방 서버가 받는 범위를 벗어나지 않는다)', () => {
    expect([nextRun(0), nextRun(4), nextRun(RUN_MAX - 1)]).toEqual([1, 5, RUN_MAX]);
    expect([nextRun(RUN_MAX), nextRun(RUN_MAX + 5), nextRun(-1), nextRun(1.5), nextRun(Number.NaN)]).toEqual([1, 1, 1, 1, 1]);
    for (const run of [0, 7, RUN_MAX - 1, RUN_MAX]) expect(cleanRoomInfo({ ...INFO, run: nextRun(run) })).not.toBeNull();
    expect(cleanRoomInfo({ ...INFO, run: RUN_MAX + 1 })).toBeNull();
  });
});

describe('교사 방: 출입증으로 방 열기', () => {
  it('선생님 방 안내에 동의한 선생님만 교사 방을 연다. 처음 동의하면 도름스에 적으라고 알린다', () => {
    const r = room(), t = r.enter('선생님', { mode: 'create' });
    r.say(t, { t: 'pass', v: 'new', title: '반', rank: 1 }, 0);                             // 동의 기록이 없고 지금도 동의하지 않았다
    expect(r.last(t, 'pass')).toEqual({ t: 'pass', ok: 0 });
    expect([r.core.isClass, r.agrees]).toEqual([false, []]);                               // 보통 방으로 남는다
    r.say(t, { t: 'pass', v: 'new', title: '반', rank: 1, agree: 1 }, 4000);                // 그 자리에서 동의했다
    expect(r.last(t, 'pass')).toEqual({ t: 'pass', ok: 1 });
    expect([r.core.isClass, r.agrees]).toEqual([true, [{ teacher: TEACHER, version: 1 }]]);
    const r2 = room(), t2 = r2.enter('선생님', { mode: 'create' });
    r2.say(t2, { t: 'pass', v: 'good', title: '반' }, 0);                                   // 전에 동의해 출입증에 적혀 있으면 다시 알리지 않는다
    expect([r2.core.isClass, r2.agrees]).toEqual([true, []]);
  });

  it('방을 만든 연결이 맞는 출입증을 내면 교사 방이 되고, 방 제목과 순위에 올리기가 정해진다', () => {
    const r = room(), t = r.enter('선생님', { mode: 'create' });
    expect(r.last(t, 'hi')).not.toHaveProperty('cls');                                     // 처음에는 보통 방이다
    r.say(t, { t: 'pass', v: 'good', title: ' 3학년\n2반 ', rank: 1 });
    expect(r.last(t, 'pass')).toEqual({ t: 'pass', ok: 1 });
    expect(r.core.isClass).toBe(true);
    expect(r.last(t, 'class')).toEqual({ t: 'class', cls: { title: '3학년 2반', rank: 1, t: [0] }, names: [] });
    expect(r.last(t, 'asks')).toEqual({ t: 'asks', list: [] });
    const s = r.enter('학생');
    expect(r.last(s, 'hi')).toMatchObject({ cls: { title: '3학년 2반', rank: 1, t: [0] }, names: [], ask: '' });
    expect(JSON.stringify(s.got)).not.toContain(TEACHER);                                  // 교사의 회원 번호는 방에 알리지 않는다
    expect(JSON.stringify(s.got)).not.toContain('창욱쌤');
  });

  it('출입증이 틀리면 보통 방 그대로다. 출입증 없이 교사 글을 보내도 아무 일이 없다', () => {
    const r = room(), t = r.enter('방을 만든 사람', { mode: 'create' }), s = r.enter('학생');
    r.say(t, { t: 'pass', v: 'forged', title: '가짜 방', rank: 1 });
    expect(r.last(t, 'pass')).toEqual({ t: 'pass', ok: 0 });
    expect(r.core.isClass).toBe(false);
    const n = [t.got.length, s.got.length];
    r.say(s, { t: 'name', v: '달팽이' });                                                    // 학생끼리 연 방에는 닉네임이 없다
    r.say(t, { t: 'ok', s: 1, y: 1, v: '달팽이' });
    r.say(t, { t: 'room', room: INFO }, 1000);
    r.say(t, { t: 'won', r: 3, ms: 60_000 }, 70_000);
    expect(t.got.length).toBe(n[0]);                                                       // 닉네임 · 순위에 관한 글은 하나도 오가지 않는다
    expect(r.all(s, 'me').length + r.all(s, 'class').length + r.all(s, 'rank').length).toBe(0);
    expect(r.ranks).toEqual([]); expect(r.uses).toEqual([]);
  });

  it('비밀값이 없는 방 서버(출입증을 확인할 길이 없음)는 어떤 출입증도 받지 않는다', () => {
    const r = room(false), t = r.enter('선생님', { mode: 'create' });
    r.say(t, { t: 'pass', v: 'good', title: '방', rank: 1 });
    expect(r.last(t, 'pass')).toEqual({ t: 'pass', ok: 0 });
    expect(r.core.isClass).toBe(false);
  });

  it('남이 연 방은 출입증으로 차지할 수 없다. 한 교사는 방을 여럿 열 수 있다(출입증은 방에 묶이지 않는다)', () => {
    const r = room(), kid = r.enter('학생이 연 방', { mode: 'create' }), t = r.enter('들어온 선생님');
    r.say(t, { t: 'pass', v: 'good', title: '내 방', rank: 1 });
    expect(r.last(t, 'pass')).toEqual({ t: 'pass', ok: 0 });
    expect(r.core.isClass).toBe(false);
    expect(kid.got.some(x => x.includes('"class"'))).toBe(false);
    const one = room(), two = room();
    one.teach(); two.teach({ title: '4학년 1반' });
    expect([one.core.isClass, two.core.isClass]).toEqual([true, true]);
  });

  it('교사 방에 다른 교사가 출입증을 내도 그 방의 교사가 되지 못한다', () => {
    const r = room(), t = r.teach(), o = r.enter('다른 선생님'), s = r.enter('학생');
    r.say(o, { t: 'pass', v: 'other' });
    expect(r.last(o, 'pass')).toEqual({ t: 'pass', ok: 0 });
    r.say(s, { t: 'name', v: '달팽이' });
    r.say(o, { t: 'ok', s: s.saved!.seat, y: 1, v: '달팽이' });
    expect(r.last(s, 'me')).toMatchObject({ st: 'wait' });
    expect(r.all(o, 'asks')).toEqual([]);                                                  // 신청 목록도 받지 못한다
    expect(r.last(t, 'asks')).toEqual({ t: 'asks', list: [[2, '달팽이']] });
  });

  it('출입증은 3초에 한 번만 받는다. 손님이 내는 출입증 글은 1KB 까지, 그 밖의 손님 글은 256바이트 그대로다', () => {
    const r = room(), t = r.teach(), g = r.enter('돌아온 선생님');
    r.say(g, { t: 'pass', v: 'x'.repeat(700) }, 0);
    expect(g.closed).toBeNull();
    expect(r.all(g, 'pass')).toEqual([{ t: 'pass', ok: 0 }]);
    r.say(g, { t: 'pass', v: 'good' }, PASS_GAP - 1);
    expect(r.all(g, 'pass').length).toBe(1);                                               // 너무 빨리 또 냈다: 답하지 않는다
    r.say(g, { t: 'pass', v: 'good' }, PASS_GAP + 1);
    expect(r.last(g, 'pass')).toEqual({ t: 'pass', ok: 1 });
    expect(r.last(t, 'class').cls.t).toEqual([0, 1]);
    const big = r.enter('큰 글');
    r.say(big, { t: 'name', v: 'x'.repeat(300) }, 0);
    expect(big.closed?.[0]).toBe(CLOSE.tooBig);
    const huge = r.enter('너무 큰 출입증');
    r.say(huge, `{"t":"pass","v":"${'x'.repeat(LIMITS.pass)}"}`, 0);
    expect(huge.closed?.[0]).toBe(CLOSE.tooBig);
  });
});

describe('교사 방: 닉네임 신청과 승인', () => {
  it('학생이 신청하면 교사에게만 뜨고, 승인하면 모두에게 닉네임이 보인다', () => {
    const r = room(), t = r.teach(), a = r.enter('학생 1'), b = r.enter('학생 2');
    r.say(a, { t: 'name', v: '  달팽이\n' });
    expect(r.last(a, 'me')).toEqual({ t: 'me', st: 'wait', v: '달팽이' });
    expect(r.last(t, 'asks')).toEqual({ t: 'asks', list: [[1, '달팽이']] });
    expect(r.all(b, 'asks')).toEqual([]);                                                  // 승인 전의 글자는 다른 학생에게 가지 않는다
    expect(JSON.stringify(b.got)).not.toContain('달팽이');
    r.say(t, { t: 'ok', s: 1, y: 1, v: '달팽이' });
    expect(r.last(a, 'me')).toEqual({ t: 'me', st: 'ok', v: '달팽이' });
    expect(r.last(b, 'class')).toEqual({ t: 'class', cls: { title: '3학년 2반', rank: 1, t: [0] }, names: [[1, '달팽이']] });
    expect(r.last(t, 'asks')).toEqual({ t: 'asks', list: [] });
    const late = r.enter('늦게 온 학생');
    expect(r.last(late, 'hi').names).toEqual([[1, '달팽이']]);
  });

  it('반려하면 그 학생에게만 다시 적으라고 알린다. 닉네임은 보이지 않는다', () => {
    const r = room(), t = r.teach(), a = r.enter('학생 1'), b = r.enter('학생 2');
    r.say(a, { t: 'name', v: '바보' });
    r.say(t, { t: 'ok', s: 1, y: 0, v: '바보' });
    expect(r.last(a, 'me')).toEqual({ t: 'me', st: 'no' });
    expect(r.all(b, 'me')).toEqual([]);
    expect(JSON.stringify(b.got)).not.toContain('바보');
    expect(r.last(t, 'asks')).toEqual({ t: 'asks', list: [] });
    r.say(a, { t: 'name', v: '고래' }, 10);                                                  // 반려받았으면 10초를 기다리지 않고 바로 다시 신청할 수 있다
    r.say(a, { t: 'name', v: '상어' }, 20);                                                  // 다만 그 뒤로는 다시 10초에 한 번
    expect(r.last(a, 'me')).toEqual({ t: 'me', st: 'slow' });
    r.say(t, { t: 'ok', s: 1, y: 1, v: '고래' }, 30);
    expect(r.last(b, 'class').names).toEqual([[1, '고래']]);
  });

  it('교사는 이미 승인한 닉네임을 지울 수 있다(그 학생에게는 다시 적으라고 알린다)', () => {
    const r = room(), t = r.teach(), a = r.enter('학생');
    r.say(a, { t: 'name', v: '달팽이' }); r.say(t, { t: 'ok', s: 1, y: 1, v: '달팽이' });
    r.say(t, { t: 'ok', s: 1, y: 0, v: '달팽이' });
    expect(r.last(a, 'me')).toEqual({ t: 'me', st: 'no' });
    expect(r.last(a, 'class').names).toEqual([]);
  });

  it('승인과 반려는 교사만 한다. 학생이 보낸 승인은 버린다(자기 것도, 남의 것도)', () => {
    const r = room(), t = r.teach(), a = r.enter('학생 1'), b = r.enter('학생 2');
    r.say(a, { t: 'name', v: '달팽이' });
    r.say(a, { t: 'ok', s: 1, y: 1, v: '달팽이' });
    r.say(b, { t: 'ok', s: 1, y: 1, v: '달팽이' });
    r.say(b, { t: 'ok', s: 1, y: 0, v: '달팽이' });
    expect(r.all(a, 'me')).toEqual([{ t: 'me', st: 'wait', v: '달팽이' }]);
    expect(r.last(t, 'class').names).toEqual([]);
    expect(r.last(t, 'asks').list).toEqual([[1, '달팽이']]);
  });

  it('교사가 본 닉네임과 지금 신청이 다르면 승인하지 않는다(그새 바뀐 신청)', () => {
    const r = room(), t = r.teach(), a = r.enter('학생');
    r.say(a, { t: 'name', v: '달팽이' }, 0);
    r.say(a, { t: 'name', v: '나쁜말' }, ASK_GAP + 1);                                       // 교사 화면이 바뀌기 전에 승인을 눌렀다
    r.say(t, { t: 'ok', s: 1, y: 1, v: '달팽이' }, ASK_GAP + 2);
    expect(r.last(t, 'class').names).toEqual([]);
    expect(r.last(t, 'asks').list).toEqual([[1, '나쁜말']]);
    for (const bad of [{ s: 9, y: 1, v: '나쁜말' }, { s: 1, y: 2, v: '나쁜말' }, { s: '1', y: 1, v: '나쁜말' }, { s: 1, y: 1 }, { s: 1, y: 1, v: '' }]) r.say(t, { t: 'ok', ...bad }, ASK_GAP + 3);
    expect(r.last(t, 'class').names).toEqual([]);
  });

  it('신청은 연결마다 10초에 한 번. 쓸 수 없는 글과 너무 잦은 신청은 그 까닭을 알려 준다', () => {
    const r = room(), t = r.teach(), a = r.enter('학생');
    r.say(a, { t: 'name', v: '달팽이' }, 1000);
    r.say(a, { t: 'name', v: '고래' }, 1000 + ASK_GAP - 1);
    expect(r.last(a, 'me')).toEqual({ t: 'me', st: 'slow' });
    expect(r.last(t, 'asks').list).toEqual([[1, '달팽이']]);
    for (const bad of ['', '가나다라마바사아자차카', '\n', 7, null]) r.say(a, { t: 'name', v: bad }, 1000 + ASK_GAP - 1);
    expect(r.all(a, 'me').filter(m => m.st === 'bad').length).toBe(5);
    r.say(a, { t: 'name', v: '고래' }, 1000 + ASK_GAP);
    expect(r.last(t, 'asks').list).toEqual([[1, '고래']]);                                   // 새 신청이 앞의 것을 갈아 치운다(한 사람에 하나)
  });

  it('교사가 나가 있으면 신청은 쌓이고(한 사람에 하나, 서른 자리라 30개까지), 출입증으로 다시 들어오면 보인다', () => {
    const r = room(), t = r.teach();
    const kids = Array.from({ length: MAX_SEATS - 1 }, (_, i) => r.enter(`학생 ${i + 1}`));
    r.bye(t);
    expect(r.core.isClass).toBe(true);                                                     // 교사가 나가도 교사 방은 이어진다
    expect(r.last(kids[0], 'class').cls.t).toEqual([]);                                    // 다만 지금은 교사가 없다
    kids.forEach((k, i) => r.say(k, { t: 'name', v: `별명${i + 1}` }, 100 + i));
    r.say(kids[0], { t: 'ok', s: kids[1].saved!.seat, y: 1, v: '별명2' }, 200);              // 새 방장(학생)도 승인하지 못한다
    expect(r.last(kids[0], 'class').names).toEqual([]);
    const back = r.enter('돌아온 선생님');
    expect(r.all(back, 'asks')).toEqual([]);                                               // 출입증을 내기 전에는 아무것도 보이지 않는다
    r.say(back, { t: 'pass', v: 'good' });
    expect(r.last(back, 'asks').list.length).toBe(MAX_SEATS - 1);
    expect(r.last(back, 'asks').list[0]).toEqual([1, '별명1']);                             // 신청한 차례대로
    r.say(back, { t: 'ok', s: 1, y: 1, v: '별명1' }, 300);
    expect(r.last(kids[5], 'class')).toMatchObject({ names: [[1, '별명1']], cls: { t: [0] } });
  });

  it('닉네임을 가진 학생이 나가면 명단에서 빠지고, 신청만 해 둔 학생이 나가면 신청도 사라진다', () => {
    const r = room(), t = r.teach(), a = r.enter('학생 1'), b = r.enter('학생 2');
    r.say(a, { t: 'name', v: '달팽이' }); r.say(t, { t: 'ok', s: 1, y: 1, v: '달팽이' });
    r.say(b, { t: 'name', v: '고래' });
    r.bye(a); r.bye(b);
    expect(r.last(t, 'class').names).toEqual([]);
    expect(r.last(t, 'asks').list).toEqual([]);
  });

  it('같은 창이 다시 붙으면 닉네임은 그대로지만 교사 확인은 다시 받아야 한다', () => {
    const r = room(), id = 'a'.repeat(16), tid = 'b'.repeat(16);
    const t = r.enter('선생님', { mode: 'create', id: tid }); r.say(t, { t: 'pass', v: 'good', title: '반', rank: 0 });
    const a = r.enter('학생', { id });
    r.say(a, { t: 'name', v: '달팽이' }); r.say(t, { t: 'ok', s: 1, y: 1, v: '달팽이' });
    const a2 = r.enter('학생(다시 붙음)', { id });
    expect(r.last(a2, 'hi').names).toEqual([[1, '달팽이']]);
    const t2 = r.enter('선생님(다시 붙음)', { id: tid });
    expect(r.last(t2, 'hi').cls.t).toEqual([]);
    r.say(a2, { t: 'name', v: '고래' }, ASK_GAP + 1);
    r.say(t2, { t: 'ok', s: 1, y: 1, v: '고래' }, ASK_GAP + 2);
    expect(r.last(a2, 'class').names).toEqual([[1, '달팽이']]);                              // 아직 교사가 아니다
    r.say(t2, { t: 'pass', v: 'good' }, ASK_GAP + 3);
    r.say(t2, { t: 'ok', s: 1, y: 1, v: '고래' }, ASK_GAP + 4);
    expect(r.last(a2, 'class').names).toEqual([[1, '고래']]);
  });

  it('잠들었다 깬 교사 방은 연결에 붙여 둔 값으로 되살아난다(방 제목 · 닉네임 · 기다리는 신청 · 교사). 붙임값은 2KB 를 넘지 않는다', () => {
    const r = room(), t = r.enter('선생님', { mode: 'create' });
    r.say(t, { t: 'pass', v: 'good', title: '가'.repeat(20), rank: 1 });
    const kids = Array.from({ length: MAX_SEATS - 1 }, (_, i) => r.enter(`학생 ${i + 1}`));
    r.say(kids[0], { t: 'name', v: '가나다라마바사아자차' }); r.say(t, { t: 'ok', s: 1, y: 1, v: '가나다라마바사아자차' });
    r.say(kids[0], { t: 'name', v: '하나둘셋넷다섯여섯일' }, ASK_GAP + 1);
    r.say(kids[1], { t: 'name', v: '고래' });
    r.say(t, { t: 'room', room: { ...INFO, order: Array.from({ length: MAX_SEATS }, (_, i) => i) } }, ASK_GAP + 5000);
    for (const s of [t, ...kids]) expect(new TextEncoder().encode(JSON.stringify(s.saved)).length).toBeLessThan(1500);
    expect(kids[3].saved).not.toHaveProperty('cls');                                       // 교사 방 정보는 방장과 교사의 연결에만 붙는다
    const woke = room();
    for (const s of [...kids, t]) woke.core.restore(s, s.saved!);
    expect(woke.core.isClass).toBe(true);
    kids[5].got.length = 0; t.got.length = 0;
    woke.core.message(t.saved!.seat, t.saved!.key, JSON.stringify({ t: 'ok', s: 2, y: 1, v: '고래' }), ASK_GAP + 9000);   // 되살아난 교사가 승인한다
    expect(JSON.parse(kids[5].got.pop()!)).toEqual({ t: 'class', cls: { title: '가'.repeat(20), rank: 1, t: [0] }, names: [[1, '가나다라마바사아자차'], [2, '고래']] });
    expect(JSON.parse(t.got.pop()!)).toEqual({ t: 'asks', list: [[1, '하나둘셋넷다섯여섯일']] });
    woke.core.message(t.saved!.seat, t.saved!.key, JSON.stringify({ t: 'won', r: 3, ms: 3500 }), ASK_GAP + 9000);        // 판이 열린 때도 이어진다
    expect(woke.ranks.length).toBe(1);
  });
});

describe('교사 방: 순위와 쓰임 알림', () => {
  /** 교사 방을 열고 세 명이 스테이지를 시작한다(1초에 판이 열렸다). */
  function playing(setup?: { title?: string; rank?: 0 | 1 }) {
    const r = room(), t = r.teach(setup), a = r.enter('학생 1'), b = r.enter('학생 2');
    r.say(t, { t: 'room', room: INFO }, 1000);
    return { r, t, a, b };
  }

  it('방장이 깼다고 알리면 방이 아는 값(팩 · 스테이지 · 인원 · 방 제목 · 교사)과 방 서버가 잰 시간으로 순위에 올리고, 받은 등수를 모두에게 알린다', () => {
    const { r, t, a } = playing();
    r.say(t, { t: 'won', r: 3, ms: 83_450, title: '가짜 제목', players: 30, pack: 'x/y', teacher: OTHER }, 1000 + 83_600);
    expect(r.ranks).toEqual([{ run: 3, pack: 'math/graph-factory', stage: 1, ms: 83_600, players: 3, title: '3학년 2반', teacher: TEACHER }]);   // 시간은 판이 열린 때(1초)부터 잰 값
    r.core.ranked(3, 83_600, 3, true);
    expect(r.last(a, 'rank')).toEqual({ t: 'rank', r: 3, ms: 83_600, rank: 3, best: 1 });
    expect(JSON.stringify(a.got)).not.toContain(TEACHER);
  });

  it('도름스가 답하지 않아도 방은 그대로 가고, 올리지 못했다고(등수 0) 알린다', () => {
    const { r, t, a } = playing();
    r.say(t, { t: 'won', r: 3, ms: 60_000 }, 61_000);
    r.core.ranked(3, 60_000, 0, false);
    expect(r.last(a, 'rank')).toEqual({ t: 'rank', r: 3, ms: 60_000, rank: 0, best: 0 });
    r.say(t, { t: 'room', room: { ...INFO, stage: 2, run: 4 } }, 70_000);
    expect(r.last(a, 'room').room.stage).toBe(2);
    expect(readRankReply({ ok: true, rank: 3, best: true })).toEqual({ rank: 3, best: true });
    for (const bad of [null, 'x', {}, { ok: false, rank: 1 }, { ok: true, rank: 0 }, { ok: true, rank: '1' }, { ok: true, rank: 1.5 }]) expect(readRankReply(bad)).toEqual({ rank: 0, best: false });
  });

  it('손님이 방장인 척 보낸 순위는 버린다', () => {
    const { r, t, a } = playing();
    r.say(a, { t: 'won', r: 3, ms: 9000 }, 10_000);
    expect(r.ranks).toEqual([]);
    r.say(t, { t: 'won', r: 3, ms: 9000 }, 10_000);
    expect(r.ranks.length).toBe(1);
  });

  it('방장이 걸린 시간을 실제보다 짧게 알려 순위를 꾸미지 못한다: 방 서버가 잰 시간과 양쪽으로 가까울 때만 받고, 적는 값은 방 서버가 잰 값이다', () => {
    const open = 1000;
    for (const [said, at] of [[3000, open + 60_000], [57_999, open + 60_000], [10_000, open + 3600_000], [61_501, open + 60_000], [60_000, open + 58_499]] as const) {
      const { r, t } = playing();
      r.say(t, { t: 'won', r: 3, ms: said }, at);                                          // 1분 걸린 판을 3초라고 하거나, 2초 넘게 줄이거나, 1.5초 넘게 늘린다
      expect([said, at, r.ranks]).toEqual([said, at, []]);
    }
    for (const [said, at] of [[58_000, open + 60_000], [61_500, open + 60_000], [60_000, open + 60_000]] as const) {
      const { r, t } = playing();
      r.say(t, { t: 'won', r: 3, ms: said }, at);
      expect(r.ranks.map(x => x.ms)).toEqual([60_000]);                                    // 방장이 뭐라고 했든 적히는 것은 방 서버가 잰 1분
    }
    expect(RANK.under).toBeLessThan(RANK.min);                                             // 여유는 가장 짧은 기록보다 분명히 작다
    expect(RANK.slack).toBeLessThan(RANK.min);
  });

  it('시간은 3초 이상 3시간 이하다(방 서버가 잰 값으로 본다). 모양이 어긋난 값은 버린다', () => {
    const quick = playing();
    quick.r.say(quick.t, { t: 'won', r: 3, ms: 3000 }, 1000 + RANK.min - 1);               // 판이 열린 지 3초가 안 됐다
    for (const bad of [1.5, '9000', null, -1, RANK.min - 1]) quick.r.say(quick.t, { t: 'won', r: 3, ms: bad }, 1000 + 9000);
    expect(quick.r.ranks).toEqual([]);
    quick.r.say(quick.t, { t: 'won', r: 3, ms: 9000 }, 1000 + 9000);
    expect(quick.r.ranks.map(x => x.ms)).toEqual([9000]);
    const long = playing();
    long.r.say(long.t, { t: 'won', r: 3, ms: RANK.max }, 1000 + RANK.max + 1);                // 3시간을 넘겼다
    expect(long.r.ranks).toEqual([]);
    const edge = playing();
    edge.r.say(edge.t, { t: 'won', r: 3, ms: RANK.max }, 1000 + RANK.max);
    expect(edge.r.ranks.map(x => x.ms)).toEqual([RANK.max]);
  });

  it('같은 판은 한 번만 올린다. 지금 열려 있는 판이 아니면 버린다', () => {
    const { r, t } = playing();
    r.say(t, { t: 'won', r: 2, ms: 9000 }, 10_000);                                        // 지난 판
    r.say(t, { t: 'won', r: 4, ms: 9000 }, 10_000);                                        // 아직 없는 판
    expect(r.ranks).toEqual([]);
    r.say(t, { t: 'won', r: 3, ms: 9000 }, 10_000);
    r.say(t, { t: 'won', r: 3, ms: 9100 }, 10_100);
    expect(r.ranks.map(x => x.ms)).toEqual([9000]);
    r.say(t, { t: 'room', room: { ...INFO, stage: -1 } }, 11_000);                          // 스테이지를 고르는 중
    r.say(t, { t: 'won', r: 3, ms: 10_000 }, 11_100);
    r.say(t, { t: 'room', room: { ...INFO, run: 4 } }, 12_000);
    r.say(t, { t: 'won', r: 4, ms: 5000 }, 17_500);
    expect(r.ranks.map(x => [x.run, x.ms])).toEqual([[3, 9000], [4, 5500]]);
    r.say(t, { t: 'room', room: { ...INFO, stage: -1, run: 4 } }, 18_000);                  // 같은 판 번호로 다시 열어도(방장이 판 번호를 올리지 않아도) 다시 올리지 못한다
    r.say(t, { t: 'room', room: { ...INFO, run: 4 } }, 19_000);
    r.say(t, { t: 'won', r: 4, ms: 4000 }, 23_000);
    expect(r.ranks.length).toBe(2);
  });

  it('한 방이 순위를 올리는 것은 1분에 여섯 번까지다(판을 잇달아 열어 쏟아 내지 못한다)', () => {
    const { r, t } = playing();
    for (let i = 0; i < 10; i++) {                                                         // 3.5초마다 새 판을 열고 3초 만에 깼다고 한다
      r.say(t, { t: 'room', room: { ...INFO, run: 10 + i } }, 2000 + i * 3500);
      r.say(t, { t: 'won', r: 10 + i, ms: 3000 }, 2000 + i * 3500 + 3000);
    }
    expect(r.ranks.map(x => x.run)).toEqual([10, 11, 12, 13, 14, 15]);
    r.say(t, { t: 'room', room: { ...INFO, run: 30 } }, 70_000);                            // 1분이 지나면 다시 올릴 수 있다
    r.say(t, { t: 'won', r: 30, ms: 4000 }, 74_000);
    expect(r.ranks.length).toBe(7);
  });

  it('팩 모양과 스테이지 범위(0~29)를 방 서버가 다시 본다: 어긋나면 순위도 쓰임도 알리지 않는다', () => {
    const { r, t } = playing();
    r.say(t, { t: 'room', room: { ...INFO, stage: 30, run: 4 } }, 2000);                    // 방 정보로는 받는 값이지만(99 까지) 바깥으로는 알리지 않는다
    r.say(t, { t: 'won', r: 4, ms: 5000 }, 7000);
    r.say(t, { t: 'room', room: { ...INFO, pack: 'new/pack', stage: 30, run: 5 } }, 8000);
    expect([r.ranks, r.uses.map(u => u.pack)]).toEqual([[], ['math/graph-factory']]);
    r.say(t, { t: 'room', room: { ...INFO, stage: 29, run: 6 } }, 9000);
    r.say(t, { t: 'won', r: 6, ms: 5000 }, 14_000);
    expect(r.ranks.map(x => x.stage)).toEqual([29]);
    for (const pack of ['../x', 'a/b/c', 'A/b', 'x'.repeat(70)]) {                        // 모양이 어긋난 팩 이름은 방 정보에서부터 받지 않는다
      r.say(t, { t: 'room', room: { ...INFO, pack, run: 7 } }, 15_000);
      expect(r.core.info.pack).toBe('math/graph-factory');
    }
  });

  it('순위에 올리기를 켜지 않았거나, 방 제목이 없거나, 학생끼리 연 방이면 올리지 않는다', () => {
    const off = playing({ title: '3학년 2반', rank: 0 });
    off.r.say(off.t, { t: 'won', r: 3, ms: 9000 }, 10_000);
    expect(off.r.ranks).toEqual([]);
    const untitled = playing({ rank: 1 });
    expect(untitled.r.last(untitled.t, 'class').cls).toMatchObject({ title: '', rank: 0 });   // 방 제목 없이 켠 것은 꺼진 것으로 받는다
    untitled.r.say(untitled.t, { t: 'won', r: 3, ms: 9000 }, 10_000);
    expect(untitled.r.ranks).toEqual([]);
  });

  it('사람 수는 방 서버가 아는 자리 수다(방장이 준 차례를 쓰지 않는다). 함께 보기로 만든 방의 큰 화면 한 자리는 뺀다', () => {
    const { r, t } = playing();
    r.say(t, { t: 'room', room: { ...INFO, order: [1] } }, 2000);                           // 방장이 한 명뿐이라고 해도
    r.say(t, { t: 'won', r: 3, ms: 9000 }, 10_000);
    expect(r.ranks[0].players).toBe(3);                                                    // 방에 있는 자리는 셋이다
    const big = room(), screen = big.enter('큰 화면', { mode: 'create', big: true });
    big.say(screen, { t: 'pass', v: 'good', title: '함께 보기 반', rank: 1 });
    for (let i = 0; i < 28; i++) big.enter(`조작기 ${i + 1}`);
    big.say(screen, { t: 'room', room: { ...INFO, big: true, order: [] } }, 1000);
    big.say(screen, { t: 'won', r: 3, ms: 9000 }, 10_000);
    expect(big.ranks[0].players).toBe(28);                                                 // 큰 화면은 세지 않는다
  });

  it('순위는 교사의 기기가 방장이고 그 기기가 연 판일 때만 오른다. 교사가 돌아오면 방장을 돌려받는다', () => {
    const { r, t, a } = playing();
    r.bye(t);
    expect(a.saved).toMatchObject({ host: true, cls: { u: TEACHER, title: '3학년 2반' } });   // 교사 방 정보는 새 방장의 연결로 옮겨 붙는다
    r.say(a, { t: 'won', r: 3, ms: 9000 }, 10_000);                                        // 학생 기기가 방장인 동안의 기록
    expect(r.ranks).toEqual([]);
    r.say(a, { t: 'room', room: { ...INFO, run: 4, order: [1, 2] } }, 20_000);             // 학생 기기가 연 판
    const back = r.enter('돌아온 선생님');
    r.say(a, { t: 'won', r: 4, ms: 5000 }, 25_000);
    expect(r.ranks).toEqual([]);
    r.say(back, { t: 'pass', v: 'good' }, 25_100);
    expect(back.saved).toMatchObject({ host: false });                                     // 출입증만으로는 넘어가지 않는다(게임 도중이면 판이 처음으로 돌아간다)
    r.say(a, { t: 'claim' }, 25_120);                                                      // 학생은 청할 수 없다
    expect(a.saved).toMatchObject({ host: true });
    r.say(back, { t: 'claim' }, 25_150);                                                   // 교사 화면이 지금 판의 요약을 받은 뒤 청한다
    expect(back.saved).toMatchObject({ host: true });                                      // 방장이 교사에게 돌아왔다
    expect(a.saved).toMatchObject({ host: false });
    r.say(back, { t: 'won', r: 4, ms: 5200 }, 25_200);                                     // 학생 기기가 연 판은 교사가 방장이 된 뒤에도 오르지 않는다
    expect(r.ranks).toEqual([]);
    r.say(back, { t: 'room', room: { ...INFO, run: 5, order: [1, 2, 3] } }, 30_000);       // 교사의 기기가 연 새 판
    r.say(a, { t: 'won', r: 5, ms: 6000 }, 36_000);                                        // 방장이 아닌 기기가 알린 것은 받지 않는다
    expect(r.ranks).toEqual([]);
    r.say(back, { t: 'won', r: 5, ms: 6000 }, 36_000);
    expect(r.ranks).toEqual([{ run: 5, pack: 'math/graph-factory', stage: 1, ms: 6000, players: 3, title: '3학년 2반', teacher: TEACHER }]);
    r.say(back, { t: 'won', r: 5, ms: 6000 }, 36_500);                                     // 같은 판은 한 번만
    expect(r.ranks.length).toBe(1);
  });

  it('교사가 연 판이라도 도중에 방장이 학생 기기로 넘어갔다 오면 그 판은 순위에 오르지 않는다(다음 판부터 다시 오른다)', () => {
    const { r, t, a } = playing();
    r.bye(t);                                                                              // 교사 화면이 내려가 학생 기기가 방장을 넘겨받았다
    expect(a.saved).toMatchObject({ host: true });
    expect(a.saved).not.toHaveProperty('ok');                                              // 잠들었다 깨도 이 판은 오를 수 없다
    const back = r.enter('돌아온 선생님');
    r.say(back, { t: 'pass', v: 'good' }, 8000);
    r.say(back, { t: 'claim' }, 8100);
    expect(back.saved).toMatchObject({ host: true });
    r.say(back, { t: 'won', r: 3, ms: 9000 }, 9000);                                       // 학생 기기가 꾸며 돌려줬을 수 있는 판
    expect(r.ranks).toEqual([]);
    r.say(back, { t: 'room', room: { ...INFO, run: 4, order: [1, 2, 3] } }, 20_000);
    expect(back.saved).toMatchObject({ host: true, ok: true });
    r.say(back, { t: 'won', r: 4, ms: 6000 }, 26_000);
    expect(r.ranks.length).toBe(1);
  });

  it('쓰임 알림: 교사 방에서 어떤 팩이 처음 열릴 때 팩마다 한 번. 학생끼리 연 방에서는 부르지 않는다', () => {
    const { r, t } = playing();
    expect(r.uses).toEqual([{ pack: 'math/graph-factory', teacher: TEACHER }]);
    r.say(t, { t: 'room', room: { ...INFO, stage: 2, run: 4 } }, 2000);
    r.say(t, { t: 'room', room: { ...INFO, stage: -1, run: 4 } }, 3000);
    r.say(t, { t: 'room', room: { ...INFO, pack: 'etc/tutorial', stage: -1, run: 4 } }, 3500);   // 고르는 중에는 알리지 않는다
    expect(r.uses.length).toBe(1);
    r.say(t, { t: 'room', room: { ...INFO, pack: 'etc/tutorial', stage: 0, run: 5 } }, 4000);
    r.say(t, { t: 'room', room: { ...INFO, run: 6 } }, 5000);
    expect(r.uses).toEqual([{ pack: 'math/graph-factory', teacher: TEACHER }, { pack: 'etc/tutorial', teacher: TEACHER }]);
    const kids = room(), k = kids.enter('학생', { mode: 'create' });
    kids.say(k, { t: 'room', room: INFO }, 1000);
    expect(kids.uses).toEqual([]);
  });

  it('쓰임 알림은 한 방에서 열두 팩까지다(방장이 팩 이름을 바꿔 가며 쏟아 내지 못한다)', () => {
    const { r, t } = playing();
    for (let i = 0; i < 30; i++) r.say(t, { t: 'room', room: { ...INFO, pack: `fake/pack-${i}`, run: 30 + i } }, 2000 + i * 100);
    expect(r.uses.length).toBe(12);
  });

  it('스테이지를 연 뒤에 출입증이 확인돼도 쓰임을 알린다', () => {
    const r = room(), t = r.enter('선생님', { mode: 'create' });
    r.say(t, { t: 'room', room: INFO }, 500);
    expect(r.uses).toEqual([]);
    r.say(t, { t: 'pass', v: 'good', title: '반', rank: 0 }, 600);
    expect(r.uses).toEqual([{ pack: 'math/graph-factory', teacher: TEACHER }]);
  });

  it('도름스에 적는 주소는 이 컴퓨터의 주소로만 바꿀 수 있다(잘못 넣은 값 때문에 비밀값이 다른 곳으로 가지 않게)', () => {
    expect(dormsUrl('ranks')).toBe('https://dorms.school/api/world/ranks');
    expect(dormsUrl('uses', '')).toBe('https://dorms.school/api/world/uses');
    expect(dormsUrl('ranks', 'http://127.0.0.1:8796/ranks')).toBe('http://127.0.0.1:8796/ranks');
    expect(dormsUrl('uses', 'http://localhost:8796/api/world/uses')).toBe('http://localhost:8796/api/world/uses');
    for (const bad of ['https://evil.example/ranks', 'http://127.0.0.1.evil.example:80/x', 'http://localhost:8796@evil.example/x', 'http://localhost/x', 'http://localhost:8796/x?y=http://evil', 'javascript:alert(1)']) expect(dormsUrl('ranks', bad)).toBe('https://dorms.school/api/world/ranks');
  });
});

describe('방 마구 만들기 · 방 코드 훑기 막기(주소마다)', () => {
  it('방 만들기는 같은 주소에서 1분에 10번, 한 시간에 60번까지', () => {
    const g = new Gate();
    for (let i = 0; i < GATE.createPerMin; i++) expect(g.create('학교', 1000 + i)).toBe(true);
    expect(g.create('학교', 2000)).toBe(false);
    expect(g.create('다른 학교', 2000)).toBe(true);                                         // 주소마다 따로 센다
    expect(g.create('학교', 61_500)).toBe(true);                                           // 1분이 지나면 다시 된다
    let made = GATE.createPerMin + 1;
    for (let m = 2; made < GATE.createPerHour; m++) for (let i = 0; i < GATE.createPerMin && made < GATE.createPerHour; i++, made++) expect(g.create('학교', m * 61_000 + i)).toBe(true);
    expect(g.create('학교', 20 * 61_000)).toBe(false);                                     // 한 시간에 60번
    expect(g.create('학교', 3600_000 + 62_000)).toBe(true);
  });

  it('한 반 30명이 같은 주소에서 한꺼번에 들어오는 것은 걸리지 않는다(맞는 코드로 들어오기는 세지 않는다)', () => {
    const g = new Gate();
    for (let n = 0; n < 5; n++) for (let i = 0; i < MAX_SEATS; i++) expect(g.join('학교', 1000 + n * 50 + i)).toBe(true);   // 다섯 반이 한꺼번에
    expect(g.create('학교', 1500)).toBe(true);
  });

  it('서로 다른 틀린 방 코드를 1분에 30개 넘게 넣으면 그 주소의 들어오기를 1분 쉰다', () => {
    const g = new Gate(), code = (i: number) => `AAAA${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`;
    for (let i = 0; i < GATE.wrongCodes; i++) g.miss('훑는 곳', code(i), 1000 + i * 100);
    expect(g.join('훑는 곳', 5000)).toBe(true);
    g.miss('훑는 곳', code(30), 5000);
    expect(g.join('훑는 곳', 5001)).toBe(false);
    expect(g.join('다른 곳', 5001)).toBe(true);
    expect(g.join('훑는 곳', 5000 + GATE.restMs - 1)).toBe(false);
    expect(g.join('훑는 곳', 5000 + GATE.restMs)).toBe(true);
    expect(g.create('훑는 곳', 5001)).toBe(true);                                          // 만들기는 따로 센다
  });

  it('같은 코드를 여러 번 틀리는 것은 훑기가 아니다(방 서버가 새로 뜬 직후 한 반이 같은 코드를 다시 두드린다)', () => {
    const g = new Gate();
    for (let i = 0; i < 29 * 5; i++) g.miss('학교', 'ABCDEF', 1000 + i * 10);
    for (let i = 0; i < 9; i++) g.miss('학교', `GHJKM${i + 2}`, 3000 + i);                   // 옆 반 아홉도
    expect(g.join('학교', 4000)).toBe(true);
    for (let i = 0; i < 40; i++) g.miss('학교', `QRST${i % 9 + 1}${Math.floor(i / 9) + 2}`, 70_000 + i * 2100);   // 천천히 틀리면(1분에 30개 이하) 쉬지 않는다
    expect(g.join('학교', 70_000 + 40 * 2100)).toBe(true);
  });

  it('세는 표는 끝없이 자라지 않는다', () => {
    const g = new Gate();
    for (let i = 0; i < GATE.keys + 500; i++) g.join(`주소 ${i}`, i);
    expect(g.size).toBeLessThanOrEqual(GATE.keys);
  });

  it('주소를 세는 단위: IPv4 는 그대로, IPv6 는 앞 64비트', () => {
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:0DB8:0001:0002::1')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8::1')).toBe(ipKey('2001:db8:0:0:9:9:9:9'));
    expect(ipKey('2001:db8:1:3::1')).not.toBe(ipKey('2001:db8:1:2::1'));
    expect([ipKey(''), ipKey(null), ipKey(undefined)]).toEqual(['', '', '']);
  });
});

describe('손님의 조작: 되풀이 간격 1초', () => {
  const right: Pad = { m: 1, j: false, a: false, jn: 0 };

  it('바뀌면 바로 보내고(초당 서른 번까지), 안 바뀌면 1초에 한 번만 다시 보낸다', () => {
    const sent: [number, Pad][] = [];
    let now = 0;
    const send = padSender(p => sent.push([now, p]));
    for (now = 0; now <= 5000; now += 16) send(now < 3000 ? right : { ...right, m: 0 }, now);
    const held = sent.filter(([t]) => t < 3000), after = sent.filter(([t]) => t >= 3000);
    expect(held.length).toBe(3);                                                           // 3초 누르는 동안 처음 한 번과 1초마다 한 번(옛 간격 0.25초면 열두 번)
    expect(held[1][0] - held[0][0]).toBeGreaterThanOrEqual(PAD_REPEAT_MS);
    expect(after[0][0]).toBeLessThan(3000 + 50);                                           // 손을 떼면 바로 간다
    expect(after[0][1].m).toBe(0);
    const fast: number[] = [];
    const s2 = padSender(() => fast.push(now));
    for (now = 0; now < 1000; now += 4) s2({ m: now % 8 ? 1 : -1, j: false, a: false, jn: 0 }, now);   // 4ms 마다 바뀌어도
    expect(fast.length).toBeLessThanOrEqual(31);
  });

  it('짧게 누른 확인은 보내는 틈 사이에 눌렀다 떼도 빠지지 않는다', () => {
    const sent: Pad[] = [];
    const send = padSender(p => sent.push(p));
    send(right, 0); send({ ...right, a: true }, 10); send(right, 20); send(right, 40);
    expect(sent.map(p => p.a)).toEqual([false, true]);
    send(right, 80);
    expect(sent.map(p => p.a)).toEqual([false, true, false]);
  });

  it('방장은 손님의 마지막 조작을 그대로 이어 쓴다: 1초 동안 글이 오지 않아도 계속 걷고, 한참(3.5초) 소식이 없으면 놓은 것으로 본다', () => {
    const pads = new GuestPads();
    pads.set(4, right, 1000);
    for (const t of [1016, 1500, 1999, 2400, 1000 + PAD_STALE_MS - 1]) { expect(pads.get(4, t)).toEqual(right); pads.stepped(); }
    expect(pads.get(4, 1000 + PAD_STALE_MS)).toBe(NO_PAD);
    expect(pads.get(9, 1000)).toBe(NO_PAD);
    expect(PAD_STALE_MS).toBeGreaterThan(PAD_REPEAT_MS * 3);                               // 되풀이 글이 두 번 늦어도 끊기지 않는다
    pads.set(4, right, 5000);                                                              // 되풀이 글이 오면 다시 이어진다
    expect(pads.get(4, 5900)).toEqual(right);
    pads.set(4, { ...right, a: true }, 6000); pads.set(4, right, 6005);                    // 걸음 한 번 사이에 눌렀다 뗀 확인
    expect(pads.get(4, 6010).a).toBe(true);
    pads.stepped();
    expect(pads.get(4, 6020).a).toBe(false);
    pads.clear();
    expect(pads.get(4, 6030)).toBe(NO_PAD);
  });
});

// ---------- 연결(net)과 방의 규칙을 이어 붙여 본다 ----------
function wired(secret: string | null = SECRET) {
  const rooms = new Map<string, RoomCore<Fake>>(), ranks: RankReport[] = [], uses: UseReport[] = [], seen: string[] = [];
  class Fake {
    readyState = 0;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: ((e: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    saved: Saved | null = null;
    core: RoomCore<Fake> | null = null;
    constructor(url: string) {
      seen.push(url);
      const u = new URL(url), code = u.pathname.split('/').pop()!;
      queueMicrotask(() => {
        let core = rooms.get(code);
        if (!core) {
          const made: RoomCore<Fake> = new RoomCore<Fake>({
            send: (s, t) => queueMicrotask(() => { if (s.readyState === 1) s.onmessage?.({ data: t }); }),
            close: (s, c) => queueMicrotask(() => s.end(c)),
            save: (s, saved) => { s.saved = saved; },
            pass: (seat, key, pass, setup) => { void verifyPass(pass, secret, NOW).then(claims => made.grant(seat, key, claims, setup)); },
            rank: r => { ranks.push(r); queueMicrotask(() => made.ranked(r.run, r.ms, 2, true)); },
            use: u2 => uses.push(u2),
          });
          rooms.set(code, core = made);
        }
        this.core = core; this.readyState = 1;
        core.join(this, code, readJoinQuery(u.searchParams));
      });
    }
    send(text: string) { if (this.readyState === 1 && this.saved && text !== 'ping') this.core!.message(this.saved.seat, this.saved.key, text, Date.now()); }
    close() { this.end(1000); }
    end(code: number) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.saved) this.core?.leave(this.saved.seat, this.saved.key);
      queueMicrotask(() => this.onclose?.({ code }));
    }
  }
  return { Fake: Fake as unknown as typeof WebSocket, rooms, ranks, uses, seen };
}
const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));
const live = (exp = Math.floor(Date.now() / 1000) + 3600) => makePass({ iat: NOW - 60, exp: NOW + 3600 }) && makePass({ iat: exp - 7200, exp });

describe('연결(net): 교사 방', () => {
  it('출입증으로 교사 방을 만들고, 학생이 닉네임을 신청하고, 교사가 승인 · 반려한다', async () => {
    const net = wired(), pass = makePass();
    const news: [NickState, string][] = [], passes: boolean[] = [];
    const t = joinRoom('http://room.test', CODE, { create: true, socket: net.Fake, pass, title: '3학년 2반', rank: true }, { pass: ok => passes.push(ok) });
    await tick();
    expect([t.teacher, t.cls, passes]).toEqual([true, { title: '3학년 2반', rank: true, teachers: [0] }, [true]]);
    expect(net.seen.join(' ')).not.toContain(pass.slice(0, 20));                           // 출입증은 주소에 싣지 않는다(연결된 뒤 첫 글로 낸다)
    const a = joinRoom('http://room.test', CODE, { socket: net.Fake }, { nick: (st, v) => news.push([st, v]) });
    const b = joinRoom('http://room.test', CODE, { socket: net.Fake }, {});
    await tick();
    expect([a.cls?.title, a.teacher, a.asks]).toEqual(['3학년 2반', false, []]);
    expect(a.askName('  달팽이 ')).toBe(true);
    expect(a.askName('가나다라마바사아자차카')).toBe(false);                                  // 열 글자를 넘으면 보내지 않는다
    await tick();
    expect([a.myAsk, t.asks, b.asks, b.nickOf(1)]).toEqual(['달팽이', [[1, '달팽이']], [], '']);
    a.judge(1, true, '달팽이'); b.judge(1, true, '달팽이');                                    // 학생의 승인은 보내지도 않는다
    await tick();
    expect(b.nickOf(1)).toBe('');
    t.judge(1, false, '달팽이');
    await tick();
    expect([news, a.myAsk, t.asks]).toEqual([[['wait', '달팽이'], ['no', '']], '', []]);
    a.askName('고래'); await tick();
    t.judge(1, true, '고래'); await tick();
    expect([a.nickOf(1), b.nickOf(1), t.nickOf(1), a.myAsk]).toEqual(['고래', '고래', '고래', '']);
    expect(news[news.length - 1]).toEqual(['ok', '고래']);
    t.leave(); a.leave(); b.leave();
  });

  it('학생끼리 연 방에서는 닉네임 신청이 가지 않고, 변조되거나 기한이 지난 출입증으로 만든 방은 보통 방이다', async () => {
    const net = wired();
    const h = joinRoom('http://room.test', CODE, { create: true, socket: net.Fake }, {});
    const g = joinRoom('http://room.test', CODE, { socket: net.Fake }, {});
    await tick();
    expect([h.cls, g.cls, g.askName('달팽이')]).toEqual([null, null, true]);                 // 글 모양은 맞지만 보통 방이라 보내지 않는다
    await tick();
    expect(g.myAsk).toBe('');
    h.leave(); g.leave();
    const passes: boolean[] = [];
    const [v, body, sig] = makePass().split('.');
    const forged = joinRoom('http://room.test', 'GHJKMN', { create: true, socket: net.Fake, pass: `${v}.${b64(JSON.stringify({ u: OTHER, n: '가짜', a: 1, iat: NOW - 60, exp: NOW + 3600 }))}.${sig}`, title: '가짜 방', rank: true }, { pass: ok => passes.push(ok) });
    const old = joinRoom('http://room.test', 'PQRSTU', { create: true, socket: net.Fake, pass: makePass({ iat: NOW - 13 * 3600, exp: NOW - 3600 }), title: '지난 방' }, { pass: ok => passes.push(ok) });
    await tick();
    expect([passes, forged.cls, old.cls, forged.teacher, body.length > 0]).toEqual([[false, false], null, null, false, true]);
    forged.leave(); old.leave();
    const none = wired(null);                                                         // 비밀값이 없는 방 서버
    const t = joinRoom('http://room.test', CODE, { create: true, socket: none.Fake, pass: makePass(), title: '반' }, {});
    await tick();
    expect([t.teacher, t.cls]).toEqual([false, null]);
    t.leave();
  });

  it('방장이 깼다고 알리면 순위가 적히고 등수가 모두에게 온다. 쓰임도 한 번 알린다', async () => {
    const net = wired(), got: RankNews[] = [];
    const t = joinRoom('http://room.test', CODE, { create: true, socket: net.Fake, pass: makePass(), title: '3학년 2반', rank: true }, {});
    const a = joinRoom('http://room.test', CODE, { socket: net.Fake }, { rank: n => got.push(n) });
    await tick();
    t.setRoom({ ...INFO, order: [0, 1] });
    await tick();
    (net.rooms.get(CODE) as unknown as { runAt: number }).runAt = Date.now() - 15_300;      // 15초쯤 전에 판이 열렸다고 치고
    a.sendWon(15_000);                                                                     // 손님은 보내지도 않는다
    t.sendWon(15_000.4);
    await tick();
    expect(net.ranks).toMatchObject([{ run: 3, pack: 'math/graph-factory', stage: 1, players: 2, title: '3학년 2반', teacher: TEACHER }]);
    expect(Math.abs(net.ranks[0].ms - 15_300)).toBeLessThan(200);                           // 적히는 시간은 방 서버가 잰 값
    expect(got).toEqual([{ run: 3, ms: net.ranks[0].ms, rank: 2, best: true }]);
    expect(net.uses).toEqual([{ pack: 'math/graph-factory', teacher: TEACHER }]);
    t.leave(); a.leave();
  });

  it('교사가 나갔다 출입증으로 다시 들어오면 쌓인 신청이 보인다', async () => {
    const net = wired(), pass = makePass();
    const t = joinRoom('http://room.test', CODE, { create: true, socket: net.Fake, pass, title: '반' }, {});
    const a = joinRoom('http://room.test', CODE, { socket: net.Fake }, {});
    await tick();
    t.leave(); await tick();
    expect([a.isHost, a.cls]).toEqual([true, { title: '반', rank: false, teachers: [] }]);
    a.askName('달팽이'); await tick();
    const back = joinRoom('http://room.test', CODE, { socket: net.Fake, pass }, {});
    await tick();
    expect([back.teacher, back.isHost, back.asks]).toEqual([true, false, [[1, '달팽이']]]);   // 출입증만으로는 방장이 넘어가지 않는다
    back.claimHost(); await tick();
    expect([back.isHost, a.isHost]).toEqual([true, false]);                                 // 교사 화면이 청하면 방장을 돌려받는다
    back.judge(1, true, '달팽이'); await tick();
    expect(a.nickOf(1)).toBe('달팽이');
    a.leave(); back.leave();
    expect(live().startsWith('v1.')).toBe(true);
  });

  it('방장이 바뀐 직후에도 조작이 끊기지 않는다: 손님이 누르고 있던 조작을 새 방장에게 바로 다시 보낸다', async () => {
    const net = wired();
    const got: Record<string, [number, Pad][]> = { a: [], b: [] };
    const a = joinRoom('http://room.test', CODE, { create: true, socket: net.Fake }, { pad: (s, p) => got.a.push([s, p]) });
    let b: RoomLink, c: RoomLink;
    await tick();
    b = joinRoom('http://room.test', CODE, { socket: net.Fake }, { pad: (s, p) => got.b.push([s, p]) });
    c = joinRoom('http://room.test', CODE, { socket: net.Fake }, { who: l => { if (l.host !== seenHost) { seenHost = l.host; send.again(); } } });
    await tick();
    let seenHost = c.host, now = 0;
    const send = padSender(p => c.sendPad(p));
    const hold = async (ms: number) => { for (const end = now + ms; now < end; now += 16) send({ m: 1, j: false, a: false, jn: 0 }, now); await tick(); };
    await hold(300);
    expect(got.a).toEqual([[2, { m: 1, j: false, a: false, jn: 0 }]]);                      // 누르고 있는 동안은 한 번만 간다
    a.yieldHost(); await tick();                                                           // 방장이 화면을 내려 둬 다음 사람에게 넘어갔다
    expect([b.isHost, c.host]).toEqual([true, 1]);
    await hold(100);                                                                       // 1초를 기다리지 않고 바로 다시 간다
    expect(got.b).toEqual([[2, { m: 1, j: false, a: false, jn: 0 }]]);
    const pads = new GuestPads(); pads.set(...got.b[0], 5000);
    expect(pads.get(2, 5900).m).toBe(1);                                                   // 새 방장은 그 조작을 다음 글이 올 때까지 이어 쓴다
    a.leave(); b.leave(); c.leave();
  });
});

describe('순위 읽기(팩 화면)', () => {
  it('스테이지마다 빠른 순 10개로 다듬고, 모양이 어긋난 줄은 버린다', () => {
    const row = (ms: number, o: Record<string, unknown> = {}) => ({ title: '3학년 2반', ms, players: 28, teacher: '창욱쌤', at: '2026-11-22', ...o });
    const ranks = readRanks({ stages: {
      0: [row(90_000), row(83_450, { title: '<b>굵게</b>' }), row(5), row(60_000, { players: 0 }), row(70_000, { title: '' }), row(70_000, { title: '가'.repeat(21) }), row(75_000, { at: 'x', teacher: 7 }), null, 'x'],
      1: Array.from({ length: 20 }, (_, i) => row(100_000 - i * 1000)),
      5: [row(9000)],
    } }, 3)!;
    expect(ranks.length).toBe(3);
    expect(ranks[0].map(r => [r.title, r.ms])).toEqual([['3학년 2반', 75_000], ['<b>굵게</b>', 83_450], ['3학년 2반', 90_000]]);
    expect(ranks[0][0]).toMatchObject({ teacher: '', at: '' });
    expect(ranks[1].length).toBe(10);
    expect(ranks[1][0].ms).toBe(81_000);
    expect(ranks[2]).toEqual([]);
    for (const bad of [null, 'x', {}, { stages: null }, { stages: 'x' }]) expect(readRanks(bad, 2)).toBeNull();
    expect(readRanks({ stages: {} }, 2)).toEqual([[], []]);
  });

  it('시간은 mm:ss 로 적는다', () => {
    expect([mmss(83_450), mmss(3000), mmss(59_600), mmss(3 * 3600_000), mmss(-5)]).toEqual(['01:23', '00:03', '01:00', '180:00', '00:00']);
  });
});

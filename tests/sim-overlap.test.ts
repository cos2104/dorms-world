/**
 * 판의 겹침 두 가지(2026-11-19 선생님 흐름 시험 기록 2-6절). 고치기 전에 실패하는 것을 먼저 확인했다.
 * (가) 상자 위에 선 친구가 상자 끝에 걸쳐 있으면 뒤에서 미는 사람이 상자에 붙지 못해 미는 사람으로 안 셌다.
 * (나) 도름이 발이 바닥이나 친구 머리에서 1px 안쪽으로 떠 있어(정수 칸으로만 내려앉았다), 머리 위 친구가 옆 칸으로
 *      걸쳐 있으면 그 밑으로 다가오는 도름이가 '겹친다'고 판정돼 막혔다.
 */
import { describe, expect, it } from 'vitest';
import { parseStage, T } from '../platform/stage';
import { createWorld, step, PH, PW, type Pad, type World } from '../platform/sim';

const run = (w: World, pads: (Pad | undefined)[], seconds: number) => { for (let i = 0; i < seconds * 60; i++) step(w, pads, 1 / 60); };
const stay: Pad = { m: 0, j: false };
const GROUND = 10 * T;

// 바닥 위에 가로 두 칸, 세로 한 칸 상자
/** 가로 40칸, 세로 13칸 평지. row9 는 바닥 바로 위 줄(글자로 덮어 쓴다). */
const flat = (row9: string) => Array.from({ length: 13 }, (_, r) => (r >= 10 ? '#'.repeat(40) : r === 9 ? row9.padEnd(40, '.') : '.'.repeat(40))).join('\n');
const FLAT_CRATE = flat('.@' + '.'.repeat(16) + 'cc' + '.'.repeat(14) + 'K.D.');

describe('(가) 상자 위 친구가 걸쳐 있어도 뒤에서 미는 사람을 센다', () => {
  it.each([1, 2, 5])('상자 위 친구가 왼쪽 끝으로 %ipx 걸쳐 있어도 상자가 밀린다', over => {
    const w = createWorld(parseStage(FLAT_CRATE, { legend: { c: { type: 'crate', need: 1 } } }), [{ color: '#fff' }, { color: '#fff' }]);
    const b = w.crates[0];
    const [rider, pusher] = w.players;
    rider.x = b.x - over; rider.y = b.y - PH;
    pusher.x = b.x - 120; pusher.y = GROUND - PH;
    run(w, [stay, stay], 0.3);
    expect(rider.on && rider.y + rider.h <= b.y + 0.5, '상자 위에 올라서 있다').toBe(true);
    const x0 = b.x;
    run(w, [stay, { m: 1, j: false }], 3);
    expect(b.x - x0, '미는 사람이 상자를 밀어 간다').toBeGreaterThan(60);
  });

  it('줄 서서 밀 때도 상자 위 친구 때문에 줄이 끊기지 않는다(필요 3명, 미는 사람 3명)', () => {
    const w = createWorld(parseStage(FLAT_CRATE, { legend: { c: { type: 'crate', need: 3 } } }), Array.from({ length: 4 }, () => ({ color: '#fff' })));
    const b = w.crates[0];
    w.crates[0].need = 3;
    const [rider, ...push] = w.players;
    rider.x = b.x - 3; rider.y = b.y - PH;
    push.forEach((p, k) => { p.x = b.x - 60 - k * 30; p.y = GROUND - PH; });
    const x0 = b.x;
    run(w, [stay, { m: 1, j: false }, { m: 1, j: false }, { m: 1, j: false }], 3);
    expect(b.x - x0).toBeGreaterThan(60);
  });
});

describe('(나) 발이 바닥과 머리에 정확히 닿고, 머리 위 친구가 밑으로 다가오는 사람을 막지 않는다', () => {
  const FLAT = flat('.@' + '.'.repeat(30) + 'K.D.');

  it('뛰었다 내려서면 발이 바닥에 딱 닿는다(떠 있는 틈이 없다)', () => {
    const w = createWorld(parseStage(FLAT), [{ color: '#fff' }]);
    const p = w.players[0];
    run(w, [stay], 0.5);
    for (let k = 0; k < 4; k++) {
      run(w, [{ m: 1, j: true }], 0.05); run(w, [{ m: 1, j: false }], 0.9);
      expect(p.on).toBe(true);
      expect(p.y + p.h).toBe(GROUND);
    }
  });

  it('친구 머리 위에 내려서면 발이 머리에 딱 닿는다', () => {
    const w = createWorld(parseStage(FLAT), [{ color: '#fff' }, { color: '#fff' }]);
    const [S, U] = w.players;
    S.x = 300; S.y = GROUND - PH - 0.6; U.x = 300; U.y = GROUND - 2 * PH - 25.3;
    run(w, [stay, stay], 1);
    expect(S.y + S.h).toBe(GROUND);
    expect(U.y + U.h).toBe(S.y);
  });

  it('머리 위 친구가 옆 칸으로 걸쳐 있어도 그 밑으로 다가가 아래 친구에게 붙는다', () => {
    const w = createWorld(parseStage(FLAT), [{ color: '#fff' }, { color: '#fff' }, { color: '#fff' }]);
    const [S, U, W] = w.players;
    // 고치기 전의 판에서 실제로 생기던 자리: 아래 친구는 0.05px, 다가오는 사람은 0.9px 떠 있고, 머리 위 친구는 아래 친구 머리에 붙어 있다
    S.x = 300; S.y = GROUND - PH - 0.05;
    U.x = 315; U.y = S.y - PH;
    W.x = 400; W.y = GROUND - PH - 0.9;
    run(w, [stay, stay, { m: -1, j: false }], 1.5);
    expect(W.x - (S.x + PW), '머리 위 친구에 막히지 않고 아래 친구 옆까지 온다').toBeLessThan(2);
  });

  it('여럿이 쌓여 있다가 내려와도 모두 바닥에 딱 닿는다', () => {
    const w = createWorld(parseStage(FLAT), Array.from({ length: 30 }, () => ({ color: '#fff' })));
    run(w, [], 1);
    run(w, w.players.map((_, i) => ({ m: (i % 2 ? 1 : -1) as -1 | 1, j: i % 3 === 0 })), 1.5);
    run(w, [], 2);
    for (const p of w.players) if (p.on) {
      const feet = p.y + p.h;
      const under = w.players.find(q => q !== p && Math.abs(q.y - feet) < 1.5 && q.x < p.x + p.w && q.x + q.w > p.x);
      expect(under ? feet === under.y || feet === GROUND : feet === GROUND, `도름이 ${p.i + 1} 발 ${feet}`).toBe(true);
    }
  });
});

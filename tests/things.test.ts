import { describe, expect, it } from 'vitest';
import { parseStage, T } from '../platform/stage';
import { createWorld, step, PH, type Pad, type World } from '../platform/sim';
import { parseSprite } from '../platform/sprite';
import { itemRect, parseKinds } from '../platform/things';
import { BEHAVIORS } from '../platform/behavior';
import { applyWire, readWire, toWire } from '../platform/sync';
import { thingActionAt } from '../platform/thing-sim';

// 7×7 점 그림(가장자리는 남색 윤곽). 한 점 2px 이라 14px.
const BOX = ['nnnnnnn', 'nyyyyyn', 'nyyyyyn', 'nyyyyyn', 'nyyyyyn', 'nyyyyyn', 'nnnnnnn'].join('\n');
// 15×5 점(30×10px): 발판·용수철
const SLAB = ['nnnnnnnnnnnnnnn', 'ngggggggggggggn', 'ngggggggggggggn', 'ngggggggggggggn', 'nnnnnnnnnnnnnnn'].join('\n');
const sprites = { seed: parseSprite(BOX, 'seed'), star: parseSprite(BOX, 'star'), slab: parseSprite(SLAB, 'slab'), lava: parseSprite(SLAB, 'lava') };

const row = (s: string) => s.padEnd(30, '.');
const map = (lines: string[]) => [...Array(12 - lines.length).fill(row('')), ...lines.map(row)].join('\n');

const run = (w: World, pads: Pad[], seconds: number) => { for (let i = 0; i < seconds * 60; i++) step(w, pads, 1 / 60); };
const stay: Pad = { m: 0, j: false }, tap: Pad = { m: 0, j: false, a: true };
/** 한 사람을 x 자리까지 걸어가게 한다(다른 사람은 가만히). */
function walkTo(w: World, i: number, x: number) {
  for (let k = 0; k < 600 && Math.abs(w.players[i].x - x) > 3; k++) {
    const pads = w.players.map(() => stay);
    pads[i] = { m: w.players[i].x < x ? 1 : -1, j: false };
    step(w, pads, 1 / 60);
  }
}
const press = (w: World, i: number) => { const pads = w.players.map(() => stay); pads[i] = tap; step(w, pads, 1 / 60); step(w, w.players.map(() => stay), 1 / 60); };

describe('things.json 읽기', () => {
  it('물건 종류를 읽고 기본값을 채운다', () => {
    const k = parseKinds({ seed: { name: '씨앗', sprite: 'seed', body: 'carry' } }, sprites);
    expect(k.seed).toMatchObject({ name: '씨앗', body: 'carry', touch: 'none', cell: 2, w: 14, h: 14 });
  });
  it('모르는 칸·없는 그림·맞지 않는 조합은 쉬운 말로 막는다', () => {
    expect(() => parseKinds({ a: { name: '가', sprite: 'seed', colour: 1 } }, sprites)).toThrow(/모르는 칸/);
    expect(() => parseKinds({ a: { name: '가', sprite: 'nope' } }, sprites)).toThrow(/sprites 폴더에 없어요/);
    expect(() => parseKinds({ a: { name: '가', sprite: 'seed', body: 'carry', touch: 'hurt' } }, sprites)).toThrow(/touch/);
    expect(() => parseKinds({ a: { name: '가', sprite: 'seed', body: 'solid', touch: 'collect' } }, sprites)).toThrow(/pass/);
    expect(() => parseKinds({ a: { name: '가', sprite: 'seed', body: 'carry', move: { dx: 3 } } }, sprites)).toThrow(/움직이지 않아요/);
    expect(() => parseKinds({ a: { name: '', sprite: 'seed' } }, sprites)).toThrow(/name/);
    expect(() => parseKinds({ constructor: { name: '가', sprite: 'constructor' } }, sprites)).toThrow(/sprites 폴더에 없어요/);
  });
  it('놓는 곳은 받는 물건이 지도에 있어야 하고, 여는 글자는 다리여야 한다', () => {
    const kinds = parseKinds({ seed: { name: '씨앗', sprite: 'seed', body: 'carry' } }, sprites);
    const m = map(['', '', '', '', '', '', '', '', '', '.@....s...gg......K....D', '##############xxx###########', '##############...###########']);
    const legend = { s: { type: 'thing' as const, thing: 'seed' }, g: { type: 'goal' as const, accepts: ['seed'], opens: ['x'] }, x: { type: 'bridge' as const } };
    const st = parseStage(m, { legend }, sprites, kinds);
    expect(st.things.goals[0].need).toBe(1);
    expect(() => parseStage(m.replace('s', '.'), { legend: { ...legend, s: undefined } as never }, sprites, kinds)).toThrow();
    expect(() => parseStage(m, { legend: { ...legend, g: { type: 'goal', accepts: ['seed'], opens: ['q'] } } }, sprites, kinds)).toThrow(/bridge/);
  });
});

describe('들고 나르기와 놓는 곳', () => {
  const kinds = parseKinds({ seed: { name: '씨앗', sprite: 'seed', body: 'carry' }, rock: { name: '돌', sprite: 'seed', body: 'carry' } }, sprites);
  const m = map(['', '', '', '', '', '', '', '', '', '.@...s..r.....gg....K...D..', '###################xxx######', '###################...######']);
  const legend = { s: { type: 'thing' as const, thing: 'seed' }, r: { type: 'thing' as const, thing: 'rock' }, g: { type: 'goal' as const, accepts: ['seed'], opens: ['x'], label: '화분' }, x: { type: 'bridge' as const } };
  const stage = () => parseStage(m, { legend }, sprites, kinds);

  it('들어서 놓는 곳에 넣으면 다리가 켜지고, 다른 물건은 받지 않는다', () => {
    const w = createWorld(stage(), [{ color: '#fff' }]);
    walkTo(w, 0, 5 * T);
    expect(thingActionAt(w, w.players[0])).toMatchObject({ do: 'pick' });
    press(w, 0);
    expect(w.h.items[0].at).toBe(2);
    walkTo(w, 0, 14 * T + 4);
    expect(thingActionAt(w, w.players[0])).toMatchObject({ do: 'put' });
    press(w, 0);
    run(w, [stay], 0.1);
    expect(w.h.counts[0]).toBe(1);
    expect(w.active.has('x')).toBe(true);
  });
  it('받지 않는 물건은 놓는 곳에서 놓을 수 없다고 알린다', () => {
    const w = createWorld(stage(), [{ color: '#fff' }]);
    walkTo(w, 0, 8 * T);
    press(w, 0);
    expect(w.h.items[1].at).toBe(2);
    walkTo(w, 0, 14 * T + 4);
    expect(thingActionAt(w, w.players[0])).toEqual({ do: 'no', why: '여기에는 놓을 수 없어요' });
  });
  it('놓는 곳 밖에서는 내려놓고, 내려놓은 물건은 땅까지 떨어진다', () => {
    const w = createWorld(stage(), [{ color: '#fff' }]);
    walkTo(w, 0, 5 * T); press(w, 0);
    walkTo(w, 0, 10 * T); press(w, 0);
    run(w, [stay], 0.5);
    const it = w.h.items[0];
    expect(it.at).toBe(0);
    expect(it.y + 14).toBeCloseTo(10 * T, 0);   // 땅 윗면에 선다
  });
  it('든 채로 떨어지면 물건은 처음 자리로 돌아간다', () => {
    const w = createWorld(stage(), [{ color: '#fff' }]);
    walkTo(w, 0, 5 * T); press(w, 0);
    w.players[0].y = 20 * T; run(w, [stay], 0.1);
    expect(w.h.items[0]).toMatchObject({ at: 0, x: 5 * T });
  });
  it('요약으로 손님 세계에 그대로 옮겨진다(든 사람 포함)', () => {
    const host = createWorld(stage(), [{ color: '#F4F7FF' }, { color: '#FFB3C7' }]);
    host.players[1].x = 22 * T;   // 둘째는 길을 비켜 선다
    walkTo(host, 0, 5 * T); press(host, 0);
    expect(host.h.items[0].at).toBe(2);
    const wire = readWire(JSON.parse(JSON.stringify(toWire(host, [0, 1], 1, 1))));
    expect(wire).not.toBeNull();
    const guest = createWorld(stage(), [{ color: '#F4F7FF' }, { color: '#FFB3C7' }]);
    expect(applyWire(guest, wire!)).toBe(true);
    expect(guest.h.items[0]).toMatchObject({ at: 2, holder: 0 });
  });
});

describe('닿으면 일어나는 일', () => {
  it('모으는 물건은 닿으면 사라지고 놓는 곳의 수가 오른다', () => {
    const kinds = parseKinds({ star: { name: '별', sprite: 'star', touch: 'collect' } }, sprites);
    const m = map(['', '', '', '', '', '', '', '', '', '.@...s.s.....gg....K...D..', '###################xxx######', '###################...######']);
    const st = parseStage(m, { legend: { s: { type: 'thing', thing: 'star' }, g: { type: 'goal', accepts: ['star'], opens: ['x'] }, x: { type: 'bridge' } } }, sprites, kinds);
    const w = createWorld(st, [{ color: '#fff' }]);
    walkTo(w, 0, 9 * T);
    expect(w.h.counts[0]).toBe(2);
    run(w, [stay], 0.05);
    expect(w.active.has('x')).toBe(true);
  });
  it('닿으면 처음 자리로 가는 물건', () => {
    const kinds = parseKinds({ lava: { name: '용암', sprite: 'lava', touch: 'hurt' } }, sprites);
    const m = map(['', '', '', '', '', '', '', '', '', '.@.......l....K....D......', '##########################', '##########################']);
    const w = createWorld(parseStage(m, { legend: { l: { type: 'thing', thing: 'lava' } } }, sprites, kinds), [{ color: '#fff' }]);
    const start = w.players[0].x;
    for (let k = 0; k < 120; k++) step(w, [{ m: 1, j: false }], 1 / 60);
    expect(w.players[0].x).toBeLessThan(9 * T);
    expect(Math.abs(w.players[0].x - start)).toBeLessThan(9 * T - start);
  });
  it('용수철은 딛으면 높이 튕겨 올린다', () => {
    const kinds = parseKinds({ spring: { name: '용수철', sprite: 'slab', body: 'solid', touch: 'bounce', power: 8 } }, sprites);
    const m = map(['', '', '', '', '', '', '', '', '', '.@.....s......K....D......', '##########################', '##########################']);
    const w = createWorld(parseStage(m, { legend: { s: { type: 'thing', thing: 'spring' } } }, sprites, kinds), [{ color: '#fff' }]);
    w.players[0].x = 7 * T + 4; w.players[0].y = 6 * T; w.players[0].vy = 0;
    let top = Infinity;
    for (let k = 0; k < 120; k++) { step(w, [stay], 1 / 60); top = Math.min(top, w.players[0].y); }
    expect(10 * T - 10 - PH - top).toBeGreaterThan(6 * T);   // 맨손으로 뛰는 높이(약 3.6칸)보다 훨씬 높이
  });
});

describe('발판과 움직이는 물건', () => {
  it('발판은 위에서 딛고, 아래에서는 뚫고 올라간다', () => {
    const kinds = parseKinds({ cloud: { name: '구름', sprite: 'slab', body: 'ledge' } }, sprites);
    const m = map(['', '', '', '', '', '', '', '.......c..................', '', '.@............K....D......', '##########################', '##########################']);
    const w = createWorld(parseStage(m, { legend: { c: { type: 'thing', thing: 'cloud' } } }, sprites, kinds), [{ color: '#fff' }]);
    const ledgeTop = 8 * T - 10;
    w.players[0].x = 7 * T + 4; w.players[0].y = 10 * T - PH; w.players[0].on = true;
    step(w, [{ m: 0, j: true }], 1 / 60);
    let rose = false;
    for (let k = 0; k < 90; k++) { step(w, [{ m: 0, j: true }], 1 / 60); if (w.players[0].y + PH < ledgeTop) rose = true; }
    expect(rose).toBe(true);                       // 아래에서 뚫고 올라갔다
    run(w, [stay], 1);
    expect(w.players[0].y + PH).toBeCloseTo(ledgeTop, 0);   // 내려와서는 발판 위에 선다
  });
  it('왔다 갔다 하는 발판은 위에 선 사람을 함께 나른다', () => {
    const kinds = parseKinds({ lift: { name: '배', sprite: 'slab', body: 'solid', move: { dx: 6, speed: 2 } } }, sprites);
    const m = map(['', '', '', '', '', '', '', '', '.....b....................', '.@............K....D......', '##########################', '##########################']);
    const w = createWorld(parseStage(m, { legend: { b: { type: 'thing', thing: 'lift' } } }, sprites, kinds), [{ color: '#fff' }]);
    w.players[0].x = 5 * T + 4; w.players[0].y = 9 * T - 10 - PH; w.players[0].vy = 0;
    run(w, [stay], 0.2);
    const x0 = w.players[0].x;
    run(w, [stay], 1);
    expect(w.players[0].x - x0).toBeGreaterThan(40);
  });
  it('밀리는 물건은 그림을 입힌 상자가 된다', () => {
    const kinds = parseKinds({ rock: { name: '바위', sprite: 'slab', body: 'push', need: 1, label: '바위' } }, sprites);
    const m = map(['', '', '', '', '', '', '', '', '', '.@.....r......K....D......', '##########################', '##########################']);
    const st = parseStage(m, { legend: { r: { type: 'thing', thing: 'rock' } } }, sprites, kinds);
    expect(st.crates).toHaveLength(1);
    expect(st.crates[0]).toMatchObject({ w: T, h: T, need: 1 });
    expect(st.crates[0].skin?.name).toBe('바위');
  });
  it('다리가 켜진 동안만 나타나는 물건', () => {
    const kinds = parseKinds({ wall: { name: '벽', sprite: 'slab', body: 'solid', without: 'x' } }, sprites);
    const m = map(['', '', '', '', '', '', '', '', '', '.@..a...w.....K....D......', '#############xxx##########', '#############...##########']);
    const w = createWorld(parseStage(m, { legend: { w: { type: 'thing', thing: 'wall' }, a: { type: 'button', opens: ['x'] }, x: { type: 'bridge' } } }, sprites, kinds), [{ color: '#fff' }]);
    walkTo(w, 0, 4 * T + 4);
    run(w, [stay], 0.1);
    expect(w.active.has('x')).toBe(true);
  });
});

describe('선생님이 더하는 새 움직임(platform/behaviors)', () => {
  const two = parseSprite(SLAB, 'off'), on = parseSprite(SLAB.replace(/g/g, 'y'), 'on');
  const sp = { ...sprites, off: two, on };
  const m = map(['', '', '', '', '', '', '', '', '', '.@...s........K....D......', '#############xxx##########', '#############...##########']);
  const legend = { s: { type: 'thing' as const, thing: 'lamp' }, x: { type: 'bridge' as const } };

  it('스위치: 확인으로 켜면 다리가 켜지고, 요약으로 손님에게 그대로 간다', () => {
    const kinds = parseKinds({ lamp: { name: '등', frames: ['off', 'on'], behavior: 'toggle', opens: ['x'] } }, sp);
    const st = parseStage(m, { legend }, sp, kinds);
    const w = createWorld(st, [{ color: '#fff' }]);
    walkTo(w, 0, 5 * T);
    expect(thingActionAt(w, w.players[0])).toMatchObject({ do: 'use', text: '확인: 켜기' });
    press(w, 0); run(w, [stay], 0.05);
    expect(w.h.items[0].v[0]).toBe(1);
    expect(w.active.has('x')).toBe(true);
    const guest = createWorld(st, [{ color: '#F4F7FF' }]);
    expect(applyWire(guest, readWire(JSON.parse(JSON.stringify(toWire(w, [0], 1, 1))))!)).toBe(true);
    expect(guest.h.items[0].v[0]).toBe(1);
    press(w, 0); run(w, [stay], 0.05);
    expect(w.active.has('x')).toBe(false);
  });
  it('시간 단추: 밟으면 켜지고 비켜도 4초 동안 켜져 있다', () => {
    const kinds = parseKinds({ lamp: { name: '시계 단추', frames: ['off', 'on'], behavior: 'timer', opens: ['x'] } }, sp);
    const w = createWorld(parseStage(m, { legend }, sp, kinds), [{ color: '#fff' }]);
    walkTo(w, 0, 5 * T + 4);
    run(w, [stay], 0.1);
    expect(w.active.has('x')).toBe(true);
    walkTo(w, 0, 9 * T);
    run(w, [stay], 3);
    expect(w.active.has('x')).toBe(true);
    run(w, [stay], 1.5);
    expect(w.active.has('x')).toBe(false);
  });
  it('없는 움직임 이름·맞지 않는 조합은 쉬운 말로 막는다', () => {
    expect(() => parseKinds({ a: { name: '가', sprite: 'slab', behavior: 'nope' } }, sp)).toThrow(/판에 없는 움직임/);
    expect(() => parseKinds({ a: { name: '가', sprite: 'slab', opens: ['x'] } }, sp)).toThrow(/behavior/);
    expect(() => parseKinds({ a: { name: '가', sprite: 'slab', behavior: 'toggle', body: 'carry' } }, sp)).toThrow(/behavior/);
  });
  it('움직임이 오류를 내거나 엉뚱한 수를 남겨도 판은 멈추지 않는다', () => {
    BEHAVIORS['test-boom'] = { about: '시험용', tick: ctx => { ctx.vars[0] = NaN; ctx.vars[1] = 1e99; ctx.vars.push(5); throw new Error('boom'); } };
    try {
      const kinds = parseKinds({ lamp: { name: '등', sprite: 'slab', behavior: 'test-boom', opens: ['x'] } }, sp);
      const w = createWorld(parseStage(m, { legend }, sp, kinds), [{ color: '#fff' }]);
      expect(() => run(w, [stay], 0.2)).not.toThrow();
      expect(w.h.items[0].v).toEqual([0, 1e6, 0, 0]);
      expect(readWire(JSON.parse(JSON.stringify(toWire(w, [0], 1, 1))))).not.toBeNull();
    } finally { delete BEHAVIORS['test-boom']; }
  });
});

describe('검증에서 찾은 경우들', () => {
  const sp = { ...sprites, wide: parseSprite(['nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn', 'ngggggggggggggggggggggggggggggggggggggggggggn', 'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn'].join('\n'), 'wide') };
  it('위로 가는 발판에 얹은 물건은 함께 올라간다(뚫고 떨어지지 않는다)', () => {
    const kinds = parseKinds({ lift: { name: '승강기', sprite: 'wide', body: 'ledge', move: { dy: -3, speed: 1 } }, seed: { name: '씨앗', sprite: 'seed', body: 'carry' } }, sp);
    const m = map(['', '', '', '', '', '', '', '', '.....l....................', '.@............K....D......', '##########################', '##########################']);
    // 씨앗 하나를 발판 위에 얹은 세계(지도 글자로는 발판 위 칸에 못 놓으니 직접 둔다)
    const st = parseStage(m, { legend: { l: { type: 'thing', thing: 'lift' } } }, sp, kinds);
    st.things.kinds.push(kinds.seed); st.things.items.push({ kind: st.things.kinds.length - 1, x: 5 * T + 20, y: 9 * T - 6 - 14 });
    const w = createWorld(st, [{ color: '#fff' }]);
    w.players[0].x = 1 * T;
    run(w, [stay], 1.5);
    const liftTop = itemRect(st.things, w.h, 0, w.t).y;
    expect(liftTop).toBeLessThan(9 * T - 6 - 30);                  // 발판이 올라갔고
    expect(Math.abs(w.h.items[1].y + 14 - liftTop)).toBeLessThan(1); // 씨앗은 그 위에 그대로 얹혀 있다
  });
  it('움직이는 발판 위 친구의 머리 위에 선 친구도 함께 실려 간다', () => {
    const kinds = parseKinds({ cloud: { name: '구름', sprite: 'wide', body: 'ledge', move: { dx: 6, speed: 2 } } }, sp);
    const m = map(['', '', '', '', '', '', '', '', '.....c....................', '.@............K....D......', '##########################', '##########################']);
    const w = createWorld(parseStage(m, { legend: { c: { type: 'thing', thing: 'cloud' } } }, sp, kinds), [{ color: '#fff' }, { color: '#fff' }]);
    const top = 9 * T - 6;
    w.players[0].x = 5 * T + 10; w.players[0].y = top - PH; w.players[0].vy = 0;
    w.players[1].x = 5 * T + 10; w.players[1].y = top - 2 * PH; w.players[1].vy = 0;
    run(w, [stay, stay], 0.3);
    const x0 = w.players[0].x, x1 = w.players[1].x;
    run(w, [stay, stay], 1);
    expect(w.players[0].x - x0).toBeGreaterThan(40);
    expect(Math.abs((w.players[1].x - x1) - (w.players[0].x - x0))).toBeLessThan(2);
    expect(w.players[1].y + PH).toBeCloseTo(w.players[0].y, 0);   // 여전히 머리 위
  });
  it('벽에 붙어 내려놓으면 벽 속이 아니라 빈 자리에 놓는다', () => {
    const kinds = parseKinds({ box: { name: '통', sprite: 'wide', size: 1, body: 'carry' } }, sp);
    const m = map(['', '', '', '', '', '', '', '', '', '#@...s........K....D......', '##########################', '##########################']);
    const w = createWorld(parseStage(m, { legend: { s: { type: 'thing', thing: 'box' } } }, sp, kinds), [{ color: '#fff' }]);
    walkTo(w, 0, 5 * T); press(w, 0);
    walkTo(w, 0, 1 * T); press(w, 0);
    const it = w.h.items[0];
    expect(it.at).toBe(0);
    expect(it.x).toBeGreaterThanOrEqual(T);   // 왼쪽 벽 칸(0번 칸) 안으로 들어가지 않는다
  });
  it('움직임은 도름이 사본을 받는다(자리를 바꿔도 판에는 안 들어간다), use 가 false 면 누름이 남는다', () => {
    BEHAVIORS['test-push'] = { about: '시험용', tick: (_ctx, _dt, ps) => { for (const p of ps) (p as { x: number }).x = 0; }, use: () => false };
    try {
      const kinds = parseKinds({ pad: { name: '판', sprite: 'slab', behavior: 'test-push' } }, sp);
      const m = map(['', '', '', '', '', '', '', '', '', '.@...s........K....D......', '##########################', '##########################']);
      const w = createWorld(parseStage(m, { legend: { s: { type: 'thing', thing: 'pad' } } }, sp, kinds), [{ color: '#fff' }]);
      walkTo(w, 0, 5 * T);
      expect(w.players[0].x).toBeGreaterThan(4 * T);
      w.players[0].aHeld = false;
      step(w, [tap], 1 / 60);
      expect(w.players[0].aNew).toBe(true);
    } finally { delete BEHAVIORS['test-push']; }
  });
  it('그래프 조각을 든 동안은 새 물건을 집지 않는다(두 개를 함께 들지 않게)', () => {
    const kinds = parseKinds({ seed: { name: '씨앗', sprite: 'seed', body: 'carry' } }, sp);
    const m = map(['', '', '', '', '', '', '', '', '', '.@...s........K....D......', '##########################', '##########################']);
    const w = createWorld(parseStage(m, { legend: { s: { type: 'thing', thing: 'seed' } } }, sp, kinds), [{ color: '#fff' }]);
    walkTo(w, 0, 5 * T);
    expect(thingActionAt(w, w.players[0])).toMatchObject({ do: 'pick' });
    w.g.pieces.push({ state: 'held', holders: [0] } as never);
    expect(thingActionAt(w, w.players[0])).toBeNull();
  });
});

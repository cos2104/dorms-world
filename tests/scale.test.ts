/**
 * 저울: 상자(x)와 구슬(1)을 올린 두 접시. 한쪽만 손대면 기울고, 양쪽에 같은 일을 하면 수평으로 돌아오며 풀이 한 줄이 적힌다.
 */
import { describe, expect, it } from 'vitest';
import { parseStage, type StageJson } from '../platform/stage';
import { actionAt, createWorld, step, PH, type Pad, type World } from '../platform/sim';
import { checkSpec, commonDivisor, eul, euro, makeEquation, rng, sideText, stepOf, stepText } from '../platform/equation';

const row = (cells: Record<number, string>, fill = '.') => { const a = Array(40).fill(fill); for (const [c, t] of Object.entries(cells)) [...t].forEach((ch, k) => { a[+c + k] = ch; }); return a.join(''); };
const MAP = [
  ...Array(8).fill(row({})),
  row({ 6: 'llllll', 17: 'rrrrrr' }),
  row({}), row({}),
  row({ 1: '@', 3: 'u', 13: 'v', 15: 'w', 25: 'u', 33: 'K', 36: 'D' }),
  row({ 28: 'xxx' }, '#'),
  row({ 28: '...' }, '#'),
].join('\n');
const json = (scale: object = {}, legend: object = {}): StageJson => ({
  legend: {
    l: { type: 'pan', scale: 's', side: 'left' }, r: { type: 'pan', scale: 's', side: 'right' },
    u: { type: 'bin', scale: 's' }, v: { type: 'lever', scale: 's', does: 'addsub' }, w: { type: 'lever', scale: 's', does: 'divide' },
    x: { type: 'bridge' }, ...legend,
  } as StageJson['legend'],
  scales: { s: { x: 4, left: { boxes: 2, marbles: 3 }, right: { boxes: 0 }, opens: ['x'], ...scale } },
});

// 2x + 3 = 11 (x = 4). 사람 0 은 왼쪽 접시, 사람 1 은 오른쪽 접시를 맡는다.
const make = (scale: object = {}, people = 2) => createWorld(parseStage(MAP, json(scale)), Array.from({ length: people }, () => ({ color: '#F4F7FF' })), 3);
const FLOOR = 12 * 30;
const SPOT = { leftBox: 200, leftMarble: 300, rightBox: 530, rightMarble: 640, leftBin: 94, rightBin: 754, addsub: 394, divide: 454 };
const go = (w: World, i: number, x: number) => { const p = w.players[i]; p.x = x; p.y = FLOOR - PH; p.vx = 0; p.vy = 0; };
const wait = (w: World, seconds: number) => { for (let f = 0; f < seconds * 60; f++) step(w, [], 1 / 60); };
const press = (w: World, i: number) => { const pads: Pad[] = []; pads[i] = { m: 0, j: false, a: true }; step(w, pads, 1 / 60); step(w, [], 1 / 60); };
const act = (w: World, i: number, x: number) => { go(w, i, x); press(w, i); };
const board = (w: World) => w.scales[0].lines.map(l => `${sideText(l[0], l[1])} = ${sideText(l[2], l[3])}`);
/** 양쪽에서 구슬을 n 개씩 들어다 통에 버린다. */
const removeBoth = (w: World, n: number) => { for (let k = 0; k < n; k++) { act(w, 0, SPOT.leftMarble); act(w, 1, SPOT.rightMarble); act(w, 0, SPOT.leftBin); act(w, 1, SPOT.rightBin); wait(w, 0.7); } };
const toSub = (w: World) => { act(w, 0, SPOT.addsub); go(w, 0, SPOT.leftMarble); };

describe('식 만들기', () => {
  it('같은 씨앗이면 같은 식, 늘 수평이고 범위 안이다', () => {
    const spec = { x: [2, 6] as [number, number], leftBoxes: [2, 4] as [number, number], leftMarbles: [0, 5] as [number, number], rightBoxes: [0, 1] as [number, number] };
    expect(checkSpec(spec)).toBeNull();
    const seen = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const a = makeEquation(spec, rng(seed)), b = makeEquation(spec, rng(seed));
      expect(a).toEqual(b);
      const [lb, lm, rb, rm] = a.line;
      expect(lb * a.x + lm).toBe(rb * a.x + rm);
      expect(a.x).toBeGreaterThanOrEqual(2); expect(a.x).toBeLessThanOrEqual(6);
      expect(lb).toBeGreaterThan(rb); expect(rm).toBeLessThanOrEqual(30);
      seen.add(a.line.join());
    }
    expect(seen.size).toBeGreaterThan(40);   // 할 때마다 다른 식이 나온다
  });
  it('약속에 안 맞는 범위는 까닭을 알려 준다', () => {
    expect(checkSpec({ x: [2, 9], leftBoxes: [4, 6], leftMarbles: [0, 9], rightBoxes: [0, 0] })).toMatch(/넘지 않게/);
    expect(checkSpec({ x: [2, 3], leftBoxes: [1, 2], leftMarbles: [0, 1], rightBoxes: [1, 1] })).toMatch(/늘 많아야/);
  });
  it('식을 글로 적는다', () => {
    expect(sideText(2, 3)).toBe('2x + 3'); expect(sideText(1, 0)).toBe('x'); expect(sideText(0, 11)).toBe('11'); expect(sideText(0, 0)).toBe('0');
    expect(stepText([2, 3, 0, 11], [2, 0, 0, 8])).toBe('양변에서 3을 뺀다');
    expect(stepText([2, 2, 0, 10], [2, 0, 0, 8])).toBe('양변에서 2를 뺀다');
    expect(stepText([2, 0, 0, 8], [1, 0, 0, 4])).toBe('양변을 2로 나눈다');
    expect(stepText([3, 0, 0, 12], [1, 0, 0, 4])).toBe('양변을 3으로 나눈다');
    expect(stepText([3, 2, 1, 10], [2, 2, 0, 10])).toBe('양변에서 x를 뺀다');
    expect(stepText([2, 3, 0, 11], [1, 3, 0, 7])).toBe('');
    expect(stepOf([2, 3, 0, 11], [2, 4, 0, 12]).kind).toBe('add');
    expect([eul(1), eul(2), eul(6), eul(10), euro(1), euro(3), euro(4), euro(10)]).toEqual(['1을', '2를', '6을', '10을', '1로', '3으로', '4로', '10으로']);
    expect(commonDivisor([2, 0, 0, 8])).toBe(2); expect(commonDivisor([2, 3, 0, 11])).toBe(1); expect(commonDivisor([4, 2, 2, 8])).toBe(2);
  });
});

describe('지도에서 저울 읽기', () => {
  it('접시·통·레버를 찾는다', () => {
    const s = parseStage(MAP, json());
    expect(s.scales.length).toBe(1); expect(s.bins.length).toBe(2); expect(s.levers.map(l => l.does).sort()).toEqual(['addsub', 'divide']);
    expect(s.scales[0].pans[0].w).toBe(180); expect(s.scales[0].floor).toBe(FLOOR); expect(s.scales[0].hasAddSub).toBe(true);
  });
  it('모자란 것은 무엇이 모자란지 알려 준다', () => {
    expect(() => parseStage(MAP.replaceAll('r', '.'), json({}, { r: undefined }))).toThrow();
    expect(() => parseStage(MAP.replaceAll('w', '.'), { ...json(), legend: Object.fromEntries(Object.entries(json().legend!).filter(([k]) => k !== 'w')) })).toThrow(/나누기 레버/);
    expect(() => parseStage(MAP.replaceAll('u', '.'), { ...json(), legend: Object.fromEntries(Object.entries(json().legend!).filter(([k]) => k !== 'u')) })).toThrow(/통/);
    expect(() => parseStage(MAP.replace('llllll', '.lllll'), json())).toThrow(/6~8칸/);
    expect(() => parseStage(MAP, json({ left: { boxes: 1, marbles: 3 }, right: { boxes: 1 } }))).toThrow(/늘 많아야/);
    expect(() => parseStage(MAP, json({ spill: 1 }))).toThrow(/spill/);
    expect(() => parseStage(MAP, json({ weight: 3 }))).toThrow(/모르는 칸/);
    expect(() => parseStage(MAP, json({ left: 5 }))).toThrow(/모양이어야/);
    // 아무것도 안 해도 풀리는 식(처음부터 x = 3)은 받지 않는다
    expect(() => parseStage(MAP, { ...json(), scales: { s: { x: 3, opens: ['x'] } } })).toThrow(/처음부터 x 만 남은/);
    expect(() => parseStage(MAP, json({ left: { boxes: [1, 2], marbles: [0, 3] } }))).toThrow(/처음부터 x 만 남은/);
    // 통이나 레버를 접시 밑·바로 옆에 두면 확인이 엉뚱한 일을 하므로 받지 않는다
    const moved = (from: number, to: number) => { const ls = MAP.split('\n'); const ch = ls[11][from]; ls[11] = ls[11].slice(0, from) + '.' + ls[11].slice(from + 1); ls[11] = ls[11].slice(0, to) + ch + ls[11].slice(to + 1); return ls.join('\n'); };
    expect(() => parseStage(moved(3, 8), json())).toThrow(/비워 주세요|둘 수 없어요/);
    expect(() => parseStage(moved(15, 16), json())).toThrow(/둘 수 없어요/);
    expect(() => parseStage(moved(3, 5), json())).toThrow(/둘 수 없어요/);
    expect(() => parseStage(MAP, json({ opens: [['x']] }))).toThrow(/8개까지/);
    expect(() => parseStage(MAP, json({ opens: Array(9).fill('x') }))).toThrow(/8개까지/);
  });
  it('저울이 여는 다리는 단추가 없어도 된다', () => { expect(() => parseStage(MAP, json())).not.toThrow(); });
});

describe('한쪽만 손대면 기운다', () => {
  it('왼쪽에서 구슬 하나를 들면 오른쪽이 무거워지고, 오른쪽도 하나 들면 다시 수평이다', () => {
    const w = make(); wait(w, 0.3);
    expect(w.scales[0].line).toEqual([2, 3, 0, 11]); expect(w.scales[0].tilt).toBe(0);
    act(w, 0, SPOT.leftMarble);
    expect(w.players[0].carry).toEqual({ kind: 'marble', scale: 0, from: 0 });
    expect(w.scales[0].line).toEqual([2, 2, 0, 11]); expect(w.scales[0].tilt).toBe(1);
    act(w, 1, SPOT.rightMarble);
    expect(w.scales[0].tilt).toBe(0);
  });
  it('상자 칸 밑에서는 상자를 든다(무게를 모르는 채로 기운다)', () => {
    const w = make(); wait(w, 0.3);
    expect(actionAt(w, (go(w, 0, SPOT.leftBox), w.players[0]))).toMatchObject({ do: 'take', kind: 'box', side: 0 });
    act(w, 0, SPOT.leftBox);
    expect(w.players[0].carry?.kind).toBe('box'); expect(w.scales[0].line[0]).toBe(1); expect(w.scales[0].tilt).toBe(1);
    press(w, 0);   // 든 채로 다시 누르면 도로 올려놓는다
    expect(w.players[0].carry).toBeNull(); expect(w.scales[0].line[0]).toBe(2);
  });
  it('기운 채로는 풀이 판에 줄이 늘지 않는다', () => {
    const w = make(); wait(w, 0.3);
    act(w, 0, SPOT.leftMarble); wait(w, 3);
    expect(board(w)).toEqual(['2x + 3 = 11']);
  });
});

describe('통과 더하기·빼기 레버', () => {
  it('처음에는 더하기라 버릴 수 없고, 레버를 당기면 빼기가 되어 버릴 수 있다', () => {
    const w = make(); wait(w, 0.3);
    act(w, 0, SPOT.leftMarble); act(w, 0, SPOT.leftBin);
    expect(w.players[0].carry).not.toBeNull(); expect(w.scales[0].note).toMatch(/더하기라/);
    act(w, 1, SPOT.addsub);
    expect(w.scales[0].mode).toBe('sub');
    act(w, 0, SPOT.leftBin);
    expect(w.players[0].carry).toBeNull();
  });
  it('더하기일 때 빈손으로 통에 가면 구슬을 꺼낸다. 빼기일 때는 못 꺼낸다', () => {
    const w = make(); wait(w, 0.3);
    act(w, 0, SPOT.leftBin);
    expect(w.players[0].carry).toEqual({ kind: 'marble', scale: 0, from: -1 });
    act(w, 0, SPOT.leftMarble);
    expect(w.scales[0].line).toEqual([2, 4, 0, 11]); expect(w.scales[0].tilt).toBe(-1);
    act(w, 1, SPOT.addsub); act(w, 0, SPOT.leftBin);
    expect(w.players[0].carry).toBeNull(); expect(w.scales[0].note).toMatch(/빼기라/);
  });
  it('레버가 없는 저울의 통은 넣고 빼기를 다 한다', () => {
    const lg = Object.fromEntries(Object.entries(json().legend!).filter(([k]) => k !== 'v'));
    const w = createWorld(parseStage(MAP.replaceAll('v', '.'), { ...json(), legend: lg }), [{ color: '#fff' }, { color: '#fff' }], 3); wait(w, 0.3);
    act(w, 0, SPOT.leftBin); expect(w.players[0].carry?.kind).toBe('marble');
    press(w, 0); expect(w.players[0].carry).toBeNull();
  });
});

describe('풀이 판', () => {
  it('양쪽에서 같은 수를 빼면 한 줄이 적히고, 이어서 빼면 한 줄로 모인다', () => {
    const w = make(); wait(w, 0.3); toSub(w);
    removeBoth(w, 1);
    expect(board(w)).toEqual(['2x + 3 = 11', '2x + 2 = 10']);
    removeBoth(w, 2);
    expect(board(w)).toEqual(['2x + 3 = 11', '2x = 8']);
    expect(stepText(w.scales[0].lines[0], w.scales[0].lines[1])).toBe('양변에서 3을 뺀다');
  });
  it('도로 올려놓으면 줄이 지워진다', () => {
    const w = make(); wait(w, 0.3);
    act(w, 0, SPOT.leftMarble); act(w, 1, SPOT.rightMarble); wait(w, 0.7);
    expect(board(w).length).toBe(2);
    press(w, 0); press(w, 1); wait(w, 0.7);
    expect(board(w)).toEqual(['2x + 3 = 11']);
  });
});

describe('나누기 레버', () => {
  it('똑같이 못 나누면 걸린다(2x + 3 = 11)', () => {
    const w = make(); wait(w, 0.3);
    act(w, 0, SPOT.divide);
    expect(w.scales[0].line).toEqual([2, 3, 0, 11]); expect(w.scales[0].note).toMatch(/똑같이 나눌 수 없어요/); expect(w.scales[0].shake).toBeGreaterThan(0);
  });
  it('기울어 있으면 걸린다', () => {
    const w = make({ left: { boxes: 2, marbles: 0 } }); wait(w, 0.3);
    act(w, 0, SPOT.leftBox); act(w, 1, SPOT.divide);
    expect(w.scales[0].note).toMatch(/기울어/); expect(w.scales[0].line[3]).toBe(8);
  });
  it('3을 빼고 2로 나누면 x = 4 가 되고 다리가 놓인다', () => {
    const w = make(); wait(w, 0.3); toSub(w);
    expect(w.active.has('x')).toBe(false);
    removeBoth(w, 3);
    act(w, 0, SPOT.divide); wait(w, 0.7);
    expect(board(w)).toEqual(['2x + 3 = 11', '2x = 8', 'x = 4']);
    expect(w.scales[0].solved).toBe(false);   // 잠깐 스친 것은 치지 않는다. 가만히 수평이어야 풀린다
    wait(w, 1.2);
    expect(w.scales[0].solved).toBe(true); expect(w.active.has('x')).toBe(true);
    // 풀린 저울은 더 손댈 수 없다
    act(w, 0, SPOT.leftBox); expect(w.players[0].carry).toBeNull();
  });
  it('수평이 되자마자 나눠도 빼기 줄이 빠지지 않는다', () => {
    const w = make({ left: { boxes: 2, marbles: 1 } }); wait(w, 0.3);   // 2x + 1 = 9
    act(w, 0, SPOT.leftMarble); act(w, 1, SPOT.rightMarble);          // 양쪽에서 하나씩 든 채(수평) 곧바로
    go(w, 0, SPOT.divide); press(w, 0); wait(w, 0.7);
    expect(board(w)).toEqual(['2x + 1 = 9', '2x = 8', 'x = 4']);
    expect(stepText(w.scales[0].lines[0], w.scales[0].lines[1])).toBe('양변에서 1을 뺀다');
  });
  it('2x + 4 = 10 처럼 다 나뉘면 빼기 전에 나눠도 된다', () => {
    const w = make({ x: 3, left: { boxes: 2, marbles: 4 } }); wait(w, 0.3);
    act(w, 0, SPOT.divide); wait(w, 0.7);
    expect(board(w)).toEqual(['2x + 4 = 10', 'x + 2 = 5']);
  });
});

describe('되돌아가기', () => {
  it('쏟아지는 저울은 기운 채로 오래 두면 처음 식으로 돌아가고 손도 빈다', () => {
    const w = make({ spill: 3 }); wait(w, 0.3); toSub(w);
    removeBoth(w, 1);
    expect(board(w)).toEqual(['2x + 3 = 11', '2x + 2 = 10']);
    act(w, 0, SPOT.leftMarble); wait(w, 2.5);
    expect(w.scales[0].line).toEqual([2, 1, 0, 10]);
    wait(w, 0.7);
    expect(w.scales[0].line).toEqual([2, 3, 0, 11]); expect(board(w)).toEqual(['2x + 3 = 11']);
    expect(w.players[0].carry).toBeNull(); expect(w.scales[0].note).toMatch(/처음 식으로/);
  });
  it('양쪽 상자 수가 같아지면(x 를 알 수 없으면) 앞 줄로 돌아간다', () => {
    const w = make({ left: { boxes: 2, marbles: 1 }, right: { boxes: 1 } }); wait(w, 0.3);   // 2x + 1 = x + 5
    expect(w.scales[0].line).toEqual([2, 1, 1, 5]);
    act(w, 0, SPOT.leftBox);
    for (let k = 0; k < 4; k++) { act(w, 1, SPOT.rightMarble); w.players[1].carry = null; }   // 오른쪽에서 구슬 넷을 치운다
    expect(w.scales[0].tilt).toBe(0);
    wait(w, 0.7);
    expect(w.scales[0].line).toEqual([2, 1, 1, 5]); expect(w.scales[0].note).toMatch(/x 를 알 수 없어요/); expect(board(w).length).toBe(1);
  });
  it('구슬을 든 채 떨어지면 구슬은 꺼낸 접시로 돌아간다', () => {
    const w = make(); wait(w, 0.3);
    act(w, 0, SPOT.leftMarble);
    w.players[0].x = 28 * 30 + 30; w.players[0].y = FLOOR + 10;   // 다리가 없는 구덩이 속
    wait(w, 2);
    expect(w.players[0].carry).toBeNull(); expect(w.scales[0].line).toEqual([2, 3, 0, 11]);
  });
  it('든 것이 돌아갈 때 접시가 가득 차 있으면 넘치지 않는다', () => {
    const w = make({}, 2); wait(w, 0.3);
    w.scales[0].line[3] = 30;
    act(w, 1, SPOT.rightMarble); expect(w.scales[0].line[3]).toBe(29);
    w.scales[0].line[3] = 30;                                      // 그새 다른 사람이 채웠다
    w.players[1].x = 28 * 30 + 30; w.players[1].y = FLOOR + 10; wait(w, 2);
    expect(w.players[1].carry).toBeNull(); expect(w.scales[0].line[3]).toBe(30);
  });
  it('방에서 나간 사람이 들고 있던 것도 돌아간다', async () => {
    const { setPlayerCount } = await import('../platform/sim');
    const w = make({}, 3); wait(w, 0.3);
    act(w, 2, SPOT.leftBox);
    setPlayerCount(w, ['#fff', '#fff']);
    expect(w.scales[0].line).toEqual([2, 3, 0, 11]);
  });
});

describe('아무렇게나 눌러서는 풀리지 않는다', () => {
  it('뛰고 걷고 확인을 마구 누르는 봇은 한 판 시간(45초) 안에 x 만 남기지 못한다', () => {
    let seed = 5; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const spill of [0, 6]) for (const people of [2, 8]) for (let trial = 0; trial < 6; trial++) {
      const w = make({ spill }, people);
      let pads: Pad[] = [];
      for (let f = 0; f < 45 * 60; f++) {
        if (f % 15 === 0) pads = w.players.map(() => ({ m: ([-1, 0, 1, 1] as const)[Math.floor(rnd() * 4)], j: rnd() < 0.3, a: rnd() < 0.5 }));
        step(w, pads, 1 / 60);
      }
      expect(w.scales[0].solved).toBe(false);
    }
  });
});

describe('저울 여러 대', () => {
  const WIDE = [
    ...Array(8).fill('.'.repeat(60)),
    row({ 4: 'llllll', 13: 'rrrrrr', 25: 'mmmmmm', 34: 'nnnnnn' }).padEnd(60, '.'),
    '.'.repeat(60), '.'.repeat(60),
    row({ 1: '@', 2: 'u', 11: 'w', 21: 'u', 23: 'p', 32: 'q', 39: '.' }).padEnd(60, '.').slice(0, 42) + 'p.........K..D....',
    '#'.repeat(44) + 'xxx' + '#'.repeat(13),
    '#'.repeat(44) + '...' + '#'.repeat(13),
  ].join('\n');
  const DEF: StageJson = {
    legend: {
      l: { type: 'pan', scale: 'a', side: 'left' }, r: { type: 'pan', scale: 'a', side: 'right' }, u: { type: 'bin', scale: 'a' }, w: { type: 'lever', scale: 'a', does: 'divide' },
      m: { type: 'pan', scale: 'b', side: 'left' }, n: { type: 'pan', scale: 'b', side: 'right' }, p: { type: 'bin', scale: 'b' }, q: { type: 'lever', scale: 'b', does: 'divide' },
      x: { type: 'bridge' },
    },
    scales: { a: { x: [2, 6], left: { boxes: [2, 3] }, opens: ['x'] }, b: { x: [2, 6], left: { boxes: [2, 3], marbles: [1, 4] }, opens: ['x'] } },
  };
  it('저울마다 다른 식이 뜨고, 다른 저울의 것은 올려놓지 못한다', () => {
    const differ = [1, 2, 3, 4, 5, 6].filter(seed => { const w = createWorld(parseStage(WIDE, DEF), [{ color: '#fff' }, { color: '#fff' }], seed); return w.scales[0].line.join() !== w.scales[1].line.join(); });
    expect(differ.length).toBeGreaterThan(3);
    const w = createWorld(parseStage(WIDE, DEF), [{ color: '#fff' }, { color: '#fff' }], 2); wait(w, 0.3);
    act(w, 0, 25 * 30 + 150);                      // 저울 b 의 왼쪽 접시에서 구슬을 든다
    expect(w.players[0].carry?.scale).toBe(1);
    const before = [...w.scales[0].line];
    act(w, 0, 13 * 30 + 150);                      // 저울 a 의 오른쪽 접시에 올리려 한다
    expect(w.scales[0].line).toEqual(before); expect(w.players[0].carry).not.toBeNull(); expect(w.scales[0].note).toMatch(/다른 저울/);
    act(w, 0, 21 * 30 + 4);                        // 저울 a 의 통에 버리려 한다(남의 통으로 레버를 건너뛰지 못한다)
    expect(w.players[0].carry).not.toBeNull(); expect(w.scales[0].note).toMatch(/다른 저울의 통/);
  });
});

describe('풍선(음수)', () => {
  it('식과 설명을 글로 적는다', () => {
    expect(sideText(1, -3)).toBe('x - 3'); expect(sideText(2, -1)).toBe('2x - 1');
    expect(stepText([1, -3, 0, 5], [1, 0, 0, 8])).toBe('양변에 3을 더한다');
    expect(stepText([2, -4, 0, 6], [1, -2, 0, 3])).toBe('양변을 2로 나눈다');
    expect(commonDivisor([2, -4, 0, 6])).toBe(2);
    expect(checkSpec({ x: [3, 5], leftBoxes: [2, 3], leftMarbles: [-4, -1], rightBoxes: [0, 0] })).toBeNull();
    expect(checkSpec({ x: [1, 5], leftBoxes: [1, 1], leftMarbles: [-4, -1], rightBoxes: [0, 0] })).toMatch(/0개보다 적어질/);
    expect(checkSpec({ x: [3, 5], leftBoxes: [1, 1], leftMarbles: [-2, 2], rightBoxes: [0, 0] })).toMatch(/처음부터 x 만 남은/);
  });
  it('풍선은 뗄 수 없고, 양쪽에 구슬을 올리면 풍선이 터지며 수평을 지킨다(x - 2 = 2)', () => {
    const w = make({ left: { boxes: 1, marbles: -2 } }); wait(w, 0.3);
    expect(w.scales[0].line).toEqual([1, -2, 0, 2]); expect(w.scales[0].tilt).toBe(0);
    act(w, 0, SPOT.leftMarble);
    expect(w.players[0].carry).toBeNull(); expect(w.scales[0].note).toMatch(/풍선은 뗄 수 없어요/);
    for (let k = 0; k < 2; k++) {
      act(w, 0, SPOT.leftBin); act(w, 1, SPOT.rightBin);            // 처음은 더하기라 통에서 구슬이 나온다
      act(w, 0, SPOT.leftMarble); expect(w.scales[0].tilt).toBe(-1); // 왼쪽만 올리면 왼쪽이 무겁다
      act(w, 1, SPOT.rightMarble); expect(w.scales[0].tilt).toBe(0);
      wait(w, 0.7);
    }
    expect(board(w)).toEqual(['x - 2 = 2', 'x = 4']);
    expect(stepText(w.scales[0].lines[0], w.scales[0].lines[1])).toBe('양변에 2를 더한다');
    wait(w, 1.5); expect(w.scales[0].solved).toBe(true);
  });
});

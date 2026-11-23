/** 연습 팩을 두 명이 실제 조작만으로 끝까지 깰 수 있는지 본다(판을 고칠 때 깨지면 여기서 드러난다). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStage, T } from '../platform/stage';
import { createWorld, step, type Pad, type World } from '../platform/sim';

const dir = new URL('../packs/etc/tutorial/stages/', import.meta.url);
const stage = () => parseStage(readFileSync(new URL('01.map.txt', dir), 'utf8'), JSON.parse(readFileSync(new URL('01.json', dir), 'utf8')));

type Plan = (w: World, i: number, stuck: boolean) => Pad;
const stay: Plan = () => ({ m: 0, j: false });
const walkTo = (x: number): Plan => (w, i, stuck) => { const dx = x - w.players[i].x; return { m: Math.abs(dx) > 2 ? (dx > 0 ? 1 : -1) : 0, j: stuck, a: true }; };
const rightJump: Plan = () => ({ m: 1, j: true });

/** 조건이 될 때까지 계획대로 움직인다. 막혀서 제자리면 뛰게 한다. */
function drive(w: World, plans: Plan[], until: (w: World) => boolean, seconds = 20) {
  const prev = w.players.map(p => p.x);
  for (let f = 0; f < seconds * 60; f++) {
    if (until(w)) return true;
    const pads = w.players.map((p, i) => { const pad = plans[i](w, i, p.on && p.x === prev[i]); prev[i] = p.x; return pad; });
    // 뛰기 단추는 눌렀다 떼야 다시 뛴다
    pads.forEach((pad, i) => { if (w.players[i].jumpHeld && plans[i] !== rightJump) pad.j = false; });
    step(w, pads, 1 / 60);
  }
  return until(w);
}

describe('연습 팩 01', () => {
  it('두 명이 힘을 합치면 끝까지 간다', () => {
    const w = createWorld(stage(), [{ color: '#fff' }, { color: '#fff' }]);
    const [A, B] = w.players;
    const onPlatform = (p: typeof A) => p.on && Math.abs(p.y + p.h - 12 * T) <= 1;
    // B 가 낮은 발판 오른쪽 끝에 선다
    expect(drive(w, [stay, walkTo(30)], () => Math.abs(B.x - 30) <= 2 && B.on)).toBe(true);
    expect(drive(w, [stay, rightJump], () => onPlatform(B), 4)).toBe(true);
    expect(drive(w, [stay, walkTo(176)], () => Math.abs(B.x - 176) <= 2 && onPlatform(B))).toBe(true);
    // A 가 발판에 올라 B 머리 위로 올라선다
    expect(drive(w, [walkTo(30), stay], () => Math.abs(A.x - 30) <= 2 && A.on)).toBe(true);
    expect(drive(w, [rightJump, stay], () => onPlatform(A), 4)).toBe(true);
    const hopOn: Plan = () => { const dx = B.x - A.x; return { m: Math.abs(dx) > 2 ? (dx > 0 ? 1 : -1) : 0, j: Math.abs(dx) < 30 }; };   // 옆에 붙으면 뛰어 머리 위로
    expect(drive(w, [hopOn, stay], () => A.on && Math.abs(A.y + A.h - B.y) <= 2)).toBe(true);
    // 머리 위에서 오른쪽으로 뛰어 높은 받침에 올라 열쇠를 잡는다
    expect(drive(w, [rightJump, stay], x => x.key.holder === 0, 4)).toBe(true);
    // B 가 내려와 단추 a 를 밟는다
    expect(drive(w, [stay, walkTo(14 * T + 4)], x => x.active.has('x'))).toBe(true);
    // A 가 다리를 건너 건너편 단추 b 에 선다
    expect(drive(w, [walkTo(22 * T + 4), stay], x => A.on && A.x >= 22 * T + 2 && x.pressed[1] >= 1)).toBe(true);
    // B 가 다리를 건너와 단추 위 A 의 머리에 올라선다(A 가 단추를 떠나면 그 자리 땅에 내려선다)
    expect(drive(w, [stay, walkTo(22 * T + 2)], () => B.on && B.x >= 21 * T + 20 && B.y < A.y)).toBe(true);
    // A 가 상자를 높은 단 앞까지 밀고, 상자를 딛고 올라 문을 연다
    const pushRight: Plan = () => ({ m: 1, j: false });   // 밀 때는 뛰지 않고 오른쪽만 누른다
    expect(drive(w, [pushRight, stay], x => x.crates[0].x >= 28 * T - 1)).toBe(true);
    expect(drive(w, [walkTo(40 * T), stay], x => x.doorOpen)).toBe(true);
    expect(drive(w, [walkTo(40 * T), walkTo(40 * T)], x => x.won)).toBe(true);
    expect(w.players.every(p => p.inDoor)).toBe(true);
  });

  it('상자를 밀지 못하면 높은 단에 오르지 못한다(상자가 꼭 필요하다)', () => {
    const w = createWorld(stage(), [{ color: '#fff' }, { color: '#fff' }]);
    w.crates[0].need = 99;                       // 아무도 못 미는 상자
    w.players.forEach(p => { p.x = 22 * T; });   // 둘 다 다리 건너편에서 시작
    w.key.holder = 0;
    drive(w, [walkTo(40 * T), walkTo(40 * T)], x => x.doorOpen, 25);
    expect(w.doorOpen).toBe(false);
  });

  it('혼자 들어온 방에서는 끝나지 않는다(다리를 붙잡아 줄 사람이 없다)', () => {
    const w = createWorld(stage(), [{ color: '#fff' }]);
    drive(w, [walkTo(40 * T)], x => x.won, 30);
    expect(w.won).toBe(false);
  });

  it('아무렇게나 누르는 봇 두 명은 60초 안에 못 깬다', () => {
    let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let trial = 0; trial < 5; trial++) {
      const w = createWorld(stage(), [{ color: '#fff' }, { color: '#fff' }]);
      let pads: Pad[] = [{ m: 0, j: false }, { m: 0, j: false }];
      for (let f = 0; f < 60 * 60; f++) {
        if (f % 20 === 0) pads = pads.map(() => ({ m: ([-1, 0, 1, 1] as const)[Math.floor(rnd() * 4)], j: rnd() < 0.4 }));
        step(w, pads, 1 / 60);
      }
      expect(w.won).toBe(false);
    }
  });
});

describe('연습 팩 02(그래프 찍어 들기)', () => {
  it('식 0, 범위 0~7, 손잡이를 끝(0)에 단 그래프를 구덩이에 걸치면 모두 건너 문에 들어간다', async () => {
    const { stamp, dropAt, run: go } = await import('./graph-help');
    const st = parseStage(readFileSync(new URL('02.map.txt', dir), 'utf8'), JSON.parse(readFileSync(new URL('02.json', dir), 'utf8')));
    const w = createWorld(st, [{ color: '#fff' }, { color: '#fff' }], 1);
    dropAt(w, stamp(w, '0', 0, 7, 0), 18 * 30 + 15, 330); go(w, 2);
    w.players.forEach((p, i) => { p.x = (15 - i) * 30; p.y = 390 - p.h; });
    const door = w.stage.door!.x + 20;
    expect(drive(w, [walkTo(door), walkTo(door)], () => w.won, 40)).toBe(true);
  });
  it('그래프 없이는 구덩이를 못 건넌다', () => {
    const st = parseStage(readFileSync(new URL('02.map.txt', dir), 'utf8'), JSON.parse(readFileSync(new URL('02.json', dir), 'utf8')));
    const w = createWorld(st, [{ color: '#fff' }, { color: '#fff' }], 1);
    const door = w.stage.door!.x + 20;
    expect(drive(w, [walkTo(door), walkTo(door)], () => w.won, 20)).toBe(false);
  });
});

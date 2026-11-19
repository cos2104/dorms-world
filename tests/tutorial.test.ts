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

describe('연습 팩 02(저울)', () => {
  const stage2 = () => parseStage(readFileSync(new URL('02.map.txt', dir), 'utf8'), JSON.parse(readFileSync(new URL('02.json', dir), 'utf8')));
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('두 명이 양쪽에서 같이 덜어 내고 나누면 다리가 놓이고 끝까지 간다(식 %i)', seed => {
    const w = createWorld(stage2(), [{ color: '#fff' }, { color: '#fff' }], seed);
    const sc = w.scales[0], def = w.stage.scales[0], [L, R] = def.pans;
    const lever = (does: string) => w.stage.levers.find(l => l.does === does)!.x + 4;
    const spot = { lm: L.x + L.w * 0.7, rm: R.x + R.w * 0.7, lbin: w.stage.bins[0].x + 4, rbin: w.stage.bins[1].x + 4 };
    const walk = (x: number): Plan => (wd, i) => { const dx = x - wd.players[i].x; return { m: Math.abs(dx) > 2 ? (dx > 0 ? 1 : -1) : 0, j: false }; };
    /** i 번 도름이가 x 까지 걸어가 확인을 한 번 누른다. */
    const goTo = (i: number, x: number) => {
      const plans: Plan[] = [stay, stay]; plans[i] = walk(x);
      expect(drive(w, plans, () => Math.abs(w.players[i].x - x) <= 2, 12), `도름이 ${i + 1}이 ${Math.round(x)}까지 못 갔어요`).toBe(true);
    };
    const goTap = (i: number, x: number) => {
      goTo(i, x);
      const pads: Pad[] = [{ m: 0, j: false }, { m: 0, j: false }]; pads[i] = { m: 0, j: false, a: true };
      step(w, pads, 1 / 60); step(w, [], 1 / 60);
    };
    const rest = (seconds: number) => { for (let f = 0; f < seconds * 60; f++) step(w, [], 1 / 60); };
    rest(0.5);
    expect(sc.line[0] * sc.x + sc.line[1]).toBe(sc.line[3]);
    goTo(1, spot.rm);                                      // 오른쪽 담당이 먼저 자리로 간다(서로 지나가지 못한다)
    goTap(0, lever('addsub'));
    expect(sc.mode).toBe('sub');
    for (let guard = 0; guard < 10 && sc.line[1] > 0; guard++) {
      goTap(0, spot.lm); expect(sc.tilt).toBe(1);          // 왼쪽만 덜면 오른쪽이 무겁다
      goTap(1, spot.rm); expect(sc.tilt).toBe(0);          // 오른쪽도 덜면 다시 수평
      goTap(0, spot.lbin); goTap(1, spot.rbin);
      rest(0.7);
    }
    expect(sc.line).toEqual([2, 0, 0, 2 * sc.x]);
    expect(w.active.has('x')).toBe(false);
    goTap(1, lever('divide'));
    rest(2.2);
    expect(sc.line).toEqual([1, 0, 0, sc.x]);
    expect(sc.solved).toBe(true); expect(w.active.has('x')).toBe(true);
    const door = w.stage.door!.x + 20;
    expect(drive(w, [walkTo(door), walkTo(door)], () => w.won, 40)).toBe(true);
  });
});

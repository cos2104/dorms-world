/**
 * 저울 스테이지를 봇이 '학생처럼' 풀어 끝까지 가는지 본다(모든 팩의 저울 스테이지).
 * 봇은 x 를 모른다. 풀이 판에 보이는 식만 보고 양쪽에 같은 일을 한다: 상자 덜기 → 구슬 덜기(풍선이면 올리기) → 나누기.
 * 도름이 1은 좌변 쪽, 도름이 2는 우변 쪽을 맡고 나머지는 기다렸다가 마지막에 함께 문으로 간다.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Stage } from '../platform/stage';
import { readStage } from './pack-io';
import { createWorld, step, SPEED, type Pad, type World } from '../platform/sim';

const root = fileURLToPath(new URL('../packs/', import.meta.url));
const dirs = (p: string) => readdirSync(p).filter(n => lstatSync(join(p, n)).isDirectory());   // 바로 가기 폴더는 따라가지 않는다
const stages = dirs(root).flatMap(f => dirs(join(root, f)).flatMap(n => {
  const dir = join(root, f, n), meta = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'));
  for (const s of meta.stages) if (!/^\d{2}$/.test(String(s.file))) throw new Error(`${f}/${n}: 스테이지 파일 이름은 두 자리 숫자여야 해요("${s.file}")`);
  return (meta.stages as { file: string; name: string }[]).map(s => ({ id: `${f}/${n} ${s.file} ${s.name}`, load: () => readStage(dir, String(s.file)).stage }));
})).filter(s => { const st = s.load(); return st.scales.length > 0 && !st.buttons.length && !st.crates.length; });

/** 봇 조작기. 걷다가 막히면 뛴다(친구를 넘어간다). */
function bot(w: World) {
  const prev = w.players.map(p => p.x);
  let budget = 60 * 60 * 12;   // 한 판에 12분어치 걸음까지만(팩이 검사 시간을 끝없이 끌지 못하게)
  const tick = (pads: Pad[]) => { if (--budget < 0) throw new Error('봇이 너무 오래 걸려요. 저울과 통 사이가 너무 멀거나 길이 막혀 있어요.'); step(w, pads, 1 / 60); };
  const idle = () => w.players.map<Pad>(() => ({ m: 0, j: false }));
  const rest = (seconds: number) => { for (let f = 0; f < seconds * 60; f++) tick(idle()); };
  const goTo = (i: number, x: number, seconds = 15) => {
    for (let f = 0; f < seconds * 60; f++) {
      const p = w.players[i], dx = x - p.x;
      if (Math.abs(dx) <= 2 && p.on) return;
      const pads = idle(); pads[i] = { m: Math.abs(dx) > 2 ? (dx > 0 ? 1 : -1) : 0, j: p.on && p.x === prev[i] && !p.jumpHeld };
      prev[i] = p.x; tick(pads);
    }
    throw new Error(`도름이 ${i + 1}이 ${Math.round(x)}까지 못 갔어요(지금 ${Math.round(w.players[i].x)})`);
  };
  const tap = (...who: number[]) => { for (const i of who) { const pads = idle(); pads[i] = { m: 0, j: false, a: true }; tick(pads); } tick(idle()); };
  return { rest, goTo, tap };
}

function solve(stage: Stage, people: number, seed: number) {
  const w = createWorld(stage, Array.from({ length: people }, () => ({ color: '#F4F7FF' })), seed);
  // 시작 줄의 맨 오른쪽 두 명이 맡는다(사람이 많으면 왼쪽 아래 도름이는 친구들에게 둘러싸여 바로 움직이지 못한다)
  const { rest, goTo, tap } = bot(w), A = people - 2, B = people - 1;
  rest(0.5);
  stage.scales.forEach((def, si) => {
    const sc = w.scales[si], [L, R] = def.pans;
    const bins = stage.bins.filter(b => b.scale === si), lbin = bins.filter(b => b.x < L.x).pop()!, rbin = bins.find(b => b.x > R.x)!;
    const lever = (does: string) => stage.levers.find(l => l.scale === si && l.does === does);
    const spot = { lb: L.x + 20, lm: L.x + L.w * 0.7, rb: R.x + 20, rm: R.x + R.w * 0.7, lbin: lbin.x + 4, rbin: rbin.x + 4 };
    const mode = (want: 'add' | 'sub') => { if (def.hasAddSub && sc.mode !== want) { goTo(A, lever('addsub')!.x + 4); tap(A); } };
    for (let guard = 0; guard < 40 && !sc.solved; guard++) {
      const [lb, lm, rb] = sc.line;
      if (rb > 0) { mode('sub'); goTo(B, spot.rb); goTo(A, spot.lb); tap(A, B); goTo(B, spot.rbin); tap(B); goTo(A, spot.lbin); tap(A); }          // 양변에서 x 를 뺀다
      else if (lm > 0) { mode('sub'); goTo(B, spot.rm); goTo(A, spot.lm); tap(A, B); goTo(B, spot.rbin); tap(B); goTo(A, spot.lbin); tap(A); }     // 양변에서 1을 뺀다
      else if (lm < 0) { mode('add'); goTo(B, spot.rbin); tap(B); goTo(A, spot.lbin); tap(A); goTo(B, spot.rm); goTo(A, spot.lm); tap(A, B); }     // 양변에 1을 더한다
      else if (lb > 1) { goTo(B, spot.rm); goTo(A, lever('divide')!.x + 4); tap(A); }                                                              // 양변을 나눈다
      else rest(1.7);
      rest(0.6);
      expect(sc.lines.length, '쏟아지지 않고 한 줄씩 나아간다').toBeGreaterThan(0);
    }
    expect(sc.solved, `저울 ${def.name} 을 못 풀었어요: ${JSON.stringify(sc.lines)}`).toBe(true);
  });
  return w;
}

/** 모두 문으로: 오른쪽으로 걸으며 확인을 누르고, 막히면 뛴다. */
function finish(w: World, seconds: number) {
  const door = w.stage.door!.x + 20, prev = w.players.map(p => p.x);
  for (let f = 0; f < seconds * 60 && !w.won; f++) {
    step(w, w.players.map((p, i) => { const dx = door - p.x, stuck = p.on && p.x === prev[i]; prev[i] = p.x; return { m: Math.abs(dx) > 2 ? (dx > 0 ? 1 : -1) : 0, j: stuck && !p.jumpHeld && f % 7 === i % 7, a: true }; }), 1 / 60);
  }
  return w.won;
}

describe.each(stages)('저울 스테이지 $id', ({ load }) => {
  it.each([1, 2, 3, 4, 5, 6])('두 명이 식만 보고 풀어 끝까지 간다(식 %i)', seed => {
    const w = solve(load(), 2, seed);
    for (const sc of w.scales) {
      expect(sc.lines[sc.lines.length - 1]).toEqual([1, 0, 0, sc.x]);
      expect(sc.lines.length, '풀이가 두 줄 이상이다').toBeGreaterThan(1);
    }
    expect(finish(w, 60)).toBe(true);
  });
  it.each([8, 30])('%i명이어도 풀고 모두 문에 들어간다', people => {
    expect(finish(solve(load(), people, 9), 240)).toBe(true);
  });
  it('저울을 풀지 않고는 문에 닿지 못한다(오른쪽으로 달리며 뛰기만 하는 두 명)', () => {
    const w = createWorld(load(), [{ color: '#fff' }, { color: '#fff' }], 3);
    for (let f = 0; f < 40 * 60; f++) step(w, w.players.map((p): Pad => ({ m: 1, j: p.on && f % 3 === 0, a: f % 2 === 0 })), 1 / 60);
    expect(w.doorOpen).toBe(false);
  });
  it('혼자 양쪽을 오가서는 시간 안에 못 맞춘다(쏟아지는 저울: 손이 닿는 가장 가까운 자리끼리 잰 거리)', () => {
    // 한 사람은 하나만 든다. 혼자 하려면 한쪽을 바꾸고(기울기 시작) 통에 들러 손을 비우거나 채운 뒤 맞은편을 바꿔야 한다.
    // 접시와 통에 손이 닿는 자리(도름이 왼쪽 끝 x 의 범위)를 구해, 그 셋을 잇는 가장 짧은 길이 쏟아지는 시간 동안 걷는 거리보다 길어야 한다.
    const stage = load(), PW = 22;
    stage.scales.forEach((def, si) => {
      if (!def.spill) return;
      const zone = (side: 0 | 1, kind: 'box' | 'marble'): [number, number] => {
        const pan = def.pans[side], split = pan.x + pan.w * 0.4, lo = pan.x - PW + 1, hi = pan.x + pan.w - 1;
        const noBoxes = side === 1 && def.spec.rightBoxes[0] === 0;       // 상자가 없는 접시는 어디서든 구슬에 손이 닿는다
        return kind === 'box' ? [lo, Math.min(hi, split - PW / 2 - 1)] : [noBoxes ? lo : split - PW / 2, hi];
      };
      const kinds: ('box' | 'marble')[] = def.spec.rightBoxes[1] > 0 ? ['box', 'marble'] : ['marble'];
      const dist = (x: number, [lo, hi]: [number, number]) => (x < lo ? lo - x : x > hi ? x - hi : 0);
      let shortest = Infinity;
      for (const bin of stage.bins.filter(b => b.scale === si)) for (const kind of kinds) for (let m = bin.x - 6 - PW + 1; m <= bin.x + 30 + 6 - 1; m++) {
        shortest = Math.min(shortest, dist(m, zone(0, kind)) + dist(m, zone(1, kind)));
      }
      const reach = def.spill * SPEED;
      expect(shortest, `저울 ${def.name}: 혼자서 ${Math.round(shortest)}px 만 걸으면 맞출 수 있어요(${def.spill}초 동안 ${reach}px 를 걸어요). 통을 접시에서 더 떼거나 spill 을 줄여 주세요.`).toBeGreaterThan(reach + 30);
    });
  });
});

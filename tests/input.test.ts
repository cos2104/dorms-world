import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStage } from '../platform/stage';
import { createWorld, step, NO_PAD, type World } from '../platform/sim';

// 자판 사건을 실제 조작 코드에 넣어, 겹쳐 누를 때 뛰기와 방향이 빠지지 않는지 본다.
class FakeTarget extends EventTarget { hidden = false; }
let win: FakeTarget, doc: FakeTarget;
const key = (type: 'keydown' | 'keyup', code: string, repeat = false) => {
  const e = new Event(type) as Event & { code: string; repeat: boolean };
  e.code = code; e.repeat = repeat; win.dispatchEvent(e);
};

const dir = new URL('../packs/etc/tutorial/stages/', import.meta.url);
const stage = parseStage(readFileSync(new URL('01.map.txt', dir), 'utf8'), JSON.parse(readFileSync(new URL('01.json', dir), 'utf8')));

async function setup() {
  const { PadInput } = await import('../platform/input');
  const pad = new PadInput();
  const w = createWorld(stage, [{ color: '#fff' }]);
  const run = (frames: number) => { let jumps = 0; for (let f = 0; f < frames; f++) { const before = w.players[0].vy; step(w, [pad.read()], 1 / 60); if (before >= 0 && w.players[0].vy < -300) jumps++; } return jumps; };
  run(30);   // 땅에 내려선다
  return { pad, w, run };
}

beforeEach(() => { win = new FakeTarget(); doc = new FakeTarget(); vi.stubGlobal('window', win); vi.stubGlobal('document', doc); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('자판을 겹쳐 눌러도 조작이 빠지지 않는다', () => {
  it('오른쪽을 누른 채 스페이스를 누르면 뛴다', async () => {
    const { run } = await setup();
    key('keydown', 'ArrowRight'); run(10);
    key('keydown', 'Space');
    expect(run(3)).toBe(1);
  });

  it('뛰기 키 하나를 누른 채 다른 뛰기 키를 눌러도 새로 뛴다(세 키가 겹친 경우)', async () => {
    const { run } = await setup();
    key('keydown', 'ArrowRight'); run(5);
    key('keydown', 'ArrowUp'); expect(run(3)).toBe(1);
    run(50);                                   // 내려선다. ↑ 는 아직 누르고 있다
    key('keydown', 'Space');                   // ↑ 를 떼지 않고 스페이스
    expect(run(3)).toBe(1);
  });

  it('한 프레임 안에 뗐다가 다시 눌러도 새 누름으로 친다', async () => {
    const { run } = await setup();
    key('keydown', 'Space'); expect(run(3)).toBe(1);
    run(50);
    key('keyup', 'Space'); key('keydown', 'Space');   // 두 사건 사이에 읽기가 없다
    expect(run(3)).toBe(1);
  });

  it('누르고 있어 되풀이되는 사건은 새 누름이 아니다', async () => {
    const { run } = await setup();
    key('keydown', 'Space');
    let jumps = run(3);
    for (let i = 0; i < 20; i++) { key('keydown', 'Space', true); jumps += run(6); }
    expect(jumps).toBe(1);
  });

  it('뗀 사건을 놓친 키도 다시 누르면 뛴다', async () => {
    const { run } = await setup();
    key('keydown', 'Space'); expect(run(3)).toBe(1);
    run(60);                                   // keyup 이 오지 않았다
    key('keydown', 'Space');
    expect(run(3)).toBe(1);
  });

  it('공중에서 일찍 눌러 그대로 누르고 있으면 착지하자마자 뛴다', async () => {
    const { run, w } = await setup();
    key('keydown', 'Space'); expect(run(3)).toBe(1);
    key('keyup', 'Space'); run(12);
    key('keydown', 'Space');                   // 착지까지 0.4초쯤 남았다
    expect(w.players[0].on).toBe(false);
    expect(run(40)).toBe(1);
  });

  it('공중에서 일찍 눌렀다 바로 떼면 착지해도 뛰지 않는다', async () => {
    const { run } = await setup();
    key('keydown', 'Space'); expect(run(3)).toBe(1);
    key('keyup', 'Space'); run(6);
    key('keydown', 'Space'); run(2); key('keyup', 'Space');
    expect(run(60)).toBe(0);
  });

  it('좌우를 함께 누르면 멈추지 않고 나중에 누른 쪽으로 간다', async () => {
    const { pad } = await setup();
    key('keydown', 'ArrowLeft'); expect(pad.read().m).toBe(-1);
    key('keydown', 'ArrowRight'); expect(pad.read().m).toBe(1);
    key('keyup', 'ArrowRight'); expect(pad.read().m).toBe(-1);
    key('keydown', 'KeyD'); key('keydown', 'KeyA'); expect(pad.read().m).toBe(-1);
    key('keyup', 'ArrowLeft'); key('keyup', 'KeyA'); expect(pad.read().m).toBe(1);
    key('keyup', 'KeyD'); expect(pad.read().m).toBe(0);
  });

  it('창을 벗어나면 누른 키가 남지 않는다', async () => {
    const { pad } = await setup();
    key('keydown', 'ArrowRight'); key('keydown', 'Space');
    win.dispatchEvent(new Event('blur'));
    const p = pad.read();
    expect([p.m, p.j]).toEqual([0, false]);
  });

  it('⌘ 를 떼면 그동안 못 받은 키 떼기를 정리한다', async () => {
    const { pad } = await setup();
    key('keydown', 'MetaLeft'); key('keydown', 'ArrowRight'); pad.read();
    key('keyup', 'MetaLeft');
    expect(pad.read().m).toBe(0);
  });
});

describe('도름이를 바꾸거나 되살아날 때 저절로 뛰지 않는다', () => {
  it('다른 도름이로 뛰다가 돌아와도, 누르지 않았으면 뛰지 않는다', async () => {
    const { PadInput } = await import('../platform/input');
    const pad = new PadInput();
    const w = createWorld(stage, [{ color: '#fff' }, { color: '#eee' }]);
    let mine = 0;
    const run = (frames: number) => { const jumped = [0, 0]; for (let f = 0; f < frames; f++) { const before = w.players.map(p => p.vy); step(w, w.players.map((_, i) => (i === mine ? pad.read() : NO_PAD)), 1 / 60); w.players.forEach((p, i) => { if (before[i] >= 0 && p.vy < -300) jumped[i]++; }); } return jumped; };
    run(30);
    key('keydown', 'Space'); expect(run(3)).toEqual([1, 0]); key('keyup', 'Space'); run(50);
    mine = 1;
    key('keydown', 'Space'); expect(run(3)).toEqual([0, 1]); key('keyup', 'Space'); run(50);
    key('keydown', 'Space'); run(3); key('keyup', 'Space'); run(50);
    mine = 0;                                   // 돌아온다. 뛰기는 누르지 않는다
    expect(run(30)).toEqual([0, 0]);
    key('keydown', 'Space'); expect(run(3)).toEqual([1, 0]);   // 돌아온 뒤 누르면 뛴다
  });

  it('뛰기를 누른 채 구덩이에 빠져 되살아나도 그 자리에서 뛰지 않는다', async () => {
    const { run, w } = await setup();
    const p = w.players[0];
    p.x = 19 * 30; p.y = 14 * 30 - p.h; p.vy = 0;         // 다리 없는 구덩이 위
    key('keydown', 'Space');                                // 공중에서 눌러 그대로 둔다
    let back = -1, jumps = 0;
    for (let f = 0; f < 240; f++) { const j = run(1); if (back < 0 && p.y < 15 * 30 && p.x < 5 * 30 && f > 20) back = f; else if (back >= 0) jumps += j; }
    expect(back).toBeGreaterThan(0);
    expect(jumps).toBe(0);
  });
});

describe('혼자 움직일 때 땅에서 새로 누른 뛰기는 늘 뛴다(무작위)', () => {
  it('벽·턱·상자·서 있는 친구 옆 어디서든', () => {
    const fails: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      let s = seed; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const n = 1 + Math.floor(r() * 4);
      const w: World = createWorld(stage, Array.from({ length: n }, () => ({ color: '#fff' })));
      let m: -1 | 0 | 1 = 0, j = false, jn = 0, check: null | { f: number; desc: string } = null;
      for (let f = 0; f < 1200; f++) {
        const p = w.players[0];
        if (check) { if (p.vy < -100) check = null; else if (f - check.f > 2) { fails.push(check.desc); check = null; } }
        if (r() < 0.04) m = ([-1, 0, 1, 1] as const)[Math.floor(r() * 4)];
        if (j) j = r() < 0.8;
        else if (r() < 0.06) {
          j = true; jn++;
          const head = { x: p.x, y: p.y - 14, w: p.w, h: 14 };
          const roomy = head.y >= 0 && ![0, p.w - 0.01].some(dx => stage.solid[Math.floor(head.y / 30) * stage.cols + Math.floor((p.x + dx) / 30)])
            && !w.players.some(q => q !== p && q.x < p.x + p.w + 4 && q.x + q.w > p.x - 4 && q.y + q.h <= p.y + 2 && q.y + q.h > p.y - 16)
            && !w.crates.some(b => b.x < p.x + p.w + 4 && b.x + b.w > p.x - 4 && b.y + b.h <= p.y + 2 && b.y + b.h > p.y - 16);
          if (p.on && roomy && !check) check = { f, desc: `seed ${seed} f ${f} x ${p.x.toFixed(1)} y ${p.y.toFixed(1)} m ${m} n ${n}` };
        }
        step(w, w.players.map((_, i) => (i === 0 ? { m, j, jn } : NO_PAD)), 1 / 60);
      }
    }
    expect(fails).toEqual([]);
  });
});

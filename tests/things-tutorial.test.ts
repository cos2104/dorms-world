/**
 * 연습 팩 셋째 스테이지(새 물건 써 보기)를 사람처럼 조작해 끝까지 깬다.
 * 봇(scripts/bots)은 새 물건을 아직 다루지 못해 '확인 못 함'으로 남기므로, 깰 수 있는지는 여기서 실제 물리로 확인한다.
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { T } from '../platform/stage';
import { createWorld, step, PH, type Pad, type World } from '../platform/sim';
import { moveOffset } from '../platform/things';
import { readStage } from './pack-io';

const dir = join(fileURLToPath(new URL('../packs/', import.meta.url)), 'etc', 'tutorial');
const stay: Pad = { m: 0, j: false };
let jn = 0;

function tickAs(w: World, pad: Pad, frames = 1) {
  for (let k = 0; k < frames; k++) { const pads = w.players.map(() => stay); pads[0] = pad; step(w, pads, 1 / 60); }
}
function walkTo(w: World, x: number, limit = 900) {
  const p = w.players[0];
  for (let k = 0; k < limit && Math.abs(p.x - x) > 2; k++) tickAs(w, { m: p.x < x ? 1 : -1, j: false, jn });
  tickAs(w, { m: 0, j: false, jn }, 4);
}
const press = (w: World) => { tickAs(w, { m: 0, j: false, a: true, jn }); tickAs(w, { m: 0, j: false, jn }, 3); };
const jump = (w: World, m: -1 | 0 | 1, frames: number) => { jn++; tickAs(w, { m, j: true, jn }, frames); tickAs(w, { m, j: false, jn }, 1); };
const land = (w: World, m: -1 | 0 | 1 = 0) => { for (let k = 0; k < 240 && !(w.players[0].on && w.players[0].vy === 0); k++) tickAs(w, { m, j: false, jn }); };

describe('연습 팩 03: 새 물건 써 보기', () => {
  it('씨앗 둘을 화분에 놓고, 용수철로 열쇠를 줍고, 구름을 타고 별을 모아 문에 들어간다', () => {
    const stage = readStage(dir, '03').stage;
    const w = createWorld(stage, [{ color: '#F4F7FF' }, { color: '#FFB3C7' }]);
    w.players[1].x = 2;                 // 둘째는 시작 자리 근처에 가만히(봇 하나로 길만 확인)
    tickAs(w, stay, 10);
    const p = w.players[0];
    // 1. 씨앗 둘을 화분으로
    for (const c of [11, 13]) {
      walkTo(w, c * T); press(w);
      expect(w.h.items.some(it => it.at === 2 && it.holder === 0)).toBe(true);
      walkTo(w, 15 * T + 18); press(w);
    }
    tickAs(w, stay, 3);
    expect(w.active.has('x')).toBe(true);
    // 2. 다리 건너 용수철로 튀어 올라 오른쪽 높은 곳의 열쇠
    walkTo(w, 21 * T);
    for (let k = 0; k < 200 && p.vy >= 0; k++) tickAs(w, { m: 1, j: false, jn });   // 용수철에 닿을 때까지 걷는다
    let top = 1e9;
    for (let k = 0; k < 120 && p.y + PH > 8 * T - 4; k++) { tickAs(w, { m: 0, j: false, jn }); top = Math.min(top, p.y + PH); }   // 높은 땅보다 위로 올라갈 때까지 곧게
    expect(top, '용수철이 높은 땅보다 높이 튕겨 올린다').toBeLessThan(8 * T);
    land(w, 1);
    expect(p.y + PH).toBeCloseTo(8 * T, 0);                                           // 높은 땅 위
    walkTo(w, 26 * T);
    expect(w.key.holder).toBe(0);
    // 3. 내려와서 가시를 뛰어넘는다
    walkTo(w, 29.1 * T); land(w);
    expect(p.y + PH).toBeCloseTo(13 * T, 0);
    walkTo(w, 28.6 * T);
    jump(w, 1, 14); for (let k = 0; k < 60 && p.x < 31 * T + 2; k++) tickAs(w, { m: 1, j: false, jn }); land(w);   // 가시를 넘으면 손을 뗀다(더 가면 구덩이)
    const cloud = stage.things.items.findIndex(it => stage.things.kinds[it.kind].id === 'cloud');
    const kind = stage.things.kinds[stage.things.items[cloud].kind];
    expect(p.x).toBeGreaterThan(30 * T + 10);
    // 4. 구름이 왼쪽 끝에 올 때 올라타 별 셋을 모은다(구름 위에서 별 밑마다 뛰어오른다)
    const cloudX = () => stage.things.items[cloud].x + moveOffset(kind, w.t)[0];
    walkTo(w, 31 * T);
    for (let k = 0; k < 600 && !(cloudX() < 31 * T + 4 && moveOffset(kind, w.t + 1 / 60)[0] > moveOffset(kind, w.t)[0]); k++) tickAs(w, stay);
    const steer = (): -1 | 0 | 1 => { const d = cloudX() + kind.w / 2 - (p.x + p.w / 2); return Math.abs(d) < 3 ? 0 : d > 0 ? 1 : -1; };   // 구름 가운데를 따라간다
    jn++; tickAs(w, { m: 0, j: true, jn }, 8);
    for (let k = 0; k < 240 && !(p.on && p.vy === 0); k++) tickAs(w, { m: steer(), j: false, jn });
    expect(p.y + PH).toBeLessThan(12 * T);                                            // 구름 위에 섰다
    // 구름 위에서 아직 안 모은 별 밑으로 가서 뛴다. 공중에서는 구름 가운데를 따라가 다시 구름에 내린다(구름은 계속 움직인다)
    const stars = stage.things.items.map((it, i) => ({ it, i })).filter(({ it }) => stage.things.kinds[it.kind].id === 'star');
    for (let k = 0; k < 60 * 30 && stars.some(({ i }) => w.h.items[i].at !== 1); k++) {
      const left = stars.filter(({ i }) => w.h.items[i].at !== 1).map(({ it }) => it.x + 9);
      const me = p.x + p.w / 2, edge = cloudX();
      const goal = left.reduce((a, b) => (Math.abs(b - me) < Math.abs(a - me) ? b : a));
      const target = Math.max(edge + p.w / 2 + 2, Math.min(edge + kind.w - p.w / 2 - 2, goal));
      if (!p.on) { tickAs(w, { m: steer(), j: false, jn }); continue; }
      if (Math.abs(goal - me) < 7) { jn++; tickAs(w, { m: 0, j: true, jn }, 10); continue; }
      const d = target - me;
      tickAs(w, { m: Math.abs(d) < 2 ? 0 : d > 0 ? 1 : -1, j: false, jn });
    }
    tickAs(w, stay, 3);
    expect(w.h.counts[1]).toBe(3);
    expect(w.active.has('y')).toBe(true);                                             // 별 문이 사라졌다
    // 5. 구름이 오른쪽 끝에서 문 쪽 땅으로 내려가 문을 열고 들어간다
    for (let k = 0; k < 240 && !(p.on && p.vy === 0); k++) tickAs(w, { m: steer(), j: false, jn });   // 마지막 별에서 구름으로 내린다
    for (let k = 0; k < 900 && cloudX() < 34 * T - 4; k++) tickAs(w, stay);
    for (let k = 0; k < 300 && p.x < 38 * T; k++) tickAs(w, { m: 1, j: false, jn });
    land(w);
    expect(w.doorOpen).toBe(true);
    tickAs(w, { m: 0, j: false, a: true, jn }, 2);
    expect(p.inDoor).toBe(true);
  });
});

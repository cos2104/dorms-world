/**
 * 그래프 공장: 장치 규칙과 스테이지 풀이 시험.
 * 봇은 식을 모르므로(scripts/bots), 스테이지마다 '의도한 식으로는 풀리고, 낮은 차수의 식이나 빈손으로는 안 풀린다'를 여기서 본다.
 */
import { describe, expect, it } from 'vitest';
import { cellX, dropAt, loadStage, makeWorld, plant, run, stamp, T } from './graph-help';
import { actionAt, hostOf, step, type Pad } from '../platform/sim';
import { FNOTE, HANDLE, fitOffset, makeShape, placeOrder, surfaceBelow } from '../platform/graph/model';
import { cleanOrder } from '../platform/graph/order';
import { applyGraphWire, graphToWire, readGWire } from '../platform/graph/wire';
import { applyWire, readWire, toWire } from '../platform/sync';
import { parseStage } from '../platform/stage';

const P = 'math/graph-factory';

describe('조각의 모양: 손잡이를 세워 들면 그 점의 접선이 수평이 된다', () => {
  it('꼭짓점에 단 손잡이는 돌리지 않는다(포물선이 위로 그대로 열린다)', () => {
    const s = makeShape({ latex: 'x^{2}', a: -2, b: 2, x0: 0 });
    if (typeof s === 'string') throw new Error(s);
    const pts = s.runs.flat();
    const mid = pts.reduce((m, p) => (Math.abs(p[0]) < Math.abs(m[0]) ? p : m));
    expect(mid[1]).toBeCloseTo(-HANDLE, 0);                     // 손잡이 위 끝이 지나는 점
    const ends = [pts[0], pts[pts.length - 1]];
    for (const e of ends) expect(e[1]).toBeLessThan(-HANDLE - 3 * T);   // 양 끝은 위로 4칸(돌리지 않음)
  });
  it('기울기 1인 점에 단 손잡이는 그래프를 45도 돌려 그 점의 접선을 수평으로 만든다', () => {
    const s = makeShape({ latex: '0.5x^{2}', a: 0, b: 2, x0: 1 });
    if (typeof s === 'string') throw new Error(s);
    const run = s.runs[0], i = run.findIndex(p => Math.abs(p[0]) < 2);
    const k = Math.max(1, Math.min(run.length - 2, i));
    const slope = (run[k + 1][1] - run[k - 1][1]) / (run[k + 1][0] - run[k - 1][0]);
    expect(Math.abs(slope)).toBeLessThan(0.08);
  });
  it('일차함수는 어느 점에 달아도 수평 막대가 된다(기울기는 손잡이가 없앤다)', () => {
    for (const lat of ['2x+1', '-0.5x', '3']) {
      const s = makeShape({ latex: lat, a: -1, b: 3, x0: 0 });
      if (typeof s === 'string') throw new Error(s);
      const ys = s.runs.flat().map(p => p[1]);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
    }
  });
  it('긴 그래프일수록 들 사람이 더 필요하다(혼자서도 천천히는 든다)', () => {
    const short = makeShape({ latex: '0', a: 0, b: 3, x0: 0 }), long = makeShape({ latex: '0', a: 0, b: 15, x0: 0 });
    if (typeof short === 'string' || typeof long === 'string') throw new Error('shape');
    expect(short.need).toBe(1); expect(long.need).toBe(3);
  });
  it('너무 큰 그래프, 끊긴 점, 범위 밖 점은 까닭과 함께 받지 않는다', () => {
    expect(makeShape({ latex: 'x^{3}', a: -8, b: 8, x0: 0 })).toMatch(/너무 커요/);
    expect(makeShape({ latex: '\\frac{1}{x}', a: -2, b: 2, x0: 0 })).toMatch(/끊겨/);
    expect(makeShape({ latex: 'x', a: 0, b: 2, x0: 5 })).toMatch(/범위 안/);
    expect(makeShape({ latex: 'x', a: 0, b: 20, x0: 1 })).toMatch(/16칸/);
  });
});

describe('공장: 찍는 방과 손잡이 방', () => {
  it('식을 넣고 점과 범위를 넣으면 출구에 조각이 나와 바닥에 내려앉는다', () => {
    const w = makeWorld(loadStage(P, '01'), 1);
    const pc = stamp(w, '0', 0, 3, 0);
    run(w, 2);
    expect(pc.state).toBe('free');
    const out = w.stage.graph.factories[0].out;
    expect(pc.x).toBeGreaterThan(out.x - 2 * T); expect(pc.x).toBeLessThan(out.x + out.w + 2 * T);
  });
  it('방 앞에 서 있지 않으면, 식이 없으면, 점이 그래프 위에 없으면 찍지 않는다', () => {
    const w = makeWorld(loadStage(P, '01'), 1), gs = w.stage.graph, p = w.players[0];
    p.x = 30 * T;
    expect(placeOrder(gs, w.g, hostOf(w), 0, { k: 'f', fac: 0, latex: 'x' })).toBe(FNOTE.far);
    const desk = gs.factories[0].desk[0]; p.x = desk.x + 4; p.y = desk.y + T - p.h;
    expect(placeOrder(gs, w.g, hostOf(w), 0, { k: 'h', fac: 0, x0: 0, y0: 0, a: -1, b: 1 })).toBe(FNOTE.noFormula);
    const press = gs.factories[0].press[0]; p.x = press.x + 4;
    placeOrder(gs, w.g, hostOf(w), 0, { k: 'f', fac: 0, latex: 'x^{2}' });
    p.x = desk.x + 4;
    expect(placeOrder(gs, w.g, hostOf(w), 0, { k: 'h', fac: 0, x0: 2, y0: 3, a: 0, b: 3 })).toMatch(/그래프 위에 있지 않아요/);
    expect(placeOrder(gs, w.g, hostOf(w), 0, { k: 'h', fac: 0, x0: 2, y0: 4, a: 0, b: 3 })).toBe(FNOTE.made);
  });
  it('식은 다시 쓴 수식으로만 남는다(사람이 친 글자가 그대로 다른 기기로 가지 않는다)', () => {
    const w = makeWorld(loadStage(P, '01'), 1), gs = w.stage.graph, p = w.players[0], press = gs.factories[0].press[0];
    p.x = press.x + 4; p.y = press.y + T - p.h;
    placeOrder(gs, w.g, hostOf(w), 0, { k: 'f', fac: 0, latex: '\\left(x\\right)^{2}\\,+\\;1' });
    expect(w.g.factories[0].latex).not.toMatch(/\\left|\\,|\\;/);
    expect(placeOrder(gs, w.g, hostOf(w), 0, { k: 'f', fac: 0, latex: '\\href{javascript:alert(1)}{x}' })).not.toBe(FNOTE.set);
  });
  it('주문의 모양 검사: 모르는 칸·범위 밖 수·긴 식은 버린다', () => {
    expect(cleanOrder({ k: 'f', fac: 0, latex: 'x' })).toEqual({ k: 'f', fac: 0, latex: 'x' });
    expect(cleanOrder({ k: 'f', fac: 0, latex: 'x'.repeat(161) })).toBeNull();
    expect(cleanOrder({ k: 'h', fac: 0, x0: 0, y0: 0, a: -1, b: Infinity })).toBeNull();
    expect(cleanOrder({ k: 'h', fac: 9, x0: 0, y0: 0, a: -1, b: 1 })).toBeNull();
    expect(cleanOrder({ k: 'z', fac: 0 })).toBeNull();
  });
});

describe('들고 놓기: 실제 조작으로', () => {
  const press = (w: ReturnType<typeof makeWorld>, i: number, frames = 2) => { for (let f = 0; f < frames; f++) step(w, w.players.map((_, k) => (k === i ? { m: 0, j: false, a: f === 0 } : undefined)), 1 / 60); };
  it('손잡이 끝에 다가가 확인을 누르면 들고, 걸으면 따라오고, 다시 누르면 놓아 떨어진다', () => {
    const w = makeWorld(loadStage(P, '02'), 1);
    const pc = stamp(w, '0', 0, 3, 0);
    run(w, 2);
    const p = w.players[0]; p.x = pc.x - p.w / 2; p.y = 390 - p.h; run(w, 0.2);
    expect(actionAt(w, p)?.do).toBe('grab');
    press(w, 0);
    expect(pc.state).toBe('held');
    run(w, 0.5, () => ({ m: 1, j: false }));
    expect(Math.abs(pc.x - (p.x + p.w / 2))).toBeLessThan(1);
    expect(pc.y).toBeLessThan(p.y);
    press(w, 0);
    expect(pc.state).toBe('fall');
    run(w, 1.5);
    expect(pc.state).toBe('free');
  });
  it('함께 들면 무거운 그래프도 제 빠르기로 옮긴다(혼자면 느리다)', () => {
    const speed = (people: number) => {
      const w = makeWorld(loadStage(P, '02'), people);
      const pc = stamp(w, '0', -6, 6, 0); run(w, 2);
      w.players.forEach((p, i) => { p.x = pc.x - p.w / 2 + (i ? 26 : 0); p.y = 390 - p.h; });
      pc.state = 'held'; pc.holders = w.players.map((_, i) => i);
      const x0 = w.players[0].x;
      run(w, 0.5, () => ({ m: -1, j: false }));
      return x0 - w.players[0].x;
    };
    expect(speed(3)).toBeGreaterThan(speed(1) * 1.5);
  });
  it('거치대 앞에서 확인을 누르면 꽂히고, 꽂힌 조각은 그 자리에 서 있다', () => {
    const w = makeWorld(loadStage(P, '04'), 1);
    const pc = stamp(w, '0.08x^{2}', -5, 11, 0); run(w, 2);
    const st = w.stage.graph.stands[0], p = w.players[0];
    p.x = st.x + 4; p.y = st.y + T - p.h; pc.state = 'held'; pc.holders = [0];
    run(w, 0.1);
    expect(actionAt(w, p)?.do).toBe('plant');
    press(w, 0);
    expect(pc.state).toBe('planted');
    run(w, 1);
    expect(pc.x).toBe(st.x + st.w / 2);
  });
  it('놓인 그래프 위를 걸어 다닌다(위에서만 딛고, 밑에서는 뛰어 지나간다)', () => {
    const w = makeWorld(loadStage(P, '02'), 1);
    const pc = stamp(w, '0', 0, 11, 0);
    dropAt(w, pc, 15 * T + 15, 330); run(w, 2);
    const p = w.players[0]; p.x = 14 * T; p.y = 390 - p.h;
    run(w, 6, (_, t) => ({ m: 1, j: t > 0.05 && t < 0.12, jn: t > 0.05 ? 1 : 0 }));
    expect(p.x).toBeGreaterThan(30 * T);
    expect(p.y + p.h).toBeLessThan(11 * T + 1);
  });
});

describe('요약: 손님 화면도 같은 조각·공·썰매를 본다', () => {
  it('방장 요약을 덮어쓴 손님 세계가 같은 요약을 낸다', () => {
    const st = loadStage(P, '05');
    const host = makeWorld(st, 3, 4), guest = makeWorld(st, 3, 4);
    const pc = stamp(host, '0.06x^{2}', -7, 7, 0); plant(host, pc, 0);
    const bell = st.graph.bells[0], p = host.players[1]; p.x = bell.x + 4; p.y = bell.y + T - p.h;
    run(host, 0.05, i => (i === 1 ? { m: 0, j: false, a: true } : undefined));
    run(host, 6);
    const wire = toWire(host, [0, 1, 2], 1, 9);
    const back = readWire(JSON.parse(JSON.stringify(wire)));
    expect(back).not.toBeNull();
    expect(applyWire(guest, back!)).toBe(true);
    expect(JSON.stringify(toWire(guest, [0, 1, 2], 1, 9).g)).toBe(JSON.stringify(wire.g));
  });
  it('이상한 식이 실린 조각은 그 조각만 버리고 요약은 쓴다(방 전체가 멈추지 않게)', () => {
    const st = loadStage(P, '01');
    const host = makeWorld(st, 1), guest = makeWorld(st, 1);
    stamp(host, '0', 0, 3, 0);
    const g = graphToWire(host.g);
    g.p.push([99, 0, 'x'.repeat(500), 0, 1, 0, 1, 10, 10, 0, 0, []]);
    g.f[0][0] = '\\href{javascript:alert(1)}{x}';
    const r = readGWire(JSON.parse(JSON.stringify(g)));
    expect(r).not.toBeNull();
    expect(applyGraphWire(st.graph, guest.g, r!, 1, 1440, 450)).toBe(true);
    expect(guest.g.pieces.map(q => q.id)).toEqual([1]);
    expect(guest.g.factories[0].latex).toBe('');
  });
});

describe('스테이지 형식 검사', () => {
  const FLAT = '....................\n'.repeat(11) + '.@.p.q.ooo.......KD.\n' + '####################\n';
  const L = { p: { type: 'press' }, q: { type: 'desk' }, o: { type: 'out' } };
  it('공장의 세 칸이 다 있어야 한다', () => {
    expect(() => parseStage(FLAT, { legend: L as never })).not.toThrow();
    expect(() => parseStage(FLAT.replace('q', '.'), { legend: { p: L.p, o: L.o } as never })).toThrow(/손잡이 방/);
  });
  it('꽃이 있으면 종과 벌집이 있어야 하고, 홈 식이 이상하면 받지 않는다', () => {
    const m = FLAT.replace('......KD.', 'h.....KD.');
    expect(() => parseStage(m, { legend: { ...L, h: { type: 'flower', opens: ['x'] }, x: { type: 'bridge' } } as never })).toThrow();
    const s = FLAT.replace('.@.', '.@k');
    expect(() => parseStage(s, { legend: { ...L, k: { type: 'slot', latex: 'y+1', opens: ['x'] }, x: { type: 'bridge' } } as never })).toThrow(/홈/);
  });
});

// ---------- 스테이지 풀이 ----------
const bell = (w: ReturnType<typeof makeWorld>, i: number) => {
  const b = w.stage.graph.bells[0], p = w.players[i]; p.x = b.x + 4; p.y = b.y + T - p.h;
  run(w, 0.05, k => (k === i ? { m: 0, j: false, a: true } : undefined));
};

describe('01 패인 길 메우기: 홈 너비만큼의 그래프', () => {
  it('너비가 꼭 맞는 그래프를 넣으면 다리가 놓인다', () => {
    const w = makeWorld(loadStage(P, '01'), 1);
    dropAt(w, stamp(w, '0', 0, 3, 0), 15 * T, 300); run(w, 2);
    dropAt(w, stamp(w, '0', 0, 5, 0), 29 * T, 300); run(w, 2);
    expect(w.g.done).toEqual([true, true]);
    expect([...w.active].sort()).toEqual(['x', 'y']);
  });
  it('짧거나 긴 그래프로는 안 열린다', () => {
    for (const [a, b] of [[0, 2], [0, 4.5]]) {
      const w = makeWorld(loadStage(P, '01'), 1);
      dropAt(w, stamp(w, '0', a, b, 0), 15 * T, 300); run(w, 2);
      expect(w.g.done[0], `${a}~${b}`).toBe(false);
    }
  });
});

describe('02 그래프 다리: 손잡이를 끝에 단 긴 그래프', () => {
  const cross = (lat: string, a: number, b: number, x0: number) => {
    const w = makeWorld(loadStage(P, '02'), 1);
    dropAt(w, stamp(w, lat, a, b, x0), 15 * T + 15, 330); run(w, 2);
    const p = w.players[0]; p.x = 14 * T; p.y = 390 - p.h;
    run(w, 6, (_, t) => ({ m: 1, j: t > 0.05 && t < 0.12, jn: t > 0.05 ? 1 : 0 }));
    return p.x > 30 * T;
  };
  it('끝에 손잡이를 단 11칸 그래프로 건넌다', () => expect(cross('0', 0, 11, 0)).toBe(true));
  it('가운데에 단 같은 그래프로는 못 건넌다', () => expect(cross('0', -5.5, 5.5, 0)).toBe(false));
});

describe('03 파란 공 담기: 그릇 모양이어야 공이 실려 간다', () => {
  const trip = (lat: string, seed: number) => {
    const w = makeWorld(loadStage(P, '03'), 1, seed);
    const pc = stamp(w, lat, -2, 2, 0), p = w.players[0];
    for (let k = 0; k < 6 && !w.g.done[0]; k++) {
      p.x = 22 * T + 4; p.y = 390 - p.h; p.vx = 0; pc.state = 'held'; pc.holders = [0]; pc.x = p.x + p.w / 2; pc.y = p.y - 3;
      run(w, 8);
      run(w, 8, () => ({ m: 1, j: false }), ww => ww.players[0].x > 38.5 * T);
      run(w, 0.05, () => ({ m: 0, j: false, a: true })); run(w, 1.5);
    }
    return w.g.done[0];
  };
  it('그릇(아래로 볼록)으로 여러 번 나르면 바구니가 찬다', () => expect([1, 2, 3].some(s => trip('0.5x^{2}', s))).toBe(true));
  it('평평한 그래프로는 걷는 동안 공이 다 흘러 안 찬다', () => expect([1, 2, 3].some(s => trip('0', s))).toBe(false));
});

describe('04 썰매 길: 골짜기 모양 그래프', () => {
  const ride = (lat: string, a = -5, b = 11) => {
    const w = makeWorld(loadStage(P, '04'), 2);
    plant(w, stamp(w, lat, a, b, 0), 0);
    const s = w.g.sled!, p = w.players[0]; p.x = s.x - 11; p.y = s.y - p.h;
    run(w, 0.05, i => (i === 0 ? { m: 0, j: false, a: true } : undefined));
    run(w, 26, undefined, ww => ww.g.done[0]);
    return w.g.done[0];
  };
  it('아래로 볼록한 이차함수(0.06~0.09)로 A B C 를 차례로 지난다', () => { for (const k of ['0.06', '0.08', '0.09']) expect(ride(`${k}x^{2}`), k).toBe(true); });
  it('일차함수, 위로 볼록, 너무 가파른 그래프로는 못 지난다', () => { for (const k of ['0', '-0.08x^{2}', '0.14x^{2}']) expect(ride(k), k).toBe(false); });
});

describe('05 비 새는 집: 꼭짓점 한 곳으로 모으는 그릇과 양동이', () => {
  const house = (lat: string, seed: number, trip = 4.5) => {
    const st = loadStage(P, '05'), w = makeWorld(st, 2, seed);
    if (lat) plant(w, stamp(w, lat, -7, 7, 0), 0);
    const bk = w.g.bucket!, stx = st.graph.stands[0].x + 15; bk.x = stx;
    bell(w, 1);
    let away = 0;
    for (let k = 0; k < 400 && !w.g.done[0] && w.g.round.on; k++) {
      run(w, 0.1);
      if (away > 0) { away -= 0.1; if (away <= 0) { bk.water = 0; bk.x = stx; } else bk.x = st.graph.drains[0].x + 15; }
      else if (bk.water >= 12) away = trip;
    }
    return w.g.done[0];
  };
  it('그릇을 거치대에 꽂고 양동이를 꼭짓점 밑에 두면 혼자서도 버틴다', () => { for (const s of [1, 2, 3]) expect(house('0.06x^{2}', s), String(s)).toBe(true); });
  it('평평한 그래프나 빈손으로는 집이 잠긴다', () => { for (const s of [1, 2]) { expect(house('0', s)).toBe(false); expect(house('', s)).toBe(false); } });
});

describe('06 벌 떼 막기: 양옆까지 감싸는 위로 볼록한 그래프 두 개', () => {
  const guard = (planted: string, held: string, seed: number) => {
    const st = loadStage(P, '06'), w = makeWorld(st, 2, seed);
    if (planted) plant(w, stamp(w, planted, -3, 3, 0), 0);
    const fl = (st.graph.goals[1] as { rect: { x: number } }).rect, p0 = w.players[0];
    if (held) { const pc = stamp(w, held, -3, 3, 0); p0.x = fl.x + 4; p0.y = 390 - p0.h; pc.state = 'held'; pc.holders = [0]; }
    bell(w, 1);
    run(w, 34, undefined, ww => ww.g.done[0] || !ww.g.round.on);
    return w.g.done[0] && w.g.done[1];
  };
  it('위로 볼록한 그래프 하나는 꽂고 하나는 들고 지키면 버틴다', () => { for (const s of [1, 2, 3]) expect(guard('-0.35x^{2}', '-0.35x^{2}', s)).toBe(true); });
  it('절댓값 모양도 된다', () => expect(guard('-\\left|x\\right|', '-\\left|x\\right|', 1)).toBe(true));
  it('평평한 그래프로는 옆에서 오는 벌에 뚫린다', () => { for (const s of [1, 2]) expect(guard('-0.35x^{2}', '0', s)).toBe(false); });
});

describe('07 자물쇠 홈: 코사인 모양', () => {
  const lock = (lat: string, a: number, b: number, x0 = 0) => {
    const w = makeWorld(loadStage(P, '07'), 1);
    plant(w, stamp(w, lat, a, b, x0), 0); run(w, 1.5);
    return w.g.done[0];
  };
  it('cos x 를 꼭대기에 손잡이를 달아 꽂으면 열린다(범위가 조금 달라도 된다)', () => {
    expect(lock('\\cos(x)', -3.14, 3.14)).toBe(true);
    expect(lock('\\cos(x)', -3, 3)).toBe(true);
    expect(lock('\\sin(x)', -1.57, 4.71, 1.5708)).toBe(true);
  });
  it('포물선·절댓값·일차함수로는, 손잡이를 엉뚱한 점에 달면 안 열린다', () => {
    for (const [lat, a, b, x0] of [['1-0.2x^{2}', -3.14, 3.14, 0], ['1-0.6\\left|x\\right|', -3.14, 3.14, 0], ['0', -3.14, 3.14, 0], ['\\cos(x)', -3.14, 3.14, 1]] as const)
      expect(lock(lat, a, b, x0), lat).toBe(false);
  });
});

describe('08 맞물려 쌓는 탑', () => {
  const tower = (pieces: [string, number, number][]) => {
    const w = makeWorld(loadStage(P, '08'), 1);
    for (const [lat, a, b] of pieces) { dropAt(w, stamp(w, lat, a, b, 0), 885, 120); run(w, 2.5); }
    return surfaceBelow(w.g, 945, 985, 0, 999) ?? 999;
  };
  it('위로 볼록 위에 아래로 볼록을 맞물리면 절벽에 뛰어오를 높이가 된다', () => expect(tower([['-0.5x^{2}', -3, 3], ['0.5x^{2}', -2.5, 2.5]])).toBeLessThanOrEqual(228));
  it('평평한 그래프는 세 장을 쌓아도 모자란다', () => expect(tower([['0', -3, 3], ['0', -3, 3], ['0', -3, 3]])).toBeGreaterThan(228));
  it('맞물린 그래프 끝에 서서 뛰면 절벽 위에 오른다', () => {
    const w = makeWorld(loadStage(P, '08'), 1);
    dropAt(w, stamp(w, '-0.5x^{2}', -3, 3, 0), 885, 120); run(w, 2.5);
    dropAt(w, stamp(w, '0.5x^{2}', -2.5, 2.5, 0), 885, 120); run(w, 2.5);
    const p = w.players[0], x = 925, top = surfaceBelow(w.g, x, x + p.w, 0, 999)!;
    p.x = x; p.y = top - p.h; p.vx = p.vy = 0; p.on = true; p.onCurve = true;
    run(w, 0.2);
    run(w, 2, (_, t) => ({ m: 1, j: t < 0.3, jn: 1 }), ww => ww.players[0].x > 34 * T);
    expect(p.y + p.h).toBeLessThanOrEqual(121);
    expect(p.x).toBeGreaterThan(33 * T);
  });
});

describe('그래프 장치가 있는 스테이지도 아무렇게나 누르면 깨지지 않는다', () => {
  it.each(['01', '02', '03', '04', '05', '06', '07', '08'])('%s', file => {
    let seed = 5; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const w = makeWorld(loadStage(P, file), 4, 3);
    let pads: Pad[] = [];
    for (let f = 0; f < 40 * 60 && !w.won; f++) {
      if (f % 20 === 0) pads = w.players.map(() => ({ m: ([-1, 0, 1, 1] as const)[Math.floor(rnd() * 4)], j: rnd() < 0.4, a: rnd() < 0.5 }));
      step(w, pads, 1 / 60);
    }
    expect(w.won).toBe(false);
    void cellX; void fitOffset;
  });
});

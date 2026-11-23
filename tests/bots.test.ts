/**
 * '깰 수 있는지' 봇(scripts/bots)이 못 깨는 스테이지를 깼다고 하지 않고, 막힌 곳을 쉬운 말로 알려 주는지 본다.
 * 팩의 스테이지를 실제로 깨 보는 검사는 packs.test.ts 에 있다.
 */
import { describe, expect, it } from 'vitest';
import { parseStage } from '../platform/stage';
import { peopleFor, playStage } from '../scripts/bots/engine';

const rows = (lines: string[]) => lines.map(l => l.padEnd(30, '.')).join('\n');
const GROUND = ['#'.repeat(30), '#'.repeat(30), '#'.repeat(30)];

// 문이 땅에서 다섯 칸(150px) 위 턱에 있다. 친구 한 명 머리를 딛어도(104+38px) 못 오르고, 둘을 쌓으면 오른다.
const HIGH_LEDGE = rows([
  '', '',
  '.'.repeat(24), '.'.repeat(24), '.'.repeat(26) + 'D...',
  '.'.repeat(24) + '######', '.'.repeat(24) + '######', '.'.repeat(24) + '######', '.'.repeat(24) + '######',
  '.@........K.............######',
  ...GROUND,
]);

// 여섯 칸 구덩이를 건너려면 단추를 밟아 다리를 놓아야 한다. 단추는 양쪽에 하나씩(마지막 사람이 건너오게).
// 단추 a 에 5명이 서야 하면, 한 칸짜리 단추에는 2명까지만 서므로 못 깬다.
const NARROW = rows([
  '', '', '', '', '', '', '', '', '',
  '.@....a.............b....K.D..',
  '############xxxxxx############',
  '############......############',
  '############......############',
]);
const narrow = (need: number) => parseStage(NARROW, { legend: { a: { type: 'button', need, opens: ['x'] }, b: { type: 'button', need, opens: ['x'] }, x: { type: 'bridge' } } });

// 봇은 판을 실제로 수백 걸음 굴린다. 맥에서 1초 안이지만 그래픽 없는 윈도우 러너는 5초를 넘기기도 해서(판정과 무관한 시간 초과) 시간 한도를 넉넉히 둔다
describe('봇이 못 깨면 그렇다고 알려 준다', { timeout: 30_000 }, () => {
  it('2명: 문이 너무 높은 턱 위에 있으면 막혔다고 하고, 어디서 막혔는지 말한다', () => {
    const r = playStage(parseStage(HIGH_LEDGE), 2);
    expect(r.verdict).toBe('stuck');
    expect(r.note).toContain('2명');
    expect(r.note).toContain('열쇠는 주웠지만 문을 열지 못했어요');
  });

  it('8명: 친구 둘 이상을 쌓아야 닿는 자리면 통과·실패로 꾸미지 않고 "확인 못 함"으로 알린다', () => {
    const r = playStage(parseStage(HIGH_LEDGE), 8);
    expect(r.verdict).toBe('unknown');
    expect(r.note).toContain('친구 둘 이상을 쌓아야');
  });

  it('단추에 설 자리가 모자라면 그 단추 이름과 함께 알려 준다', () => {
    const r = playStage(narrow(5), 8);
    expect(r.verdict).toBe('stuck');
    expect(r.note).toContain("단추 'a'");
    expect(r.note).toContain('설 자리');
  });

  it('필요한 사람이 설 수 있으면 같은 지도를 깬다', () => {
    for (const n of [2, 8]) { const r = playStage(narrow(1), n); expect(r.verdict, r.note).toBe('pass'); }
  });

  it('단추를 지키던 마지막 사람이 건너올 수 없으면 못 깬다고 하고, 건너편에도 단추가 있어야 한다고 알려 준다', () => {
    const one = parseStage(NARROW.replace('b', '.'), { legend: { a: { type: 'button', need: 1, opens: ['x'] }, x: { type: 'bridge' } } });
    const r = playStage(one, 2);
    expect(r.verdict, r.note).toBe('stuck');
    expect(r.note).toContain('문은 열었지만');
    expect(r.note).toContain("단추 'a' 위의 도름이가 떠나면 길이 끊겨요");
  });

  it('확인할 인원은 팩의 가장 적은 인원, 8명, 가장 많은 인원이다', () => {
    expect(peopleFor({ min: 2, max: 30 })).toEqual([2, 8, 30]);
    expect(peopleFor({ min: 3, max: 6 })).toEqual([3, 6]);
    expect(peopleFor({ min: 10, max: 30 })).toEqual([10, 30]);
  });
});

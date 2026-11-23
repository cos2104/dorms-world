/** 짧은 글 하나로 수식 해석기가 멈추지 않는지(방장 판이 멈추면 방 전체가 멈춘다). */
import { describe, expect, it } from 'vitest';
import { readFormula } from '../platform/graph/expr';

const evil = [
  '-'.repeat(158) + 'x', '+'.repeat(60) + 'x', '|'.repeat(60) + 'x', '-('.repeat(30) + 'x', '\\sin('.repeat(30) + 'x',
  '-x'.repeat(70), '-(-('.repeat(15) + 'x', '\\left|'.repeat(20) + 'x', '-\\cdot'.repeat(25) + 'x', '\\pm'.repeat(40) + 'x',
  '\\sin\\sin'.repeat(18) + 'x', 'x^{'.repeat(30) + 'x' + '}'.repeat(30), '\\frac{'.repeat(15) + '1}{2}'.repeat(15),
  '-|x'.repeat(40), '\\vert'.repeat(30) + 'x', '\\lvert'.repeat(25) + 'x', '-{}'.repeat(50) + 'x', '{-}'.repeat(50) + 'x', '-~'.repeat(70) + 'x',
  '\\mid'.repeat(35) + 'x', '\\|'.repeat(60) + 'x', '-\\,'.repeat(50) + 'x', '-\\quad'.repeat(25) + 'x', '\\times'.repeat(25) + 'x', '/'.repeat(150) + 'x', '^'.repeat(150) + 'x', '!'.repeat(150) + 'x', '*'.repeat(150) + 'x', '\\cdot'.repeat(30) + 'x', '\\left(-'.repeat(20) + 'x', '(-'.repeat(30) + 'x' + ')'.repeat(30), '2'.repeat(158), '\\sqrt{'.repeat(30) + 'x' + '}'.repeat(30),
];

describe('수식 해석 시간 상한', () => {
  for (const s of evil) {
    it(`${JSON.stringify(s.slice(0, 24))}… 는 금방 끝난다`, () => {
      const t = performance.now();
      readFormula(s.slice(0, 160));
      expect(performance.now() - t).toBeLessThan(400);
    });
  }
  it('보통 식은 그대로 읽힌다', () => {
    for (const s of ['-x', 'x-\\left(-x\\right)', '\\left|x\\right|-\\left|x-2\\right|', '\\sin\\left(x\\right)+\\cos\\left(2x\\right)', '-\\frac{x^{2}}{4}+3', '0.5x^{2}-x+1'])
      expect(readFormula(s).ok, s).toBe(true);
  });
});

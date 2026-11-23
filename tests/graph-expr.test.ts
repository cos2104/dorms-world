import { describe, expect, it } from 'vitest';
import { LATEX_MAX, canonLatex, readFormula, sampleRuns, slopeAt, type Formula } from '../platform/graph/expr';

function ok(latex: string): Formula {
  const r = readFormula(latex);
  if (!r.ok) throw new Error(`${latex} 거절됨: ${r.reason}`);
  return r.formula;
}
function reason(latex: string): string {
  const r = readFormula(latex);
  if (r.ok) throw new Error(`${latex} 통과됨`);
  return r.reason;
}

const XS = [-2.5, -1, -0.3, 0.5, 1, 2, 3.7];

const CASES: [string, (x: number) => number][] = [
  ['2x', (x) => 2 * x],
  ['x(x-3)', (x) => x * (x - 3)],
  ['2\\sin x', (x) => 2 * Math.sin(x)],
  ['\\sin(2x)', (x) => Math.sin(2 * x)],
  ['\\frac{1}{2}x^2', (x) => 0.5 * x * x],
  ['|x|', (x) => Math.abs(x)],
  ['\\left|x\\right|', (x) => Math.abs(x)],
  ['\\sqrt{x}', (x) => Math.sqrt(x)],
  ['x^{3}-2x', (x) => x ** 3 - 2 * x],
  ['e^{x}', (x) => Math.exp(x)],
  ['\\cos\\left(x-1\\right)+4', (x) => Math.cos(x - 1) + 4],
  ['-0.5x+2', (x) => -0.5 * x + 2],
  ['\\ln x', (x) => Math.log(x)],
  ['\\tan x', (x) => Math.tan(x)],
  ['x²−3', (x) => x * x - 3],
  ['2X+1', (x) => 2 * x + 1],
  ['\\pi x', (x) => Math.PI * x],
  ['\\sqrt[3]{x}', (x) => Math.cbrt(x)],
  ['\\log_2 x', (x) => Math.log2(x)],
  ['\\log x', (x) => Math.log10(x)],
  ['\\exp(x)', (x) => Math.exp(x)],
  ['\\lfloor x\\rfloor', (x) => Math.floor(x)],
  ['\\max(x,1)', (x) => Math.max(x, 1)],
  ['\\frac{x}{2}+\\frac{1}{x}', (x) => x / 2 + 1 / x],
  ['x^{-1}', (x) => 1 / x],
  ['-x^2', (x) => -(x * x)],
  ['\\sin x\\cos x', (x) => Math.sin(x) * Math.cos(x)],
  ['x\\cdot 2', (x) => 2 * x],
  ['3\\times x', (x) => 3 * x],
  ['(x+1)^2', (x) => (x + 1) ** 2],
  ['\\operatorname{sgn}(x)', (x) => Math.sign(x)],
  ['2^{x}', (x) => 2 ** x],
  ['\\sec x', (x) => 1 / Math.cos(x)],
  ['x^{\\frac{1}{3}}', (x) => Math.cbrt(x)],
  ['x+\\placeholder{}1', (x) => x + 1],
];

function same(a: number, b: number) {
  if (Number.isNaN(b) || !Number.isFinite(b)) expect(a).toBeNaN();
  else expect(a).toBeCloseTo(b, 9);
}

describe('readFormula 계산', () => {
  for (const [latex, ref] of CASES) {
    it(latex, () => {
      const f = ok(latex);
      for (const x of XS) same(f.f(x), ref(x));
    });
  }
  it('정의되지 않는 값은 NaN', () => {
    expect(ok('\\frac{1}{x}').f(0)).toBeNaN();
    expect(ok('\\sqrt{x}').f(-1)).toBeNaN();
    expect(ok('\\ln x').f(0)).toBeNaN();
  });
  it('큰 지수도 멈추지 않는다', () => {
    expect(ok('x^{1000000}').f(2)).toBeNaN();
    expect(ok('x^{1000000}').f(1.0001)).toBeCloseTo(Math.pow(1.0001, 1e6) / 1, -40);
    expect(ok('e^{x^{x^{x}}}').f(3)).toBeNaN();
  });
});

describe('readFormula 거절', () => {
  it('빈 식', () => {
    expect(reason('')).toBe('식을 써 주세요');
    expect(reason('   ')).toBe('식을 써 주세요');
    expect(reason('\\placeholder{}')).toBe('식을 써 주세요');
  });
  it('너무 긴 식', () => {
    expect(reason('x+'.repeat(LATEX_MAX))).toBe('식이 너무 길어요');
  });
  it('x 말고 다른 글자', () => {
    expect(reason('y')).toBe('쓸 수 없는 글자가 있어요: y');
    expect(reason('2x+a')).toBe('쓸 수 없는 글자가 있어요: a');
  });
  it('모르는 함수·명령', () => {
    expect(reason('\\operatorname{foo}(x)')).toBe('쓸 수 없는 기호예요');
    expect(reason('\\text{hi}')).toBe('쓸 수 없는 기호예요');
    expect(reason('x!')).toBe('쓸 수 없는 기호예요');
    expect(reason('\\infty')).toBe('쓸 수 없는 기호예요');
    expect(reason('x_1')).toBe('쓸 수 없는 기호예요');
    expect(reason('\\Pi')).toBe('쓸 수 없는 기호예요');
  });
  it('덜 끝난 식', () => {
    const inc = '식이 아직 덜 끝났어요. 끝에 남은 기호나 괄호를 확인해 주세요';
    for (const s of ['x+', 'x\\cdot', '(x', 'x)', '\\sqrt{x', '\\frac{1}{}', '\\sqrt{}', 'x+\\placeholder{}']) {
      expect(reason(s), s).toBe(inc);
    }
  });
  it('너무 깊은 식', () => {
    expect(reason('x^{'.repeat(39) + 'x' + '}'.repeat(39))).toBe('식이 너무 복잡해요');
    expect(reason('-('.repeat(50) + 'x' + ')'.repeat(50))).toBe('식이 너무 복잡해요');
  });
  it('이유 문장은 입력을 길게 되풀이하지 않고 긴 줄표가 없다', () => {
    for (const s of ['y', 'abcdefghijklmnop', '\\text{javascriptalertxxxx}', 'x+']) {
      const r = readFormula(s);
      if (!r.ok) {
        expect(r.reason).not.toMatch(/—/);
        expect(r.reason.length).toBeLessThan(50);
      }
    }
  });
  it('수상한 입력은 빨리 거절한다', () => {
    const inputs = ['\\href{javascript:alert(1)}{x}', 'x\\\\\\\\'.repeat(10000), '{'.repeat(150), '\\sqrt{'.repeat(26) + 'x' + '}'.repeat(26)];
    for (const s of inputs) {
      readFormula('x'); // 엔진 준비 시간은 빼고 잰다
      const t = performance.now();
      const r = readFormula(s);
      expect(performance.now() - t, s.slice(0, 20)).toBeLessThan(50);
      if (s !== inputs[3]) expect(r.ok).toBe(false);
    }
  });
});

describe('sampleRuns', () => {
  it('tan x 는 점근선에서 끊긴다', () => {
    const runs = sampleRuns(ok('\\tan x'), -3, 3);
    expect(runs.length).toBe(3);
    for (const run of runs) {
      for (let i = 1; i < run.length; i++) expect(Math.abs(run[i][1] - run[i - 1][1])).toBeLessThanOrEqual(8);
    }
  });
  it('1/x 는 0 근처에서 끊긴다', () => {
    const runs = sampleRuns(ok('\\frac{1}{x}'), -2, 2);
    expect(runs.length).toBe(2);
    expect(runs[0].every(([x]) => x < 0)).toBe(true);
    expect(runs[1].every(([x]) => x > 0)).toBe(true);
  });
  it('직선은 한 줄, 끝점 포함, 간격 0.05', () => {
    const runs = sampleRuns(ok('2x+1'), -1, 1);
    expect(runs.length).toBe(1);
    expect(runs[0].length).toBe(41);
    expect(runs[0][0]).toEqual([-1, -1]);
    expect(runs[0][40][0]).toBeCloseTo(1, 9);
  });
  it('|y| > 60 은 뺀다', () => {
    const runs = sampleRuns(ok('x^2'), -10, 10);
    expect(runs.length).toBe(1);
    expect(runs[0].every(([, y]) => y <= 60)).toBe(true);
  });
  it('점은 1200개를 넘지 않는다', () => {
    const runs = sampleRuns(ok('\\sin x'), -1000, 1000);
    expect(runs.flat().length).toBeLessThanOrEqual(1200);
    const tiny = sampleRuns(ok('x'), 0, 10, 0.0001);
    expect(tiny.flat().length).toBeLessThanOrEqual(1200);
  });
});

describe('slopeAt', () => {
  it('미분값', () => {
    expect(slopeAt(ok('x^2'), 3)).toBeCloseTo(6, 4);
    expect(slopeAt(ok('\\sin x'), 0)).toBeCloseTo(1, 4);
    expect(slopeAt(ok('\\sqrt{x}'), 0)).toBeNaN();
  });
});

describe('canonLatex', () => {
  for (const [latex] of CASES) {
    it(`되읽기: ${latex}`, () => {
      const f = ok(latex);
      const c = canonLatex(f);
      const g = ok(c);
      for (const x of XS) {
        const a = f.f(x);
        const b = g.f(x);
        if (Number.isNaN(a)) expect(b).toBeNaN();
        else expect(b).toBeCloseTo(a, 9);
      }
      expect(canonLatex(g)).toBe(c);
    });
  }
  it('수식이 아닌 글은 남지 않는다', () => {
    const c = canonLatex(ok('2x+\\frac{1}{2}'));
    expect(c).toMatch(/^[0-9x+\-\\{}()^.,|a-z \[\]]*$/);
    expect(canonLatex(ok('-2x+-3x-x'))).not.toMatch(/\+-/);
  });
});

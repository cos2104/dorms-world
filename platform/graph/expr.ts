// 그래프 공장: 학생이 쓴 식 y = f(x) 를 안전하게 읽어 곡선으로 바꾼다.
//
// Compute Engine 은 LaTeX 를 MathJSON 으로 바꾸는 데만 쓴다. 사이트 CSP 에 'unsafe-eval' 이 없으니
// compile()·문자열 실행 계열은 쓰지 않고, 허용한 머리(head)만 담은 작은 나무를 직접 계산한다.
//
// parse 는 canonical:false 로 부른다. canonical:true 는 x^{x^{...}} 같은 깊은 거듭제곱에서
// 정규화가 끝나지 않는다(실측: 39단 2분 넘게 멈춤). canonical:false 는 같은 입력을 몇 ms 에 끝낸다.
// 대신 그 모양(InvisibleOperator·Delimiter·Divide·Negate 숫자 등)을 여기서 직접 다룬다.

import { ComputeEngine } from '@cortex-js/compute-engine';

export const LATEX_MAX = 160;
const NODE_MAX = 200;
const DEPTH_MAX = 32;
// Math.pow 는 지수가 커도 바로 끝난다. 잘라 두는 범위는 계산 결과를 바꾸지 않을 만큼 넓게.
const EXP_CLAMP = 1e9;

export type Formula = { latex: string; f: (x: number) => number };

// ---------- 정규화 (MathLive 방언 차이만 맞춘다. 식의 뜻은 바꾸지 않는다) ----------

const SUPERSCRIPT: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁽': '(', '⁾': ')',
};

export function sanitizeMathLiveLatex(latex: string): string {
  return latex
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾]+/g, (seq) => `^{${[...seq].map((c) => SUPERSCRIPT[c] ?? c).join('')}}`)
    .replace(/[−–]/g, '-')
    .replace(/×/g, '\\times ')
    .replace(/[·⋅]/g, '\\cdot ')
    .replace(/π/g, '\\pi ')
    .replace(/\\m?(?:left|right)(?![a-zA-Z])\s*/g, '')
    .replace(/\\placeholder\{[^{}]*\}/g, '')
    .replace(/\\[dt]frac(?![a-zA-Z])/g, '\\frac')
    .replace(/\\(?:displaystyle|textstyle)(?![a-zA-Z])/g, ' ')
    .replace(/\\[,;:!> ]/g, ' ')
    .replace(/\\(?:quad|qquad|thinspace|medspace|thickspace|enspace)(?![a-zA-Z])/g, ' ')
    .replace(/X/g, 'x')
    .trim();
}

// ---------- 내부 나무 ----------

type Op =
  | 'add' | 'mul' | 'div' | 'neg' | 'pow' | 'sqrt' | 'root' | 'abs'
  | 'sin' | 'cos' | 'tan' | 'sec' | 'csc' | 'cot' | 'asin' | 'acos' | 'atan'
  | 'sinh' | 'cosh' | 'tanh' | 'exp' | 'ln' | 'log' | 'floor' | 'ceil' | 'round'
  | 'max' | 'min' | 'sign';

type Node =
  | { k: 'num'; v: number }
  | { k: 'x' }
  | { k: 'pi' }
  | { k: 'e' }
  | { k: 'op'; op: Op; a: Node[] };

class Reject extends Error {}

const MSG = {
  empty: '식을 써 주세요',
  long: '식이 너무 길어요',
  complex: '식이 너무 복잡해요',
  incomplete: '식이 아직 덜 끝났어요. 끝에 남은 기호나 괄호를 확인해 주세요',
  symbol: '쓸 수 없는 기호예요',
  letter: (s: string) => `쓸 수 없는 글자가 있어요: ${s}`,
};

const UNARY: Record<string, Op> = {
  Negate: 'neg', Sqrt: 'sqrt', Abs: 'abs', Sin: 'sin', Cos: 'cos', Tan: 'tan', Sec: 'sec', Csc: 'csc',
  Cot: 'cot', Arcsin: 'asin', Arccos: 'acos', Arctan: 'atan', Sinh: 'sinh', Cosh: 'cosh', Tanh: 'tanh',
  Exp: 'exp', Ln: 'ln', Floor: 'floor', Ceil: 'ceil', Round: 'round', Sign: 'sign',
};

function numberFromString(s: string): number {
  // CE 는 큰 수·되풀이 소수를 {num:"..."} 로 준다. 되풀이 부분 "0.(3)" 은 몇 번 펼친다.
  const rep = /^([-+]?\d*\.\d*)\((\d+)\)$/.exec(s);
  if (rep) return Number(rep[1] + rep[2].repeat(Math.ceil(20 / rep[2].length)));
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) throw new Reject(MSG.symbol);
  return Number(s);
}

/** 미완성 표시(Error·Sequence·Tuple·Nothing)를 먼저 찾는다. 쓸 수 없는 명령이면 기호 안내. */
function scanIncomplete(json: unknown, depth: number): string | null {
  if (depth > DEPTH_MAX + 20) return MSG.complex;
  if (json === 'Nothing') return MSG.incomplete;
  if (!Array.isArray(json)) return null;
  const head = json[0];
  if (head === 'Error') {
    const code = typeof json[1] === 'string' ? json[1] : '';
    return /unexpected-command|unknown/.test(code) ? MSG.symbol : MSG.incomplete;
  }
  let found: string | null = head === 'Sequence' || head === 'Tuple' ? MSG.incomplete : null;
  for (let i = 1; i < json.length; i++) {
    const r = scanIncomplete(json[i], depth + 1);
    if (r === MSG.symbol || r === MSG.complex) return r;
    if (r && !found) found = r;
  }
  return found;
}

function countNodes(json: unknown): number {
  if (Array.isArray(json)) {
    let n = 1;
    for (let i = 1; i < json.length; i++) {
      n += countNodes(json[i]);
      if (n > NODE_MAX) return n;
    }
    return n;
  }
  return 1;
}

function build(json: unknown, depth: number): Node {
  if (depth > DEPTH_MAX) throw new Reject(MSG.complex);
  if (typeof json === 'number') return { k: 'num', v: json };
  if (typeof json === 'string') {
    if (json === 'x') return { k: 'x' };
    if (json === 'Pi') return { k: 'pi' };
    if (json === 'ExponentialE' || json === 'e') return { k: 'e' };
    if (json === 'Half') return { k: 'num', v: 0.5 };
    if (/^[a-zA-Z]$/.test(json)) throw new Reject(MSG.letter(json));
    throw new Reject(MSG.symbol);
  }
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const num = (json as { num?: unknown }).num;
    if (typeof num === 'string' && num.length <= 64) return { k: 'num', v: numberFromString(num) };
    throw new Reject(MSG.symbol);
  }
  if (!Array.isArray(json) || typeof json[0] !== 'string') throw new Reject(MSG.symbol);
  const head = json[0];
  const args = json.slice(1).map((a) => build(a, depth + 1));
  const n = args.length;
  const need = (ok: boolean) => {
    if (!ok) throw new Reject(MSG.incomplete);
  };
  const op = (o: Op, a: Node[]): Node => ({ k: 'op', op: o, a });

  if (head === 'Negate' && n === 1 && args[0].k === 'num') return { k: 'num', v: -args[0].v };
  if (head in UNARY) {
    need(n === 1);
    return op(UNARY[head], args);
  }
  switch (head) {
    case 'Delimiter':
      need(n === 1);
      return args[0];
    case 'Add':
      need(n >= 1);
      return n === 1 ? args[0] : op('add', args);
    case 'Subtract':
      need(n === 2);
      return op('add', [args[0], op('neg', [args[1]])]);
    case 'Multiply':
    case 'InvisibleOperator':
      need(n >= 1);
      return n === 1 ? args[0] : op('mul', args);
    case 'Divide':
    case 'Rational':
      need(n === 2);
      return op('div', args);
    case 'Half':
      need(n === 1);
      return op('div', [args[0], { k: 'num', v: 2 }]);
    case 'Power':
      need(n === 2);
      return op('pow', args);
    case 'Square':
      need(n === 1);
      return op('pow', [args[0], { k: 'num', v: 2 }]);
    case 'Root':
      need(n === 2);
      return op('root', args);
    case 'Log':
      need(n === 1 || n === 2);
      return op('log', n === 1 ? [args[0], { k: 'num', v: 10 }] : args);
    case 'Lb':
    case 'Log2':
      need(n === 1);
      return op('log', [args[0], { k: 'num', v: 2 }]);
    case 'Lg':
    case 'Log10':
      need(n === 1);
      return op('log', [args[0], { k: 'num', v: 10 }]);
    case 'Max':
    case 'Min':
      need(n >= 1);
      return n === 1 ? args[0] : op(head === 'Max' ? 'max' : 'min', args);
    default:
      throw new Reject(MSG.symbol);
  }
}

// ---------- 계산 (클로저 나무, eval 없음) ----------

type Fn = (x: number) => number;

function oddRoot(v: number, n: number): number {
  if (v < 0 && Number.isInteger(n) && Math.abs(n % 2) === 1) return -Math.pow(-v, 1 / n);
  return Math.pow(v, 1 / n);
}

function compile(node: Node): Fn {
  switch (node.k) {
    case 'num': {
      const v = node.v;
      return () => v;
    }
    case 'x':
      return (x) => x;
    case 'pi':
      return () => Math.PI;
    case 'e':
      return () => Math.E;
  }
  const fs = node.a.map(compile);
  const [a, b] = fs;
  switch (node.op) {
    case 'add':
      return (x) => {
        let s = 0;
        for (const f of fs) s += f(x);
        return s;
      };
    case 'mul':
      return (x) => {
        let p = 1;
        for (const f of fs) p *= f(x);
        return p;
      };
    case 'div':
      return (x) => a(x) / b(x);
    case 'neg':
      return (x) => -a(x);
    case 'pow':
      // e^x 는 Math.exp. 그 밖은 지수를 잘라 두고 Math.pow.
      if (node.a[0].k === 'e') return (x) => Math.exp(Math.max(-EXP_CLAMP, Math.min(EXP_CLAMP, b(x))));
      return (x) => {
        const base = a(x);
        const ex = Math.max(-EXP_CLAMP, Math.min(EXP_CLAMP, b(x)));
        if (base < 0 && !Number.isInteger(ex)) {
          // x^{1/3} 같은 홀수 거듭제곱근은 음수에서도 실수 값이 있다.
          const inv = 1 / ex;
          if (Math.abs(inv - Math.round(inv)) < 1e-9) return oddRoot(base, Math.round(inv));
        }
        return Math.pow(base, ex);
      };
    case 'sqrt':
      return (x) => Math.sqrt(a(x));
    case 'root':
      return (x) => oddRoot(a(x), b(x));
    case 'abs':
      return (x) => Math.abs(a(x));
    case 'sin':
      return (x) => Math.sin(a(x));
    case 'cos':
      return (x) => Math.cos(a(x));
    case 'tan':
      return (x) => Math.tan(a(x));
    case 'sec':
      return (x) => 1 / Math.cos(a(x));
    case 'csc':
      return (x) => 1 / Math.sin(a(x));
    case 'cot':
      return (x) => 1 / Math.tan(a(x));
    case 'asin':
      return (x) => Math.asin(a(x));
    case 'acos':
      return (x) => Math.acos(a(x));
    case 'atan':
      return (x) => Math.atan(a(x));
    case 'sinh':
      return (x) => Math.sinh(a(x));
    case 'cosh':
      return (x) => Math.cosh(a(x));
    case 'tanh':
      return (x) => Math.tanh(a(x));
    case 'exp':
      return (x) => Math.exp(Math.max(-EXP_CLAMP, Math.min(EXP_CLAMP, a(x))));
    case 'ln':
      return (x) => Math.log(a(x));
    case 'log':
      return (x) => Math.log(a(x)) / Math.log(b(x));
    case 'floor':
      return (x) => Math.floor(a(x));
    case 'ceil':
      return (x) => Math.ceil(a(x));
    case 'round':
      return (x) => Math.round(a(x));
    case 'sign':
      return (x) => Math.sign(a(x));
    case 'max':
      return (x) => {
        let m = -Infinity;
        for (const f of fs) m = Math.max(m, f(x));
        return m;
      };
    case 'min':
      return (x) => {
        let m = Infinity;
        for (const f of fs) m = Math.min(m, f(x));
        return m;
      };
  }
}

// ---------- 다시 쓰기 (검증된 나무에서만 LaTeX 를 만든다) ----------

const FN_LATEX: Partial<Record<Op, string>> = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot',
  asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan', sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh',
  ln: '\\ln', sign: '\\operatorname{sgn}', round: '\\operatorname{round}',
};

function numLatex(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const s = String(Math.abs(v));
  let body = s;
  if (/e/i.test(s)) {
    const [m, e] = s.split(/e/i);
    body = `${m}\\cdot10^{${Number(e)}}`;
  }
  return v < 0 || Object.is(v, -0) ? `-${body}` : body;
}

// 우선순위: 0 덧셈, 1 곱셈, 2 단항 음수, 3 거듭제곱 밑, 4 원자
function prec(n: Node): number {
  if (n.k === 'num') return n.v < 0 || /e/i.test(String(n.v)) ? 2 : 4;
  if (n.k !== 'op') return 4;
  switch (n.op) {
    case 'add':
      return 0;
    case 'mul':
      return 1;
    case 'neg':
      return 2;
    case 'pow':
      return 3;
    default:
      return 4;
  }
}

/** 앞에 빼기로 쓸 수 있는 항이면 부호를 뗀 항을 돌려준다(x+-2x 같은 모양을 피한다). */
function negated(t: Node): Node | null {
  if (t.k === 'op' && t.op === 'neg') return t.a[0];
  if (t.k === 'num' && t.v < 0) return { k: 'num', v: -t.v };
  if (t.k === 'op' && t.op === 'mul' && t.a[0].k === 'num' && t.a[0].v < 0) {
    const v = -t.a[0].v;
    return { k: 'op', op: 'mul', a: v === 1 ? t.a.slice(1) : [{ k: 'num', v }, ...t.a.slice(1)] };
  }
  return null;
}

function wrap(n: Node, min: number): string {
  const s = ser(n);
  return prec(n) < min ? `(${s})` : s;
}

function ser(n: Node): string {
  switch (n.k) {
    case 'num':
      return numLatex(n.v);
    case 'x':
      return 'x';
    case 'pi':
      return '\\pi';
    case 'e':
      return 'e';
  }
  const a = n.a;
  switch (n.op) {
    case 'add': {
      let out = ser(a[0]);
      for (let i = 1; i < a.length; i++) {
        const t = a[i];
        const pos = negated(t);
        out += pos ? `-${wrap(pos, 1)}` : `+${wrap(t, 1)}`;
      }
      return out;
    }
    case 'mul':
      return a.map((t, i) => (i === 0 ? wrap(t, 2) : wrap(t, 3))).join('\\cdot ');
    case 'neg':
      return `-${wrap(a[0], 3)}`;
    case 'div':
      return `\\frac{${ser(a[0])}}{${ser(a[1])}}`;
    case 'pow':
      return `${wrap(a[0], 4)}^{${ser(a[1])}}`;
    case 'sqrt':
      return `\\sqrt{${ser(a[0])}}`;
    case 'root':
      return `\\sqrt[${ser(a[1])}]{${ser(a[0])}}`;
    case 'abs':
      return `\\left|${ser(a[0])}\\right|`;
    case 'floor':
      return `\\lfloor ${ser(a[0])}\\rfloor `;
    case 'ceil':
      return `\\lceil ${ser(a[0])}\\rceil `;
    case 'exp':
      return `e^{${ser(a[0])}}`;
    case 'log':
      return `\\log_{${ser(a[1])}}(${ser(a[0])})`;
    case 'max':
    case 'min':
      return `\\${n.op}(${a.map(ser).join(',')})`;
    default:
      return `${FN_LATEX[n.op]}(${ser(a[0])})`;
  }
}

// ---------- 공개 API ----------

let engine: ComputeEngine | null = null;

/** 여는 괄호와 닫는 괄호가 짝이 맞는지(닫는 것이 먼저 나오거나 덜 닫히면 false). */
function bracketsBalanced(t: string): boolean {
  const st: string[] = [];
  const pair: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (const ch of t) {
    if (ch === '(' || ch === '[' || ch === '{') st.push(ch);
    else if (ch in pair) { if (st.pop() !== pair[ch]) return false; }
  }
  return st.length === 0;
}
const trees = new WeakMap<Formula, Node>();

export function readFormula(latex: string): { ok: true; formula: Formula } | { ok: false; reason: string } {
  if (typeof latex !== 'string') return { ok: false, reason: MSG.empty };
  if (latex.length > LATEX_MAX * 4) return { ok: false, reason: MSG.long };
  const clean = sanitizeMathLiveLatex(latex);
  if (!clean) return { ok: false, reason: MSG.empty };
  if (clean.length > LATEX_MAX) return { ok: false, reason: MSG.long };
  // 한 단계 안에 여는 괄호가 너무 많으면 CE 파서에 넘기기 전에 막는다.
  let open = 0;
  let deepest = 0;
  for (const ch of clean) {
    if (ch === '{' || ch === '(' || ch === '[') deepest = Math.max(deepest, ++open);
    else if (ch === '}' || ch === ')' || ch === ']') open--;
  }
  if (deepest > DEPTH_MAX) return { ok: false, reason: MSG.complex };
  if (open !== 0 || !bracketsBalanced(clean)) return { ok: false, reason: MSG.incomplete };
  // 수식 해석기는 부호·절댓값 막대가 줄지어 나오면 시간이 기하급수로 늘어난다(짧은 글 하나로 판이 멈춘다).
  // 그래서 해석기에 넘기기 전에 값싸게 훑어 막는다. 실제 식에는 +·- 가 셋 넘게 붙거나 | 가 여섯 넘게 나오지 않는다.
  // 띄움 명령·빈 묶음·물결(~)은 지우고, 막대를 뜻하는 명령은 모두 | 로 바꿔 센다(\vert·{-}{-} 로 돌아가지 못하게)
  const tight = clean
    .replace(/\\(?:left|right|big|Big|bigg|Bigg)[lr]?(?![a-zA-Z])/g, '')
    .replace(/\\(?:[lr]?[vV]ert|mid|\|)(?![a-zA-Z])/g, '|')
    .replace(/\\[,;:! ]|\\(?:quad|qquad|space|enspace|thinspace)(?![a-zA-Z])|[\s~{}]/g, '');
  if (/(?:[+\-]|\\pm|\\mp){3,}/.test(tight)) return { ok: false, reason: MSG.complex };
  if ((tight.match(/\|/g) ?? []).length > 6) return { ok: false, reason: MSG.complex };
  if ((tight.match(/[+\-]|\\pm|\\mp/g) ?? []).length > 40) return { ok: false, reason: MSG.complex };

  let json: unknown;
  try {
    engine ??= new ComputeEngine();
    json = engine.parse(clean, { canonical: false }).json;
  } catch {
    return { ok: false, reason: MSG.incomplete };
  }
  const inc = scanIncomplete(json, 0);
  if (inc) return { ok: false, reason: inc };
  if (countNodes(json) > NODE_MAX) return { ok: false, reason: MSG.complex };
  let tree: Node;
  try {
    tree = build(json, 0);
  } catch (e) {
    if (e instanceof Reject) return { ok: false, reason: e.message };
    return { ok: false, reason: MSG.symbol };
  }
  const raw = compile(tree);
  const f = (x: number): number => {
    const y = raw(x);
    return Number.isFinite(y) ? y : NaN;
  };
  const formula: Formula = { latex: clean, f };
  trees.set(formula, tree);
  return { ok: true, formula };
}

const RUN_Y_MAX = 60;
const RUN_JUMP_MAX = 8;
const POINT_MAX = 1200;

export function sampleRuns(formula: Formula, a: number, b: number, step = 0.05): [number, number][][] {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(step > 0) || !Number.isFinite(step)) return [];
  if (a > b) [a, b] = [b, a];
  if ((b - a) / step + 1 > POINT_MAX) step = (b - a) / (POINT_MAX - 1);
  const count = b === a ? 1 : Math.min(POINT_MAX, Math.floor((b - a) / step + 1e-9) + 1);
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  let prev = NaN;
  for (let i = 0; i < count; i++) {
    const x = i === count - 1 && count > 1 && b - (a + i * step) < step * 1e-6 ? b : a + i * step;
    const y = formula.f(x);
    const ok = Number.isFinite(y) && Math.abs(y) <= RUN_Y_MAX;
    if (!ok || (run.length > 0 && Math.abs(y - prev) > RUN_JUMP_MAX)) {
      if (run.length) runs.push(run);
      run = [];
    }
    if (ok) {
      run.push([x, y]);
      prev = y;
    }
  }
  if (run.length) runs.push(run);
  // 점근선 바로 옆에 홀로 남은 점은 선을 그을 수 없으니 뺀다.
  return runs.filter((r) => r.length >= 2);
}

export function slopeAt(formula: Formula, x: number): number {
  const h = 1e-3;
  const d = (formula.f(x + h) - formula.f(x - h)) / (2 * h);
  return Number.isFinite(d) ? d : NaN;
}

export function canonLatex(formula: Formula): string {
  const tree = trees.get(formula);
  if (!tree) {
    const again = readFormula(formula.latex);
    return again.ok ? canonLatex(again.formula) : '';
  }
  return ser(tree);
}

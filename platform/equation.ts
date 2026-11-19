/**
 * 저울에 올리는 일차방정식. 상자 하나가 x, 구슬 하나가 1이다. 구슬 수가 음수면 그만큼 풍선이다(풍선 하나가 -1).
 * 풍선이 달린 접시에 구슬을 올리면 풍선 하나와 함께 사라진다(1 + (-1) = 0).
 * 왼쪽·오른쪽 접시에 상자와 구슬이 몇 개씩 있는지가 식의 전부다: [왼 상자, 왼 구슬, 오른 상자, 오른 구슬].
 * 식의 수는 범위만 정해 두고 시작할 때마다 뽑는다. 답(x)은 늘 자연수다.
 */
export type Range = number | [number, number];
export type Line = [number, number, number, number];

export type EquationSpec = {
  x: [number, number];          // 상자 하나의 무게
  leftBoxes: [number, number];  // 왼쪽 접시의 상자 수(x 의 계수)
  leftMarbles: [number, number];
  rightBoxes: [number, number];
};

export const MAX_BOXES = 6, MAX_MARBLES = 30;

/** 같은 씨앗이면 같은 수가 나온다(방장이 뽑은 식을 모두가 같이 보게). */
export function rng(seed: number) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const pick = (r: [number, number], rnd: () => number) => r[0] + Math.floor(rnd() * (r[1] - r[0] + 1));

/** 범위에서 식 하나를 뽑는다. 오른쪽 구슬 수는 저울이 수평이 되게 계산한다. */
export function makeEquation(spec: EquationSpec, rnd: () => number): { x: number; line: Line } {
  const x = pick(spec.x, rnd), lb = pick(spec.leftBoxes, rnd), lm = pick(spec.leftMarbles, rnd), rb = pick(spec.rightBoxes, rnd);
  return { x, line: [lb, lm, rb, (lb - rb) * x + lm] };
}

/** 범위가 약속에 맞는지. 맞지 않으면 까닭을 쉬운 말로 돌려준다. */
export function checkSpec(s: EquationSpec): string | null {
  const ok = (r: [number, number], lo: number, hi: number) => Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= lo && r[1] <= hi && r[0] <= r[1];
  if (!ok(s.x, 1, 9)) return 'x 는 1~9 사이여야 해요.';
  if (!ok(s.leftBoxes, 1, MAX_BOXES)) return `왼쪽 상자는 1~${MAX_BOXES}개여야 해요.`;
  if (!ok(s.leftMarbles, -9, 9)) return '왼쪽 구슬은 -9~9 사이여야 해요(음수는 풍선).';
  if (!ok(s.rightBoxes, 0, MAX_BOXES - 1)) return `오른쪽 상자는 0~${MAX_BOXES - 1}개여야 해요.`;
  if (s.leftBoxes[0] === 1 && s.leftMarbles[0] <= 0 && s.leftMarbles[1] >= 0 && s.rightBoxes[0] === 0) return '처음부터 x 만 남은 식이 나올 수 있어요. 왼쪽 상자를 2개 이상으로 하거나 왼쪽 구슬을 1개 이상으로 적어 주세요.';
  if (s.rightBoxes[1] >= s.leftBoxes[0]) return '왼쪽 상자가 오른쪽 상자보다 늘 많아야 해요(같으면 x 를 알 수 없어요).';
  const least = (s.leftBoxes[0] - s.rightBoxes[1]) * s.x[0] + s.leftMarbles[0];
  if (least < 0) return '오른쪽 구슬이 0개보다 적어질 수 있어요. 풍선을 줄이거나 x 를 키워 주세요.';
  const most = (s.leftBoxes[1] - s.rightBoxes[0]) * s.x[1] + s.leftMarbles[1];
  if (most > MAX_MARBLES) return `오른쪽 구슬이 ${most}개까지 나올 수 있어요. ${MAX_MARBLES}개를 넘지 않게 범위를 줄여 주세요.`;
  return null;
}

export const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** 접시 위의 모든 묶음을 똑같이 나눌 수 있는 가장 큰 수(1이면 못 나눈다). */
export const commonDivisor = (l: Line) => l.reduce((g, n) => gcd(g, Math.abs(n)), 0);

export const sameLine = (a: Line, b: Line) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/** x 만 남았는가: 한쪽에 상자 하나뿐이고 맞은편에는 구슬뿐. */
export const isolated = (l: Line) => (l[0] === 1 && l[1] === 0 && l[2] === 0) || (l[2] === 1 && l[3] === 0 && l[0] === 0);

export function sideText(boxes: number, marbles: number) {
  if (!boxes) return String(marbles);
  return (boxes === 1 ? 'x' : `${boxes}x`) + (marbles > 0 ? ` + ${marbles}` : marbles < 0 ? ` - ${-marbles}` : '');
}

/** 수 뒤에 붙는 조사. 우리말로 읽었을 때 받침이 있는지로 고른다(3을, 2를 / 3으로, 2로). */
const lastSound = (n: number) => (n % 10 === 0 ? (n % 100 === 0 && n ? 'ㄱ' : 'ㅂ') : ['', 'ㄹ', '', 'ㅁ', '', '', 'ㄱ', 'ㄹ', 'ㄹ', ''][n % 10]);
export const eul = (n: number) => `${n}${n === 0 || lastSound(n) ? '을' : '를'}`;
export const euro = (n: number) => { const s = n === 0 ? 'ㅇ' : lastSound(n); return `${n}${s && s !== 'ㄹ' ? '으로' : '로'}`; };

export type StepKind = 'sub' | 'add' | 'subx' | 'addx' | 'div' | 'other';

/** 앞 줄에서 뒷줄로 갈 때 양변에 한 일. 양쪽에 같은 일을 한 것이 아니면 'other'. */
export function stepOf(a: Line, b: Line): { kind: StepKind; n: number } {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2], b[3] - a[3]];
  if (d[0] === 0 && d[2] === 0 && d[1] === d[3] && d[1] !== 0) return { kind: d[1] < 0 ? 'sub' : 'add', n: Math.abs(d[1]) };
  if (d[1] === 0 && d[3] === 0 && d[0] === d[2] && d[0] !== 0) return { kind: d[0] < 0 ? 'subx' : 'addx', n: Math.abs(d[0]) };
  const big = a.find(v => v !== 0) ?? 0, small = b[a.indexOf(big)] ?? 0;
  if (big && small && big % small === 0 && big / small > 1) { const k = big / small; if (a.every((v, i) => v === b[i] * k)) return { kind: 'div', n: k }; }
  return { kind: 'other', n: 0 };
}

/** 풀이 판에 줄 사이마다 적는 말. */
export function stepText(a: Line, b: Line) {
  const { kind, n } = stepOf(a, b);
  const xs = n === 1 ? 'x' : `${n}x`;
  if (kind === 'sub') return `양변에서 ${eul(n)} 뺀다`;
  if (kind === 'add') return `양변에 ${eul(n)} 더한다`;
  if (kind === 'subx') return `양변에서 ${xs}를 뺀다`;
  if (kind === 'addx') return `양변에 ${xs}를 더한다`;
  if (kind === 'div') return `양변을 ${euro(n)} 나눈다`;
  return '';
}

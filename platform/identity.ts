/**
 * 도름이 색과 가명. 로그인도 입력 칸도 없고, 학생이 고르는 것도 없다.
 * 색은 방에 들어온 차례대로 판이 정한다(2026-11-19 형: "도름이 색은 자동선택이야 들어온 순서대로").
 * 가명은 색 이름과 차례 번호로 짓는다. 이 기기에 두는 것은 방 안에서 서로를 가리는 무작위 번호뿐이다.
 */
export type Swatch = { id: string; name: string; hex: string };

/** 들어온 차례대로 돌아가며 입는 몸 색 열 가지. 첫째는 원래 도름이의 흰 몸. */
export const SWATCHES: Swatch[] = [
  { id: 'white', name: '하양', hex: '#F4F7FF' },
  { id: 'pink', name: '분홍', hex: '#FFB3C7' },
  { id: 'sky', name: '하늘', hex: '#A8DDF5' },
  { id: 'lemon', name: '노랑', hex: '#FFEFA0' },
  { id: 'mint', name: '민트', hex: '#A8E6C8' },
  { id: 'violet', name: '보라', hex: '#C9B8F5' },
  { id: 'peach', name: '살구', hex: '#FFD0A6' },
  { id: 'blue', name: '파랑', hex: '#A9C2FF' },
  { id: 'leaf', name: '연두', hex: '#C4EDAE' },
  { id: 'plum', name: '자주', hex: '#F0B4E6' },
];

/** order: 방에 들어온 차례(0부터). 열 명이 넘으면 같은 색이 돌아오고, 머리 위 번호로 가린다. */
export const swatchFor = (order: number) => SWATCHES[((order % SWATCHES.length) + SWATCHES.length) % SWATCHES.length];
export const colorFor = (order: number) => swatchFor(order).hex;
export const nameFor = (order: number) => `${swatchFor(order).name} 도름이 ${order + 1}`;

const KEY = 'dorms-world.me.v3';

/** 방 안에서 서로를 가리는 무작위 번호. 사람을 알아볼 수 있는 정보가 아니다. */
export function deviceId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[0-9a-f]{16}$/.test(saved)) return saved;
  } catch { /* 저장이 막힌 기기는 매번 새로 */ }
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  const id = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(KEY, id); } catch { /* 무시 */ }
  return id;
}

/**
 * 글자로 찍는 점 그림. 팩마다 필요한 그림(소화 기관, 음식, 악기 …)을 선생님의 AI 가 글자로 그려 넣는다.
 * 한 글자가 한 점이고, 쓸 수 있는 색은 아래 물감뿐이다. 그래서 누가 그려도 판의 화풍(파스텔 점 그림, 남색 윤곽)에서 벗어나지 않는다.
 * 형식 설명은 kit/ART_GUIDE.md.
 */
export const INKS: Record<string, string> = {
  n: '#14285F', // 남색(윤곽)
  b: '#3978CE', // 파랑(윤곽, 그늘)
  w: '#F4F7FF', // 흰색
  k: '#D9E8FF', // 옅은 하늘
  y: '#F5C542', // 노랑
  r: '#E0524F', // 빨강
  p: '#F2B49A', // 살구
  g: '#A8E6C8', // 민트
  s: '#F3E6CC', // 모래
  d: '#9A5B44', // 갈색
  v: '#B9A5E8', // 연보라
  o: '#F2994A', // 주황
  e: '#4FA57A', // 초록
  t: '#5CC2C7', // 청록
  m: '#FFB3C7', // 분홍
  a: '#9AA7C2', // 회색
  h: '#5E3A2E', // 고동
};
export const SPRITE_MAX = 48, SPRITE_MIN = 3;

export type Sprite = { name: string; w: number; h: number; rows: string[] };

/** 글자 그림을 읽는다. 약속에 안 맞으면 어디가 왜 안 맞는지 쉬운 말로 알려 준다. */
export function parseSprite(text: string, name: string): Sprite {
  const rows = text.replace(/\r/g, '').split('\n');
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
  if (!rows.length) throw new Error(`그림 "${name}" 이 비어 있어요.`);
  const w = rows[0].length, h = rows.length;
  if (w < SPRITE_MIN || h < SPRITE_MIN || w > SPRITE_MAX || h > SPRITE_MAX) throw new Error(`그림 "${name}" 은 가로세로 ${SPRITE_MIN}~${SPRITE_MAX}점이어야 해요(지금 ${w}×${h}).`);
  rows.forEach((row, r) => {
    if (row.length !== w) throw new Error(`그림 "${name}" ${r + 1}번째 줄 길이가 달라요(${row.length}점, 첫 줄은 ${w}점).`);
    for (let c = 0; c < w; c++) if (row[c] !== '.' && !INKS[row[c]]) throw new Error(`그림 "${name}" ${r + 1}번째 줄 ${c + 1}번째 점의 "${row[c]}" 는 없는 물감이에요. 쓸 수 있는 글자: . ${Object.keys(INKS).join(' ')}`);
  });
  // 화풍 약속: 그림의 가장자리(빈 점이나 그림 끝과 맞닿은 점)는 남색(n)이나 파랑(b) 윤곽이어야 한다
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= w || r >= h ? '.' : rows[r][c]);
  let edge = 0, lined = 0, filled = 0;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    if (at(c, r) === '.') continue;
    filled++;
    if (at(c - 1, r) === '.' || at(c + 1, r) === '.' || at(c, r - 1) === '.' || at(c, r + 1) === '.') { edge++; if (at(c, r) === 'n' || at(c, r) === 'b') lined++; }
  }
  if (filled < 4) throw new Error(`그림 "${name}" 에 찍힌 점이 너무 적어요.`);
  if (lined < edge * 0.9) throw new Error(`그림 "${name}" 의 가장자리는 남색(n)이나 파랑(b) 윤곽으로 둘러 주세요(가장자리 ${edge}점 가운데 ${lined}점만 윤곽이에요). 판의 다른 그림과 같은 화풍이 되게 하는 약속이에요.`);
  return { name, w, h, rows };
}

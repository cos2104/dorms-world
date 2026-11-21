/**
 * 화면에 그리는 기호는 모두 여기의 인라인 SVG 로만 그린다(이모지·글자 기호 금지).
 * 24x24 판, 선 굵기 2, 색은 currentColor 를 따른다.
 */
const PATHS = {
  left: '<path d="M15 5 8 12l7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  up: '<path d="m5 15 7-7 7 7"/>',
  redo: '<path d="M19 12a7 7 0 1 1-2-4.9"/><path d="M19 4v4h-4"/>',
  swap: '<path d="M4 8h14"/><path d="m14 4 4 4-4 4"/><path d="M20 16H6"/><path d="m10 12-4 4 4 4"/>',
  back: '<path d="M19 12H6"/><path d="m11 6-6 6 6 6"/>',
  fire: '<path d="M5 15a7 7 0 0 0 14 0c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 2-5 5-5 8Z"/>',
  door: '<path d="M6 21V4h12v17"/><path d="M4 21h16"/><circle cx="14.5" cy="12.5" r="1"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-2 0-1.4-1-1.6-1-3 0-1 .8-2 2-2h2a4 4 0 0 0 4-4c0-4-4-7-9-7Z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6 6 0 0 1 3.5 6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m16 7 3 3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  close: '<path d="m6 6 12 12"/><path d="M18 6 6 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  graph: '<path d="M4 4v16h16"/><path d="M7 16c3-8 6-8 11-11"/>',
  move: '<path d="M4 12h16"/><path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/>',
  play: '<path d="M8 5v14l11-7Z"/>',
  crown: '<path d="m3 8 4 4 5-6 5 6 4-4-2 11H5Z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 2h6"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  pad: '<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4"/><path d="M5 12h4"/><circle cx="16.5" cy="12" r="1.2"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13 7 4 4"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 20, label?: string): string {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="ic" ${a11y} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
}

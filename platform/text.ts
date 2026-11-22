/** HTML 로 넣는 글자는 모두 이걸 거친다(방 친구의 이름처럼 밖에서 온 글자가 있으므로). */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
/** 밀리초를 mm:ss 로(초는 반올림). */
export function mmss(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

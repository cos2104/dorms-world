/** HTML 로 넣는 글자는 모두 이걸 거친다(방 친구의 이름처럼 밖에서 온 글자가 있으므로). */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

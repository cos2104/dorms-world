/** 방 코드: 헷갈리는 글자(0 O 1 I L)를 뺀 여섯 글자. 화면과 방 서버가 함께 쓰도록 다른 것에 기대지 않는다. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newRoomCode() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return [...a].map(b => ALPHABET[b % ALPHABET.length]).join('');
}
export const cleanRoomCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
export const validRoomCode = (s: string) => new RegExp(`^[${ALPHABET}]{6}$`).test(s);

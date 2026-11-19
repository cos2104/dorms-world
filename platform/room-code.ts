/** 방 코드: 헷갈리는 글자(0 O 1 I L)를 뺀 여섯 글자. 연결 꾸러미 없이 쓸 수 있게 따로 둔다. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const roomsAvailable = () => !!import.meta.env.VITE_ROOM_URL && !!import.meta.env.VITE_ROOM_KEY;
export function newRoomCode() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return [...a].map(b => ALPHABET[b % ALPHABET.length]).join('');
}
export const cleanRoomCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
export const validRoomCode = (s: string) => new RegExp(`^[${ALPHABET}]{6}$`).test(s);

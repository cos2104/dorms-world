/**
 * 선생님이 더한 새 움직임(platform/behaviors/*.ts)이 약속을 지키는지 본다. 병합할 때 사람이 다시 읽지만, 기계로 먼저 거른다.
 * 약속: 바깥과 주고받지 않는다 · 시간과 난수를 쓰지 않는다(방장이 바뀌어도 같은 결과) · 판의 정해진 손잡이(behavior.ts)만 가져다 쓴다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BEHAVIORS } from '../platform/behavior';

const dir = fileURLToPath(new URL('../platform/behaviors/', import.meta.url));
const files = readdirSync(dir).filter(f => f.endsWith('.ts'));
const BANNED: [RegExp, string][] = [
  [/\bfetch\b|XMLHttpRequest|WebSocket|EventSource|navigator\b|sendBeacon/, '바깥과 주고받는 코드'],
  [/\beval\b|\bFunction\s*\(|import\s*\(/, '글을 코드로 돌리는 것'],
  [/\bDate\b|performance\.now|Math\.random|crypto\b/, '시간·난수(방마다 결과가 달라진다)'],
  [/\bwindow\b|\bdocument\b|localStorage|sessionStorage|indexedDB|globalThis|\bprocess\b|require\s*\(/, '화면·저장소·컴퓨터에 손대는 것'],
  [/https?:\/\//, '바깥 주소'],
];

describe('새 움직임 파일', () => {
  it('파일 이름은 영문 소문자·숫자·줄표이고, 모두 판에 실린다', () => {
    for (const f of files) {
      expect(f, '이름은 영문 소문자·숫자·줄표 40자까지').toMatch(/^[a-z0-9-]{1,40}\.ts$/);
      expect(BEHAVIORS[f.replace(/\.ts$/, '')], `${f}: export default 로 { about, ... } 를 내보내 주세요`).toBeTruthy();
    }
  });
  it.each(files)('%s: 판의 손잡이만 쓰고 바깥·시간·난수를 쓰지 않는다', f => {
    const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');   // 주석은 빼고 본다
    for (const [re, what] of BANNED) expect(re.test(src), `${f}: ${what}은 쓸 수 없어요`).toBe(false);
    for (const m of src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) expect(m[1], `${f}: '../behavior' 만 가져다 쓸 수 있어요`).toBe('../behavior');
  });
});

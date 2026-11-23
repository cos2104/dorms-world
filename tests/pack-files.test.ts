/** 팩 파일 검사가 수상한 파일을 '실행하지 않고' 막는지 본다(임시 폴더에서). */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/check-pack-files.mjs', import.meta.url));
let dir = '';
function make(extra: (pack: string) => void) {
  dir = mkdtempSync(join(tmpdir(), 'packcheck-'));
  const pack = join(dir, 'packs', 'etc', 'sample');
  mkdirSync(join(pack, 'stages'), { recursive: true });
  writeFileSync(join(pack, 'pack.json'), JSON.stringify({ stages: [{ file: '01' }], creator: { avatar: null } }));
  writeFileSync(join(pack, 'DESIGN.md'), '# 설계서');
  writeFileSync(join(pack, 'stages', '01.json'), '{}');
  writeFileSync(join(pack, 'stages', '01.map.txt'), '...');
  extra(pack);
  try { execFileSync('node', [script, join(dir, 'packs')], { stdio: 'pipe' }); return { ok: true, out: '' }; }
  catch (e) { return { ok: false, out: String((e as { stderr?: Buffer }).stderr ?? '') }; }
}
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const MARK = (pack: string) => join(pack, '..', 'RAN.txt');
const evil = (pack: string) => `require('node:fs').writeFileSync(${JSON.stringify(MARK(pack))}, 'x');`;

describe('팩 파일 검사', () => {
  it('허락된 파일만 있으면 통과한다', () => { expect(make(() => {}).ok).toBe(true); });

  it.each([
    ['시험 파일인 척하는 코드', (p: string) => { mkdirSync(join(p, 'tests')); writeFileSync(join(p, 'tests', 'packs.test.ts'), evil(p)); }],
    ['팩 바로 아래 시험 파일', (p: string) => writeFileSync(join(p, 'a.test.ts'), evil(p))],
    ['확장자를 대문자로 바꾼 코드', (p: string) => writeFileSync(join(p, 'x.JS'), evil(p))],
    ['스테이지 폴더 안 코드', (p: string) => writeFileSync(join(p, 'stages', '01.mjs'), evil(p))],
    ['SVG 프로필 그림', (p: string) => writeFileSync(join(p, 'me.svg'), '<svg onload="1"/>')],
    ['숨김 파일', (p: string) => writeFileSync(join(p, '.env'), 'A=1')],
    ['팩 모음 폴더 바로 아래 코드', (p: string) => writeFileSync(join(p, '..', '..', 'index.ts'), evil(p))],
    ['다른 이름의 설정 파일', (p: string) => writeFileSync(join(p, 'data.json'), '{}')],
    ['너무 큰 설계서', (p: string) => writeFileSync(join(p, 'DESIGN.md'), 'x'.repeat(400 * 1024))],
    ['대문자 폴더 이름', (p: string) => { mkdirSync(join(p, '..', 'EVIL')); writeFileSync(join(p, '..', 'EVIL', 'pack.json'), '{}'); }],
    // 윈도우 일반 계정은 파일 링크를 못 만들어서(관리자만 됨) 누구나 만들 수 있는 폴더 연결(junction)로 같은 것을 본다
    ['바깥을 가리키는 링크', (p: string) => process.platform === 'win32' ? symlinkSync(tmpdir(), join(p, 'me.png'), 'junction') : symlinkSync('/etc/hosts', join(p, 'me.png'))],
    ['폴더 밖을 가리키는 스테이지 이름', (p: string) => writeFileSync(join(p, 'pack.json'), JSON.stringify({ stages: [{ file: '../../x' }], creator: { avatar: null } }))],
    ['폴더 밖을 가리키는 프로필 그림', (p: string) => writeFileSync(join(p, 'pack.json'), JSON.stringify({ stages: [{ file: '01' }], creator: { avatar: '../../a.png' } }))],
  ])('%s 는 막고, 아무것도 실행하지 않는다', (_name, extra) => {
    let pack = '';
    const r = make(p => { pack = p; extra(p); });
    expect(r.ok).toBe(false);
    expect(existsSync(MARK(pack))).toBe(false);
  });
});

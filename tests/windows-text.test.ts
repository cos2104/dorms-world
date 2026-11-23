/** 윈도우에서 만든 팩 글(CRLF 줄 끝, 메모장의 BOM)도 맥에서 만든 것과 똑같이 읽히는지 본다. */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, readStage } from './pack-io';
import { describe, expect, it } from 'vitest';
import { parseSprite } from '../platform/sprite';
import { parseStage } from '../platform/stage';

const dir = new URL('../packs/etc/tutorial/stages/', import.meta.url);
const asWindows = (t: string) => '﻿' + t.replace(/\r?\n/g, '\r\n');

describe('윈도우에서 쓴 팩 글', () => {
  it('지도는 CRLF 와 BOM 이 붙어도 같은 스테이지가 된다', () => {
    const map = readFileSync(new URL('01.map.txt', dir), 'utf8');
    const def = JSON.parse(readFileSync(new URL('01.json', dir), 'utf8'));
    expect(JSON.stringify(parseStage(asWindows(map), def))).toBe(JSON.stringify(parseStage(map, def)));
  });
  it('글자 그림도 CRLF 와 BOM 이 붙어도 같은 그림이 된다', () => {
    const art = readFileSync(new URL('../packs/etc/tutorial/sprites/apple.txt', import.meta.url), 'utf8');
    expect(JSON.stringify(parseSprite(asWindows(art), 'apple'))).toBe(JSON.stringify(parseSprite(art, 'apple')));
  });
  it('메모장으로 저장해 BOM 과 CRLF 가 붙은 팩도 시험 도구가 똑같이 읽는다', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bompack-'));
    try {
      const src = fileURLToPath(new URL('../packs/etc/tutorial/', import.meta.url)), dst = join(tmp, 'tutorial');
      cpSync(src, dst, { recursive: true });
      for (const rel of ['pack.json', ...readdirSync(join(dst, 'stages')).map(f => join('stages', f))]) writeFileSync(join(dst, rel), asWindows(readFileSync(join(dst, rel), 'utf8')));
      expect(readJson(join(dst, 'pack.json'))).toEqual(readJson(join(src, 'pack.json')));
      expect(JSON.stringify(readStage(dst, '01').stage)).toBe(JSON.stringify(readStage(src, '01').stage));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});

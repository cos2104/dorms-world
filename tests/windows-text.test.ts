/** 윈도우에서 만든 팩 글(CRLF 줄 끝, 메모장의 BOM)도 맥에서 만든 것과 똑같이 읽히는지 본다. */
import { readFileSync } from 'node:fs';
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
});

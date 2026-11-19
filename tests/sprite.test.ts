/** 글자로 찍는 점 그림: 정해진 물감과 윤곽 약속을 지킨 것만 받는다. */
import { describe, expect, it } from 'vitest';
import { INKS, parseSprite } from '../platform/sprite';
import { parseStage } from '../platform/stage';

const APPLE = ['....n....', '...nn....', '.nnnnnnn.', 'nrrrrrrrn', 'nrwrrrrrn', 'nrrrrrrrn', 'nrrrrrrrn', '.nrrrrrn.', '..nnnnn..'].join('\n');

describe('글자 그림', () => {
  it('약속대로 그린 그림을 읽는다', () => {
    const s = parseSprite(APPLE + '\n', 'apple');
    expect([s.w, s.h]).toEqual([9, 9]);
    expect(Object.keys(INKS).length).toBeGreaterThan(12);
  });
  it('없는 물감, 들쭉날쭉한 줄, 너무 큰 그림은 까닭을 알려 준다', () => {
    expect(() => parseSprite(APPLE.replace('w', 'Z'), 'a')).toThrow(/없는 물감/);
    expect(() => parseSprite(APPLE + '\nnn', 'a')).toThrow(/줄 길이/);
    expect(() => parseSprite(Array(50).fill('n'.repeat(50)).join('\n'), 'a')).toThrow(/3~48점/);
    expect(() => parseSprite('', 'a')).toThrow(/비어/);
  });
  it('가장자리를 윤곽으로 두르지 않은 그림은 받지 않는다(화풍 통일)', () => {
    const bare = ['rrrrr', 'rrrrr', 'rrrrr', 'rrrrr'].join('\n');
    expect(() => parseSprite(bare, 'blob')).toThrow(/윤곽으로 둘러/);
    expect(() => parseSprite(['nnnnn', 'nrrrn', 'nrrrn', 'nnnnn'].join('\n'), 'box')).not.toThrow();
  });
});

describe('스테이지에서 그림 쓰기', () => {
  const row = (cells: Record<number, string>, fill = '.') => { const a = Array(40).fill(fill); for (const [c, t] of Object.entries(cells)) [...t].forEach((ch, k) => { a[+c + k] = ch; }); return a.join(''); };
  const MAP = [...Array(11).fill(row({})), row({ 1: '@', 5: 'e', 30: 'K', 34: 'D' }), row({}, '#'), row({}, '#')].join('\n');
  const apple = parseSprite(APPLE, 'apple');
  it('꾸밈 그림은 놓은 칸의 왼쪽 아래에 선다(한 점이 2px)', () => {
    const s = parseStage(MAP, { legend: { e: { type: 'deco', sprite: 'apple' } } }, { apple });
    expect(s.decos).toEqual([{ x: 150, y: 12 * 30 - 18, sprite: apple }]);
  });
  it('팩에 없는 그림 이름은 알려 준다', () => {
    expect(() => parseStage(MAP, { legend: { e: { type: 'deco', sprite: 'pear' } } }, { apple })).toThrow(/sprites 폴더에 없어요/);
    expect(() => parseStage(MAP, { legend: { e: { type: 'deco' } } }, { apple })).toThrow(/sprites 폴더에 없어요/);
    for (const bad of ['constructor', '__proto__', 'toString', 'Apple', '../apple']) expect(() => parseStage(MAP, { legend: { e: { type: 'deco', sprite: bad } } }, { apple })).toThrow(/sprites 폴더에 없어요/);
  });
});

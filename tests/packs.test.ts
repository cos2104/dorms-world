/**
 * 팩 검사(`npm run check:packs`, 빌드 때도 돈다). 모든 팩의 형식과 약속을 본다.
 * 막는 것: 형식 오류, 코드 파일, 바깥 주소, "정답/오답" 문구, 아무렇게나 누르는 봇이 깨 버리는 스테이지.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StageJson } from '../platform/stage';
import { readSprites, readStage } from './pack-io';
import { createWorld, step, type Pad } from '../platform/sim';

const root = fileURLToPath(new URL('../packs/', import.meta.url));
const FAMILIES = ['국어', '영어', '수학', '사회', '역사', '도덕·윤리', '과학', '정보', '기술·가정', '음악', '미술', '연극', '체육', '한문·외국어', '교양', '통합교과', '창의적 체험활동', '기타'];
const dirs = (p: string) => readdirSync(p).filter(n => statSync(join(p, n)).isDirectory());
const packs = dirs(root).flatMap(f => dirs(join(root, f)).map(n => ({ id: `${f}/${n}`, dir: join(root, f, n) })));
const walk = (p: string): string[] => readdirSync(p).flatMap(n => (statSync(join(p, n)).isDirectory() ? walk(join(p, n)) : [join(p, n)]));

describe('팩이 하나 이상 있다', () => { it('packs/', () => expect(packs.length).toBeGreaterThan(0)); });

describe.each(packs)('팩 $id', ({ id, dir }) => {
  const meta = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'));
  const files = walk(dir);

  it('팩 정보가 약속대로다', () => {
    expect(id).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
    expect(meta.id, 'pack.json 의 id 는 폴더 이름과 같아야 해요').toBe(id);
    expect(meta.name.length, '이름은 40자까지').toBeLessThanOrEqual(40);
    expect(meta.name.length).toBeGreaterThan(0);
    expect(meta.tagline.length, '한 줄 설명은 30자까지').toBeLessThanOrEqual(30);
    expect(FAMILIES, `family 는 오락실 교과 묶음 이름이어야 해요: ${meta.family}`).toContain(meta.family);
    expect(String(meta.educationalIntent ?? '').length, '교육적 의도를 적어 주세요').toBeGreaterThan(0);
    expect(String(meta.creator?.nickname ?? '').length, '만든 사람 닉네임이 필요해요').toBeGreaterThan(0);
    expect(meta.players.min).toBeGreaterThanOrEqual(2);
    expect(meta.players.max).toBeLessThanOrEqual(30);
    expect(meta.players.min).toBeLessThanOrEqual(meta.players.max);
    expect(meta.stages.length).toBeGreaterThan(0);
    for (const s of meta.stages) { expect(s.difficulty).toBeGreaterThanOrEqual(1); expect(s.difficulty).toBeLessThanOrEqual(5); expect(String(s.name).length).toBeGreaterThan(0); }
    if (meta.creator.avatar) expect(existsSync(join(dir, meta.creator.avatar)), '프로필 그림 파일이 없어요').toBe(true);
    expect(existsSync(join(dir, 'DESIGN.md')), '설계서(DESIGN.md)가 필요해요').toBe(true);
    for (const k of ['name', 'tagline', 'description', 'educationalIntent']) { expect(typeof meta[k], `${k} 는 글자여야 해요`).toBe('string'); expect(meta[k], `${k} 에 판정 문구는 쓸 수 없어요`).not.toMatch(/정답|오답/); }
    for (const s of meta.stages) expect(String(s.name)).not.toMatch(/정답|오답/);
  });

  it('지도와 설정만 있다(코드 파일, 바깥 주소 없음)', () => {
    for (const f of files) {
      expect(f, '팩 폴더에는 코드 파일을 둘 수 없어요').not.toMatch(/\.(ts|tsx|js|mjs|cjs|html|wasm)$/);
      if (/\.(json|txt)$/.test(f)) expect(readFileSync(f, 'utf8'), `바깥 주소는 넣을 수 없어요: ${f}`).not.toMatch(/https?:\/\/|\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    }
  });

  it('글자 그림이 화풍 약속대로다(정해진 물감, 크기, 남색 윤곽)', () => { expect(() => readSprites(dir)).not.toThrow(); });

  describe.each(meta.stages as { file: string; name: string }[])('스테이지 $file', ({ file }) => {
    const def: StageJson = JSON.parse(readFileSync(join(dir, 'stages', `${file}.json`), 'utf8'));
    const load = () => readStage(dir, file).stage;

    it('지도를 읽을 수 있다', () => { expect(() => load()).not.toThrow(); });

    it('판정 문구가 없다("정답", "오답")', () => {
      const words = [def.hint ?? '', ...Object.values(def.legend ?? {}).flatMap(l => (l.type === 'sign' ? l.texts ?? [] : []))].join(' ');
      expect(words).not.toMatch(/정답|오답|맞았|틀렸/);
    });

    it('시작하면 모든 도름이가 움직일 수 있다(끼인 채 시작하지 않는다)', () => {
      for (const people of [2, 8, 30]) {
        const w = createWorld(load(), Array.from({ length: people }, () => ({ color: '#F4F7FF' })));
        for (let f = 0; f < 30; f++) step(w, [], 1 / 60);                       // 내려설 시간
        const x0 = w.players.map(p => p.x);
        const moved = w.players.map(() => false);
        for (const m of [1, -1] as const) for (let f = 0; f < 30; f++) { step(w, w.players.map(() => ({ m, j: false })), 1 / 60); w.players.forEach((p, i) => { if (Math.abs(p.x - x0[i]) > 1) moved[i] = true; }); }
        expect(moved.every(Boolean), `${people}명 가운데 시작부터 못 움직이는 도름이가 있어요`).toBe(true);
      }
    });

    it('아무렇게나 누르는 봇은 깨지 못한다', () => {
      let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (const people of [2, 8]) for (let trial = 0; trial < 3; trial++) {
        const w = createWorld(load(), Array.from({ length: people }, () => ({ color: '#F4F7FF' })));
        let pads: Pad[] = [];
        for (let f = 0; f < 45 * 60 && !w.won; f++) {
          if (f % 20 === 0) pads = w.players.map(() => ({ m: ([-1, 0, 1, 1] as const)[Math.floor(rnd() * 4)], j: rnd() < 0.4, a: rnd() < 0.5 }));
          step(w, pads, 1 / 60);
        }
        expect(w.won, `${people}명이 아무렇게나 눌러도 깨졌어요`).toBe(false);
      }
    });
  });
});

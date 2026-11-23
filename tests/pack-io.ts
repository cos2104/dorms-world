/** 시험에서 팩 폴더를 읽는 도구(글자 그림 포함). 팩 안의 파일은 읽기만 하고 실행하지 않는다. */
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStage, type StageJson } from '../platform/stage';
import { parseSprite, type Sprite } from '../platform/sprite';

/** 팩의 JSON 을 읽는다. 윈도우 메모장이 붙이는 BOM 을 걷는다(판과 보내기 명령도 같은 일을 한다). */
export const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));

export function readSprites(dir: string): Record<string, Sprite> {
  const folder = join(dir, 'sprites'), out: Record<string, Sprite> = {};
  if (!existsSync(folder) || !lstatSync(folder).isDirectory()) return out;
  for (const f of readdirSync(folder)) if (/^[a-z0-9-]+\.txt$/.test(f) && lstatSync(join(folder, f)).isFile()) { const name = f.replace(/\.txt$/, ''); out[name] = parseSprite(readFileSync(join(folder, f), 'utf8'), name); }
  return out;
}

export function readStage(dir: string, file: string) {
  if (!/^\d{2}$/.test(file)) throw new Error(`스테이지 파일 이름은 두 자리 숫자여야 해요("${file}")`);
  const def: StageJson = readJson(join(dir, 'stages', `${file}.json`));
  return { def, stage: parseStage(readFileSync(join(dir, 'stages', `${file}.map.txt`), 'utf8'), def, readSprites(dir)) };
}

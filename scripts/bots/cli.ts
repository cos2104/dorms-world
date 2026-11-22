/**
 * 봇으로 끝까지 깨 보기: npm run play:bots -- <교과>/<팩> [--players 8] [--stage 01]
 * 팩의 스테이지마다 봇 여럿이 판을 그대로 굴려 끝까지 깨 보고, 스테이지마다 한 줄로 알려 준다.
 * 인원을 안 적으면 팩의 가장 적은 인원, 8명, 30명(팩이 받는 만큼)으로 차례로 해 본다.
 * 팩 폴더의 파일은 읽기만 하고 실행하지 않는다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStage } from '../../tests/pack-io';
import { playStage, peopleFor, type StageRun } from './engine';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (name: string) => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : undefined; };
const id = args.find((a, k) => !a.startsWith('--') && !(k > 0 && args[k - 1].startsWith('--')));
const say = (s: string) => process.stdout.write(s + '\n');

if (!id || !/^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/.test(id)) {
  say('쓰는 법: npm run play:bots -- <교과>/<팩> [--players 8] [--stage 01]');
  say('예: npm run play:bots -- etc/tutorial --players 30');
  process.exit(2);
}
const dir = join(fileURLToPath(new URL('../../packs/', import.meta.url)), id);
if (!existsSync(join(dir, 'pack.json'))) { say(`packs/${id}/pack.json 이 없어요. 교과/팩 이름을 확인해 주세요.`); process.exit(2); }
const meta = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as { name: string; players: { min: number; max: number }; stages: { file: string; name: string }[] };

const wantPeople = opt('--players');
if (wantPeople != null && !/^\d{1,2}$/.test(wantPeople)) { say('--players 에는 2~30 사이 수를 적어 주세요.'); process.exit(2); }
const people = wantPeople != null ? [Number(wantPeople)] : peopleFor(meta.players);
for (const n of people) if (n < 1 || n > 30) { say('--players 에는 2~30 사이 수를 적어 주세요.'); process.exit(2); }
const onlyStage = opt('--stage');
const stages = meta.stages.filter(s => !onlyStage || s.file === onlyStage);
if (!stages.length) { say(`스테이지 ${onlyStage} 가 pack.json 에 없어요.`); process.exit(2); }

say(`「${meta.name}」 봇으로 끝까지 깨 보기 (${people.map(n => `${n}명`).join(', ')})`);
const label: Record<StageRun['verdict'], string> = { pass: '깼어요', stuck: '못 깼어요', unknown: '확인 못 함' };
let stuck = 0, unknown = 0;
for (const s of stages) {
  let stage;
  try { stage = readStage(dir, String(s.file)).stage; }
  catch (e) { say(`스테이지 ${s.file} 「${s.name}」: 지도를 읽지 못했어요. ${(e as Error).message}`); stuck++; continue; }
  for (const n of people) {
    const r = playStage(stage, n);
    if (r.verdict === 'stuck') stuck++;
    if (r.verdict === 'unknown') unknown++;
    const detail = r.verdict === 'pass' ? `게임 속 ${r.seconds}초, 봇이 한 일: ${r.steps.join(', ')}` : r.note.replace(/^\d+명: /, '');
    say(`스테이지 ${s.file} 「${s.name}」 ${n}명: ${label[r.verdict]}. ${detail}`);
  }
}
say(stuck ? `봇이 못 깬 곳이 ${stuck}곳 있어요. 위 줄이 말한 장치를 고친 뒤 다시 돌려 보세요.` : unknown ? `봇이 확인하지 못한 곳이 ${unknown}곳 있어요. 그 인원은 사람이 직접 깨 보세요.` : '모든 스테이지를 끝까지 깼어요.');
process.exit(stuck ? 1 : 0);

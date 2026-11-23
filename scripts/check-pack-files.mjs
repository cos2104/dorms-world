// 팩 폴더에 허락된 파일만 있는지 본다. 팩 안의 어떤 파일도 실행하거나 import 하지 않고 이름과 종류만 본다.
// 팩 검사(vitest)와 빌드의 맨 앞에서 돈다: node scripts/check-pack-files.mjs [packs 폴더]
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// .pathname 은 윈도우(C:\…)와 한글 폴더에서 틀린 경로가 된다. fileURLToPath 로 바꾼다
const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../packs/', import.meta.url)));
const problems = [];
const NAME = /^[a-z0-9-]{1,40}$/;   // 교과·팩 폴더 이름은 40자까지(도름스로 보내는 길과 같은 한도)
const STAGE = /^\d{2}\.(json|map\.txt)$/;
const PIC = /^[a-z0-9-]+\.(png|webp)$/;
const ART = /^[a-z0-9-]{1,40}\.txt$/;   // 그림 이름도 40자까지
const MAX_BYTES = 300 * 1024;

function entries(dir) {
  return readdirSync(dir).map(name => ({ name, path: join(dir, name), stat: lstatSync(join(dir, name)) }));
}
function plainFile(e, where) {
  if (e.stat.isSymbolicLink()) { problems.push(`${where}/${e.name}: 바로 가기(링크)는 둘 수 없어요.`); return false; }
  if (!e.stat.isFile()) { problems.push(`${where}/${e.name}: 여기에는 폴더를 둘 수 없어요.`); return false; }
  if (e.stat.size > MAX_BYTES) { problems.push(`${where}/${e.name}: 파일이 너무 커요(300KB까지).`); return false; }
  return true;
}

for (const fam of entries(root)) {
  if (fam.stat.isSymbolicLink() || !fam.stat.isDirectory() || !NAME.test(fam.name)) { problems.push(`packs/${fam.name}: 교과 폴더 이름은 영문 소문자, 숫자, 줄표만 쓸 수 있어요.`); continue; }
  for (const pack of entries(fam.path)) {
    const where = `packs/${fam.name}/${pack.name}`;
    if (pack.stat.isSymbolicLink() || !pack.stat.isDirectory() || !NAME.test(pack.name)) { problems.push(`${where}: 팩 폴더 이름은 영문 소문자, 숫자, 줄표만 쓸 수 있어요.`); continue; }
    let hasMeta = false;
    for (const e of entries(pack.path)) {
      if (e.name === 'stages') {
        if (e.stat.isSymbolicLink() || !e.stat.isDirectory()) { problems.push(`${where}/stages: 폴더여야 해요.`); continue; }
        for (const s of entries(e.path)) {
          if (!STAGE.test(s.name)) { problems.push(`${where}/stages/${s.name}: 스테이지 파일은 01.json, 01.map.txt 같은 이름만 둘 수 있어요.`); continue; }
          plainFile(s, `${where}/stages`);
        }
      } else if (e.name === 'sprites') {
        if (e.stat.isSymbolicLink() || !e.stat.isDirectory()) { problems.push(`${where}/sprites: 폴더여야 해요.`); continue; }
        const arts = entries(e.path);
        if (arts.length > 40) problems.push(`${where}/sprites: 그림은 40개까지예요.`);
        for (const s of arts) {
          if (!ART.test(s.name)) { problems.push(`${where}/sprites/${s.name}: 그림 파일은 영문 소문자, 숫자, 줄표 이름의 .txt 만 둘 수 있어요.`); continue; }
          plainFile(s, `${where}/sprites`);
        }
      } else if (e.name === 'pack.json') { hasMeta = plainFile(e, where); }
      else if (e.name === 'DESIGN.md' || e.name === 'things.json' || PIC.test(e.name)) plainFile(e, where);
      else problems.push(`${where}/${e.name}: 팩에는 pack.json, DESIGN.md, things.json, stages 폴더, sprites 폴더, 프로필 그림(png·webp)만 둘 수 있어요.`);
    }
    if (!hasMeta) { problems.push(`${where}: pack.json 이 없어요.`); continue; }
    // pack.json 이 가리키는 파일 이름도 팩 폴더 밖으로 나가지 못하게 모양을 본다(글자로만 읽는다).
    try {
      const meta = JSON.parse(readFileSync(join(pack.path, 'pack.json'), 'utf8').replace(/^\uFEFF/, ''));
      for (const s of Array.isArray(meta.stages) ? meta.stages : []) if (typeof s?.file !== 'string' || !/^\d{2}$/.test(s.file)) problems.push(`${where}/pack.json: stages 의 file 은 "01" 같은 두 자리 숫자여야 해요.`);
      const av = meta.creator?.avatar;
      if (av != null && (typeof av !== 'string' || !PIC.test(av))) problems.push(`${where}/pack.json: avatar 는 팩 폴더 안의 png·webp 파일 이름이어야 해요.`);
    } catch { problems.push(`${where}/pack.json: 읽을 수 없어요(JSON 형식 확인).`); }
  }
}

if (problems.length) { console.error('팩 파일 검사에서 걸렸어요:\n' + problems.map(p => ' - ' + p).join('\n')); process.exit(1); }
console.log('팩 파일 검사 통과');

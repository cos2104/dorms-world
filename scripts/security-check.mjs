// 도름스체크(교사 앱 점검 코치)로 이 저장소를 훑는다: npm run check:security [-- --url <떠 있는 주소>]
// 형 지시(2026-11-18): "도름스체크 보안 검사 통과를 반드시 하도록 하네스 되어야해. 그리고 내가 머지할떄도 도름스체크도 돌려야 하고 말이야"
// 도름스체크는 점수와 소견을 주는 코치라 스스로는 늘 0으로 끝난다. 여기서 결과 파일을 읽어 '실패'가 하나라도 있으면 멈춘다.
// 주소 없이 돌리면 코드만 본다(비밀값, 위험 코드, 번들, 헤더 설정). 운영자는 병합 전에 --url 로 떠 있는 사이트까지 잰다.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const PINNED = 'https://github.com/shinnanchanguk/dorms-check/archive/25425274657fcab41ceb8e356d239e72757010b9.tar.gz';   // 도름스 사이트가 안내하는 것과 같은 판에 못 박아 둔다(올릴 때는 내용을 읽어 본 뒤에)
const win = process.platform === 'win32';
const at = process.argv.indexOf('--url'), url = at >= 0 ? String(process.argv[at + 1] ?? '') : '';
if (url && !/^https:\/\/[a-z0-9.-]+(\/[\w./-]*)?$/i.test(url)) { console.error('주소 모양이 달라요. 예: --url https://dorms-world.vercel.app/world/'); process.exit(1); }
const args = ['-y', PINNED, 'scan', ...(url ? ['--url', url] : ['--code-only'])];
const r = spawnSync(win ? 'npx.cmd' : 'npx', args, { encoding: 'utf8', shell: win, timeout: 180_000 });
if (r.error || r.status !== 0) { console.error(`도름스체크를 돌리지 못했어요(${r.error?.message ?? `끝난 값 ${r.status}`}). 인터넷을 확인하고 다시 해 주세요.`); process.exit(1); }
if (!existsSync('.dorms-check/scan.json')) { console.error('도름스체크 결과 파일이 없어요.'); process.exit(1); }
let results = [];
try { results = JSON.parse(readFileSync('.dorms-check/scan.json', 'utf8')).results ?? []; } catch { console.error('도름스체크 결과를 읽지 못했어요.'); process.exit(1); }
const plain = v => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, 200);
const failed = results.filter(x => x?.status === 'fail');
const count = s => results.filter(x => x?.status === s).length;
console.log(`도름스체크(${url ? '떠 있는 사이트까지' : '코드만'}): 통과 ${count('pass')} · 실패 ${failed.length} · 살펴볼 것 ${count('judge') + count('info')} · 해당 없음 ${count('na')}`);
for (const x of failed) console.log(`  걸린 것: ${plain(x.id)} ${plain(x.title ?? x.message)}${x.evidence ? ` (${plain(x.evidence)})` : ''}`);
if (failed.length) { console.error('\n도름스체크에서 걸린 것이 있어요. .dorms-check/REPORT.md 를 읽고 고친 뒤 다시 해 주세요.'); process.exit(1); }
console.log('걸린 것이 없어요. 자세한 것은 .dorms-check/REPORT.md');

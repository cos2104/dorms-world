// 도름스에서 운영자가 승인한 팩을 가져와 이 저장소에 싣는다(GitHub Actions 의 '승인된 팩 싣기'가 돌린다. 사람이 손으로 돌리지 않는다).
// 차례: 도름스에서 승인된 요청 받기 → 팩 파일만 써넣기 → 가지에 올리고 요청(PR) 열기 → 자동 검사 → 병합 → 배포 확인 → 도름스에 결과 알리기.
// 팩의 글은 모두 남이 쓴 것이다. 정해진 경로에만 쓰고, 그 글을 명령으로 돌리지 않는다(셸을 거치지 않고 인자로만 넘긴다).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ORIGIN = (process.env.DORMS_ORIGIN || 'https://dorms.school').replace(/\/+$/, '');
const SECRET = process.env.WORLD_PUBLISH_SECRET || '';
const REPO = process.env.GITHUB_REPOSITORY || 'shinnanchanguk/dorms-world';
const AUTHOR = process.env.PUBLISH_AUTHOR || '';   // "이름 <메일>". 배포가 막히지 않게 저장소 주인 이름으로 커밋하고, 만든 선생님은 커밋 글에 적는다
const ID_OK = /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_OK = /^(pack\.json|DESIGN\.md|stages\/\d{2}\.(json|map\.txt)|sprites\/[a-z0-9-]{1,40}\.txt)$/;
const MAX_FILE = 100_000, MAX_TOTAL = 300_000, MAX_COUNT = 120;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryly = (cmd, args) => { try { return sh(cmd, args); } catch { return ''; } };
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
export const shaOf = files => { const h = createHash('sha256'); for (const k of Object.keys(files).sort()) h.update(`${k}\0${files[k]}\0`); return h.digest('hex'); };

/** 받은 항목이 실어도 되는 모양인지 본다. 문제가 있으면 까닭을 돌려준다(없으면 빈 글). */
export function problemOf(item) {
  if (!item || typeof item !== 'object') return '항목 모양이 달라요';
  if (!UUID.test(String(item.id))) return '요청 번호 모양이 달라요';
  if (!ID_OK.test(String(item.packId))) return '팩 이름 모양이 달라요';
  if (!Number.isInteger(item.revision) || item.revision < 1) return '판 번호가 없어요';
  if (item.mode !== 'create' && item.mode !== 'update') return '새 팩인지 고친 판인지 알 수 없어요';
  const files = item.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return '파일이 없어요';
  const names = Object.keys(files);
  if (!names.length || names.length > MAX_COUNT) return '파일 수가 맞지 않아요';
  let total = 0;
  for (const n of names) {
    if (!FILE_OK.test(n)) return `둘 수 없는 파일이에요: ${n.slice(0, 80)}`;
    const body = files[n];
    if (typeof body !== 'string' || body.includes('\0')) return `글 파일이 아니에요: ${n}`;
    const size = Buffer.byteLength(body);
    if (size > MAX_FILE) return `파일이 너무 커요: ${n}`;
    total += size;
  }
  if (total > MAX_TOTAL) return '팩이 너무 커요';
  if (!files['pack.json'] || !files['DESIGN.md']) return 'pack.json 이나 DESIGN.md 가 없어요';
  if (shaOf(files) !== item.sha) return '운영자가 살펴본 판과 받은 파일이 달라요';
  let meta;
  try { meta = JSON.parse(files['pack.json']); } catch { return 'pack.json 을 읽지 못했어요'; }
  if (!meta || meta.id !== item.packId) return 'pack.json 의 id 가 팩 이름과 달라요';
  return '';
}

async function dorms(method, body) {
  const res = await fetch(`${ORIGIN}/api/world/outbox`, { method, redirect: 'error', headers: { authorization: `Bearer ${SECRET}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`도름스 응답 ${res.status}`);
  return res.json();
}
const report = async (item, rest) => {
  for (let i = 0; i < 4; i++) {
    try { await dorms('POST', { id: item.id, revision: item.revision, sha: item.sha, ...rest }); return true; } catch (err) { console.log(`  도름스에 알리지 못했어요(${err.message}). 다시 해 봐요.`); await sleep(5000 * (i + 1)); }
  }
  return false;
};

async function waitCheck(branch, head) {
  // 자동 검사를 이 가지에서 돌리고 끝날 때까지 기다린다(이 작업이 연 요청에는 검사가 저절로 붙지 않아서 직접 돌린다)
  sh('gh', ['workflow', 'run', 'pack-check.yml', '-R', REPO, '--ref', branch]);
  const until = Date.now() + 12 * 60_000;
  while (Date.now() < until) {
    await sleep(10_000);
    const out = tryly('gh', ['run', 'list', '-R', REPO, '--workflow', 'pack-check.yml', '--branch', branch, '--event', 'workflow_dispatch', '--limit', '5', '--json', 'databaseId,status,conclusion,headSha']);
    let runs = [];
    try { runs = JSON.parse(out || '[]'); } catch { /* 잠깐 못 읽으면 다시 */ }
    const mine = runs.find(r => r.headSha === head);
    if (mine?.status === 'completed') return { ok: mine.conclusion === 'success', run: mine.databaseId };
  }
  return { ok: false, run: 0, late: true };
}
async function waitDeploy(commit) {
  // 배포가 끝났는지 커밋에 붙는 상태로 본다. 6분 안에 안 보이면 그대로 알린다(배포는 따로 이어진다)
  const until = Date.now() + 6 * 60_000;
  while (Date.now() < until) {
    await sleep(10_000);
    const out = tryly('gh', ['api', `repos/${REPO}/commits/${commit}/status`, '--jq', '[.statuses[] | select(.context | test("vercel"; "i")) | .state] | first // ""']);
    if (out === 'success') return 'ready';
    if (out === 'failure' || out === 'error') return 'failed';
  }
  return 'unknown';
}

async function publish(item) {
  const [subject, pack] = item.packId.split('/'), dir = join('packs', subject, pack), branch = `pack/${subject}--${pack}`;
  const title = clean(item.title, 60) || item.packId, who = clean(item.author, 30) || '도름스 선생님';
  sh('git', ['fetch', '-q', 'origin', 'main']);
  sh('git', ['checkout', '-q', '-B', branch, 'origin/main']);
  const exists = existsSync(join(dir, 'pack.json'));
  if (item.mode === 'create' && exists) return { result: 'failed', reason: `${item.packId} 는 이미 있는 팩 이름이에요. 폴더 이름을 바꿔 다시 보내 달라고 알려 주세요.` };
  if (item.mode === 'update' && !exists) return { result: 'failed', reason: `${item.packId} 를 고친 판인데 실려 있는 팩이 없어요.` };
  rmSync(dir, { recursive: true, force: true });
  for (const [name, body] of Object.entries(item.files)) { const to = join(dir, name); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, body); }
  // 만든 사람 사진은 팩에 넣지 않는다: 얼굴일 수 있는 사진을 공개 저장소 기록에 영영 남기지 않으려는 것이고, 운영자가 살펴본 판에도 들어 있지 않다
  sh('git', ['add', '-A', '--', dir]);
  if (!tryly('git', ['status', '--porcelain', '--', dir])) return { result: 'published', commit: sh('git', ['rev-parse', 'origin/main']), same: true };   // 이미 같은 내용이 실려 있다(지난번에 알리기만 실패)
  const message = `${item.mode === 'create' ? 'Add' : 'Update'} pack ${item.packId} (request ${item.number})\n\n${title}\n만든 사람: ${who} (도름스)\n도름스 요청 ${item.number}번, ${item.revision}번째 판. 운영자가 살펴보고 승인함.`;
  sh('git', ['-c', 'user.name=dorms-world', '-c', 'user.email=dorms-world@users.noreply.github.com', 'commit', '-q', ...(AUTHOR ? ['--author', AUTHOR] : []), '-m', message]);
  const head = sh('git', ['rev-parse', 'HEAD']);
  sh('git', ['push', '-q', '--force', 'origin', `${branch}:${branch}`]);
  const body = `도름스에서 받은 요청 ${item.number}번이에요(${item.revision}번째 판).\n\n- 팩: \`${item.packId}\`\n- 만든 사람: ${who} (도름스)\n- 운영자가 도름스에서 직접 해 보고 승인했어요.\n\n이 요청은 '승인된 팩 싣기' 작업이 자동으로 열었고, 검사를 통과하면 자동으로 병합해요.`;
  let pr = tryly('gh', ['pr', 'list', '-R', REPO, '--head', branch, '--state', 'open', '--json', 'number', '--jq', '.[0].number // ""']);
  if (!pr) { sh('gh', ['pr', 'create', '-R', REPO, '--base', 'main', '--head', branch, '--title', `[팩] ${title} (${item.packId})`, '--body', body]); pr = sh('gh', ['pr', 'list', '-R', REPO, '--head', branch, '--state', 'open', '--json', 'number', '--jq', '.[0].number']); }
  const check = await waitCheck(branch, head);
  if (!check.ok) {
    const why = check.late ? '자동 검사가 12분 안에 끝나지 않았어요.' : `자동 검사에서 걸렸어요(운영 판 기준). ${clean(tryly('gh', ['run', 'view', String(check.run), '-R', REPO, '--log-failed']).split('\n').filter(l => /✗|×|FAIL|걸렸|어요|Error/.test(l)).slice(0, 4).map(l => l.split('\t').pop()).join(' / '), 380)}`;
    tryly('gh', ['pr', 'close', pr, '-R', REPO, '--delete-branch', '--comment', why.slice(0, 500)]);
    return { result: 'failed', reason: why.slice(0, 500) };
  }
  sh('gh', ['pr', 'merge', pr, '-R', REPO, '--squash', '--match-head-commit', head, '--delete-branch']);
  let commit = '';
  for (let i = 0; i < 12 && !/^[0-9a-f]{40}$/.test(commit); i++) { await sleep(2500); commit = tryly('gh', ['pr', 'view', pr, '-R', REPO, '--json', 'mergeCommit', '--jq', '.mergeCommit.oid // ""']); }
  if (!/^[0-9a-f]{40}$/.test(commit)) return { result: 'failed', reason: '병합은 했는데 실린 커밋을 찾지 못했어요. 저장소를 확인해 주세요.' };
  const deploy = await waitDeploy(commit);
  console.log(`  병합 ${commit.slice(0, 7)}, 배포 ${deploy}`);
  if (deploy === 'failed') return { result: 'failed', reason: `병합(${commit.slice(0, 7)})은 됐는데 배포가 실패했어요. 배포 기록을 확인해 주세요.` };
  return { result: 'published', commit, pr: Number(pr) };
}

async function main() {
  if (!SECRET) { console.log('WORLD_PUBLISH_SECRET 이 없어 아무것도 하지 않아요.'); return; }
  const got = await dorms('GET');
  const items = Array.isArray(got.items) ? got.items.slice(0, 3) : [];
  if (!items.length) { console.log('승인돼 기다리는 팩이 없어요.'); return; }
  let bad = 0;
  for (const item of items) {
    console.log(`요청 ${Number(item?.number) || '?'}번 ${ID_OK.test(String(item?.packId)) ? item.packId : ''}`);
    const problem = problemOf(item);
    let out;
    if (problem) out = { result: 'failed', reason: `실을 수 없는 모양이에요: ${problem}` };
    else {
      try { out = await publish(item); }
      catch (err) { out = { result: 'failed', reason: `싣다가 막혔어요: ${clean(String(err.stderr || err.message), 300)}` }; }
    }
    console.log(`  결과 ${out.result}${out.reason ? `: ${out.reason}` : ''}`);
    if (UUID.test(String(item?.id))) { const { same, ...rest } = out; if (!(await report(item, rest))) bad++; }
    if (out.result !== 'published') bad++;
    tryly('git', ['checkout', '-q', '--detach', 'origin/main']);
  }
  if (bad) process.exitCode = 1;
}
if (import.meta.url === `file://${process.argv[1]}`) await main();

// 만든 팩을 요청(PR)으로 올린다: npm run submit -- <교과>/<팩>
// 하는 일: 검사 → 무엇이 바뀌었는지 가르기 → 내 GitHub 계정의 사본(fork)에 올리기 → 도름스 월드에 요청 만들기.
// 이미 올린 요청이 있으면 같은 요청에 덧붙인다. 팩 폴더와(새 장치를 더했다면) 판 파일만 올리고 다른 파일은 올리지 않는다.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UPSTREAM = 'shinnanchanguk/dorms-world';
const id = process.argv[2] ?? '';
const say = msg => console.log(msg);
const stop = (msg, code = 1) => { console.error('\n' + msg); process.exit(code); };
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryRun = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }; };

if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(id)) stop('어느 팩을 올릴지 적어 주세요. 예: npm run submit -- science/digestion');
const dir = `packs/${id}`;
if (!existsSync(join(dir, 'pack.json'))) stop(`${dir}/pack.json 이 없어요. 팩 폴더 이름을 확인해 주세요.`);
const meta = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'));
if (meta.id !== id) stop(`pack.json 의 id("${meta.id}")가 폴더 이름(${id})과 달라요.`);

// 1. 검사(통과해야 올린다)
say('1/4 검사하는 중이에요(팩 검사, 전체 시험, 빌드).');
for (const [label, args] of [['팩 검사', ['run', 'check:packs']], ['전체 시험', ['test']], ['빌드', ['run', 'build']]]) {
  const r = spawnSync('npm', args, { encoding: 'utf8' });
  if (r.status !== 0) stop(`${label}에서 걸렸어요. 아래를 고친 뒤 다시 올려 주세요.\n\n${(r.stdout + r.stderr).split('\n').filter(l => /✗|×|FAIL|Error|걸렸|어요|→/.test(l)).slice(0, 25).join('\n')}`);
}

// 2. 무엇이 바뀌었나(운영 저장소의 지금 모습과 견준다)
say('2/4 바뀐 파일을 가르는 중이에요.');
if (!tryRun('git', ['remote', 'get-url', 'upstream']).ok) {
  const origin = tryRun('git', ['remote', 'get-url', 'origin']).out;
  if (new RegExp(`[/:]${UPSTREAM}(\\.git)?$`).test(origin)) run('git', ['remote', 'add', 'upstream', origin]);
  else run('git', ['remote', 'add', 'upstream', `https://github.com/${UPSTREAM}.git`]);
}
run('git', ['fetch', '-q', 'upstream', 'main']);
const changed = [...new Set([
  ...run('git', ['diff', '--name-only', 'upstream/main', '--']).split('\n'),
  ...run('git', ['ls-files', '--others', '--exclude-standard']).split('\n'),
])].filter(Boolean);
const mine = changed.filter(f => f.startsWith(dir + '/'));
const boardOk = /^(platform\/|tests\/|kit\/STAGE_FORMAT\.md$|kit\/patterns\/seeds\.md$|packs\/etc\/tutorial\/)/;
const board = changed.filter(f => !f.startsWith(dir + '/') && boardOk.test(f));
const never = changed.filter(f => !f.startsWith(dir + '/') && !boardOk.test(f));
if (!mine.length) stop(`${dir} 에 바뀐 것이 없어요. 이미 실린 팩과 같아요.`);
if (never.length) say(`  올리지 않는 파일(팩이나 판이 아닌 것): ${never.slice(0, 6).join(', ')}${never.length > 6 ? ' …' : ''}`);
const kind = board.length ? '장치 추가(판 변경 포함)' : '팩만';
say(`  종류: ${kind}. 팩 파일 ${mine.length}개${board.length ? `, 판 파일 ${board.length}개` : ''}.`);

// 3. GitHub 준비
say('3/4 GitHub 에 올릴 준비를 해요.');
if (!tryRun('gh', ['--version']).ok) stop('GitHub 도구(gh)가 없어요. 설치한 뒤 다시 해 주세요.\n  맥: brew install gh\n  윈도우: winget install GitHub.cli\n그다음 한 번 로그인해요: gh auth login', 2);
if (!tryRun('gh', ['auth', 'status']).ok) stop('GitHub 에 로그인돼 있지 않아요. 터미널에서 gh auth login 을 실행해 로그인한 뒤 다시 해 주세요(브라우저가 열려요).', 2);
tryRun('gh', ['auth', 'setup-git']);   // git 이 GitHub 로그인을 그대로 쓰게 한다(안 하면 올릴 때 아이디와 비밀번호를 묻는다)
const login = run('gh', ['api', 'user', '--jq', '.login']);
const owner = UPSTREAM.split('/')[0];
let pushRemote = 'upstream', head = '';
const branch = `pack/${id.replace('/', '-')}`;
if (login !== owner) {
  const fork = tryRun('gh', ['repo', 'fork', UPSTREAM, '--remote=false', '--clone=false']);
  if (!fork.ok && !/already exists/i.test(fork.err + fork.out)) stop(`내 계정에 사본(fork)을 만들지 못했어요.\n${fork.err}`);
  const url = `https://github.com/${login}/dorms-world.git`;
  if (tryRun('git', ['remote', 'get-url', 'mine']).ok) run('git', ['remote', 'set-url', 'mine', url]); else run('git', ['remote', 'add', 'mine', url]);
  pushRemote = 'mine'; head = `${login}:${branch}`;
} else head = branch;

// 4. 올릴 파일만 담은 가지를 만들어 올린다(지금 작업 폴더는 건드리지 않게 임시 색인을 쓴다)
say('4/4 요청을 올려요.');
const files = [...mine, ...board];
const env = { ...process.env, GIT_INDEX_FILE: join(mkdtempSync(join(tmpdir(), 'world-submit-')), 'index') };
run('git', ['read-tree', 'upstream/main'], { env });
const existing = files.filter(f => existsSync(f)), gone = files.filter(f => !existsSync(f));
if (existing.length) run('git', ['add', '--', ...existing], { env });
if (gone.length) run('git', ['rm', '-q', '--cached', '--ignore-unmatch', '--', ...gone], { env });
const tree = run('git', ['write-tree'], { env });
const nick = String(meta.creator?.nickname ?? '').slice(0, 30);
const message = `Add pack ${id}: ${String(meta.name).slice(0, 60)}`;
const commit = run('git', ['commit-tree', tree, '-p', 'upstream/main', '-m', message]);
run('git', ['push', '-q', '--force', pushRemote, `${commit}:refs/heads/${branch}`]);

const stagesTable = (meta.stages ?? []).map(s => `| ${s.file} | ${s.name} | ${s.difficulty} |`).join('\n');
const body = `## 팩\n- 이름: ${meta.name}\n- 교과: ${meta.family}\n- 만든 사람(도름스 닉네임): ${nick}\n- 인원: ${meta.players?.min}~${meta.players?.max}명\n- 종류: ${kind}\n\n${meta.educationalIntent ?? ''}\n\n| 번호 | 스테이지 | 난이도 |\n|---|---|---|\n${stagesTable}\n\n설계서: \`${dir}/DESIGN.md\`\n${board.length ? `\n## 판에서 바뀐 파일\n${board.map(f => `- \`${f}\``).join('\n')}\n` : ''}\n## 올리기 전 확인\n- 팩 검사, 전체 시험, 빌드 통과\n- 만든 사람이 자기 컴퓨터 화면에서 직접 해 봄\n\n검토 화면: https://dorms-world.vercel.app/world/review/<번호>\n`;
const bodyFile = join(tmpdir(), `world-pr-${Date.now()}.md`); writeFileSync(bodyFile, body);
const title = `[팩] ${String(meta.name).slice(0, 40)} (${meta.family})`;
const found = tryRun('gh', ['pr', 'list', '--repo', UPSTREAM, '--head', branch, '--author', login, '--state', 'open', '--json', 'number,url', '--jq', '.[0].url // ""']);
let url = found.ok ? found.out : '';
if (url) { say('  이미 올린 요청이 있어 거기에 덧붙였어요.'); }
else {
  const made = tryRun('gh', ['pr', 'create', '--repo', UPSTREAM, '--head', head, '--base', 'main', '--title', title, '--body-file', bodyFile]);
  if (!made.ok) stop(`요청을 만들지 못했어요.\n${made.err}`);
  url = made.out.split('\n').pop();
}
say(`\n올렸어요: ${url}\n운영자에게 도름스 쪽지가 가요. 운영자가 직접 해 보고 승인하면 dorms.school/world 에 실려요.${board.length ? '\n판을 고친 파일이 들어 있어서 운영자가 코드를 살펴본 뒤에 실려요(조금 더 걸려요).' : ''}`);

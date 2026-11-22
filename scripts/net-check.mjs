// 온라인으로 함께 하기를 실제 브라우저 여러 대로 끝까지 돌려 본다.
//   node scripts/net-check.mjs                      방 서버(wrangler dev)와 개발 서버를 스스로 띄우고 끝나면 끈다
//   node scripts/net-check.mjs --site <주소> --room <주소>   이미 떠 있는 것을 쓴다(예: http://127.0.0.1:5325/world/ http://127.0.0.1:8791)
//   --shots 를 붙이면 1440 · 390 폭 화면도 .verify/shots/online-*.png(선생님 방은 teacher-*.png)로 찍는다. --only-shots 는 찍기만 한다.
//   --teacher-only 는 선생님 방과 횟수 제한만 본다(고치는 동안 빨리 돌려 보려고).
//   --room-port <번호> --site-port <번호> 로 스스로 띄우는 서버의 포트를 바꾼다(방 서버 번호 + 1 에는 도름스 흉내 서버가 뜬다).
// 브라우저 실행 파일은 PW_CHROME 으로 준다. 방 서버는 room-server/ 에서 npm i 를 한 번 해 두어야 한다.
// 선생님 방(출입증 · 닉네임 · 순위 · 쓰임 알림)과 주소마다의 횟수 제한은 방 서버를 스스로 띄울 때만 본다(시험용 비밀값과 흉내 서버 주소를 넣어 띄운다).
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const args = process.argv.slice(2), arg = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; }, flag = n => args.includes(`--${n}`);
const root = fileURLToPath(new URL('..', import.meta.url)), shotDir = `${root}.verify/shots/`;
const ROOM_PORT = Number(arg('room-port')) || 8793, SITE_PORT = Number(arg('site-port')) || 5327, MOCK_PORT = ROOM_PORT + 1;
/** 계약에 적힌 시험용 가짜 비밀값(운영 값이 아니다). 출입증은 도름스와 같은 식으로 여기서 만든다. */
const SECRET = 'test-secret-0123456789abcdef0123456789', TEACHER = '11111111-2222-4333-8444-555555555555';
const b64 = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function makePass(claims = {}, secret = SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64(JSON.stringify({ u: TEACHER, n: '창욱쌤', a: 1, iat: now - 60, exp: now - 60 + 12 * 3600, c: 1, ...claims }));
  return `v1.${body}.${b64(createHmac('sha256', secret).update(`v1.${body}`).digest())}`;
}
let SITE = arg('site'), ROOM = arg('room');
for (const [name, v] of [['site', SITE], ['room', ROOM]]) if (v && !/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}(\/[a-z/]*)?$/.test(v)) { console.error(`--${name} 는 이 컴퓨터의 주소만 받아요.`); process.exit(1); }
const kids = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(url, what) { for (let i = 0; i < 120; i++) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* 아직 */ } await sleep(500); } throw new Error(`${what} 가 뜨지 않았어요: ${url}`); }
function up(cmd, argv, cwd, env = {}) {
  const k = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; k.stdout.on('data', d => { out += d; }); k.stderr.on('data', d => { out += d; });
  k.on('exit', code => { if (code && !k.killed) console.error(`${cmd} 가 꺼졌어요(${code})\n${out.slice(-800)}`); });
  kids.push(k); return k;
}
const ownRoom = !ROOM, ownSite = !SITE;
// 도름스 흉내 서버: 방 서버가 순위와 쓰임을 적는 곳. 받은 것을 적어 두고, 화면이 순위를 읽을 때도 이것으로 답한다
const dorms = { ranks: [], uses: [], consents: [], denied: 0 };
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const ok = req.method === 'POST' && req.headers.authorization === `Bearer ${SECRET}`;
    let json = null; try { json = JSON.parse(body); } catch { /* 망가진 글 */ }
    if (!ok || !json) { dorms.denied++; res.writeHead(401).end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/ranks') { dorms.ranks.push(json); res.end(JSON.stringify({ ok: true, rank: dorms.ranks.filter(r => r.packId === json.packId && r.stage === json.stage && r.ms <= json.ms).length, best: true })); }
    else if (req.url === '/consents') { dorms.consents.push(json); res.end(JSON.stringify({ ok: true })); }
    else { dorms.uses.push(json); res.end(JSON.stringify({ ok: true, first: true })); }
  });
});
if (ownRoom) await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));
// 방 서버는 시험용 값으로 띄운다. gate 가 false 면 주소마다의 횟수 제한을 끈다(이 시험은 한 주소에서 방을 잇달아 만든다)
const roomUp = (gate = false) => up(`${root}room-server/node_modules/.bin/wrangler`, ['dev', '--port', String(ROOM_PORT), '--inspector-port', String(ROOM_PORT + 540), '--ip', '127.0.0.1',
  '--var', `WORLD_ROOM_SECRET:${SECRET}`, '--var', `RANKS_URL:http://127.0.0.1:${MOCK_PORT}/ranks`, '--var', `USES_URL:http://127.0.0.1:${MOCK_PORT}/uses`, '--var', `CONSENTS_URL:http://127.0.0.1:${MOCK_PORT}/consents`, '--var', `GATE_OFF:${gate ? '0' : '1'}`], `${root}room-server`, { WRANGLER_SEND_METRICS: 'false' });
let roomKid = null, BARE = '';
if (ownRoom) { ROOM = `http://127.0.0.1:${ROOM_PORT}`; roomKid = roomUp(); await waitFor(`${ROOM}/`, '방 서버'); }
if (ownSite) {
  SITE = `http://127.0.0.1:${SITE_PORT}/world/`; BARE = `http://127.0.0.1:${SITE_PORT + 1}/world/`;
  up(`${root}node_modules/.bin/vite`, ['--port', String(SITE_PORT), '--strictPort', '--host', '127.0.0.1'], root, { VITE_ROOM_URL: ROOM });
  up(`${root}node_modules/.bin/vite`, ['--port', String(SITE_PORT + 1), '--strictPort', '--host', '127.0.0.1'], root, { VITE_ROOM_URL: '' });   // 방 서버 주소 없이 지은 화면
  await waitFor(SITE, '개발 서버'); await waitFor(BARE, '개발 서버(방 서버 주소 없음)');
}
const ORIGIN = new URL(SITE).origin, WS = ROOM.replace(/^http/, 'ws');
const stopAll = () => { for (const k of kids) { try { k.kill('SIGTERM'); } catch { /* 이미 꺼짐 */ } } try { mock.close(); } catch { /* 이미 닫힘 */ } };
process.on('exit', stopAll); process.on('SIGINT', () => { stopAll(); process.exit(130); });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let bad = 0;
const ok = (name, pass, detail = '') => { console.log(`${pass ? 'OK    ' : 'FAILED'} ${name}${detail ? `: ${detail}` : ''}`); if (!pass) bad++; };
async function device(name, { w = 1280, h = 720, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  // 시험은 운영 도름스를 부르지 않는다: 순위 읽기는 흉내 서버가 받은 기록으로 답하고, 그 밖의 도름스 주소는 없는 것으로 친다
  await ctx.route('https://dorms.school/**', route => {
    const u = new URL(route.request().url()), cors = { 'access-control-allow-origin': '*' };
    if (u.pathname !== '/api/world/ranks') return route.fulfill({ status: 404, headers: cors, body: '' });
    const stages = {};
    for (const r of dorms.ranks.filter(x => x.packId === u.searchParams.get('pack'))) (stages[r.stage] ??= []).push({ title: r.title, ms: r.ms, players: r.players, teacher: '창욱쌤', at: '2026-11-22' });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ stages }) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e}`));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  const d = { name, ctx, page, w,
    open: async (path = '') => { await page.goto(SITE + path, { waitUntil: 'networkidle' }); await page.waitForSelector('.w-root'); },
    room: () => page.evaluate(() => window.__room?.() ?? null),
    net: () => page.evaluate(() => window.__net?.() ?? null),
    world: () => page.evaluate(() => { const w = window.__world?.(); return w ? { n: w.players.length, xs: w.players.map(p => Math.round(p.x * 10) / 10), ys: w.players.map(p => Math.round(p.y * 10) / 10), colors: w.players.map(p => p.color), carry: w.players.map(p => p.carry?.kind ?? null), inDoor: w.players.map(p => p.inDoor), lines: w.scales.map(s => s.lines), line: w.scales.map(s => s.line), solved: w.scales.map(s => s.solved), tilt: w.scales.map(s => s.tilt), key: [Math.round(w.key.x), Math.round(w.key.y), w.key.holder, w.key.used], open: w.doorOpen, won: w.won, cols: w.stage.cols, hint: w.stage.hint } : null; }),
    hold: async (code, ms) => { await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code); },
    shot: async (tag, kind = 'online') => { mkdirSync(shotDir, { recursive: true }); await sleep(250); await page.screenshot({ path: `${shotDir}${kind}-${tag}-${w}.png` }); },
    close: () => ctx.close(),
  };
  return d;
}
/** 방 만들기 창을 거쳐 방을 연다. 방 코드를 돌려준다. */
async function createRoom(d, { pub = false, big = false, shots = '', title = '', rank = false, kind = 'online' } = {}) {
  await d.page.getByRole('button', { name: '방 만들기' }).first().click();
  await d.page.waitForSelector('.w-dialog [data-make]');
  if (pub) await d.page.locator('.w-dialog [data-pub="1"]').click();
  if (big) await d.page.locator('.w-dialog [data-big="1"]').click();
  if (title) await d.page.locator('.w-dialog #w-title').fill(title);
  if (rank) await d.page.locator('.w-dialog [data-rank="1"]').click();
  if (shots) await d.shot(`${shots}create`, kind);
  await d.page.locator('.w-dialog [data-make]').click();
  await d.page.waitForSelector('.w-dialog [data-code]');
  const code = (await d.page.locator('.w-dialog [data-code]').textContent()).trim();
  if (shots) await d.shot(`${shots}invite-qr`, kind);
  await d.page.locator('.w-dialog [data-done]').click();
  await d.page.waitForSelector('.w-strip');
  return code;
}
async function joinByCode(d, code) {
  await d.page.locator('#w-code').fill(code);
  await d.page.getByRole('button', { name: '들어가기', exact: true }).first().click();
  await d.page.waitForFunction(() => window.__room?.()?.me >= 0, null, { timeout: 8000 });
}
async function pickStage(d, pack, index) {
  if (!d.page.url().includes(`g/${pack}`)) { await d.page.locator(`[data-open="${pack}"]`).click(); }
  await d.page.waitForSelector('[data-stage]');
  await d.page.locator('[data-stage]').nth(index).click();
  await d.page.waitForFunction(() => !!window.__world, null, { timeout: 8000 });
}
const until = async (fn, ms = 6000, every = 100) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };
const near = (a, b, tol) => a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
/** 화면도 창도 없는 손님(방 서버에 바로 붙는다). 사람이 많을 때를 흉내 낸다. */
function ghost(code, { view = 'play', send = true, mode = 'join' } = {}) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${WS}/room/${code}?mode=${mode}&view=${view}`, { headers: { Origin: ORIGIN } });
    const g = { ws, seat: -1, got: 0, bytes: 0, no: 0, timer: null, n: 0, hi: null, log: [] };
    ws.onmessage = e => {
      if (typeof e.data !== 'string') return;
      if (e.data.startsWith('{"t":"s"')) { g.got++; g.bytes += e.data.length; return; }
      const m = JSON.parse(e.data);
      g.log.push(m);
      if (m.t === 'no') { g.no = m.c; res(g); }
      if (m.t === 'hi') {
        g.seat = m.me; g.hi = m;
        if (send) g.timer = setInterval(() => { if (Math.random() < 0.2) g.n++; if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'p', m: [-1, 0, 1][Math.floor(Math.random() * 3)], j: Math.random() < 0.3 ? 1 : 0, a: 0, n: g.n })); }, 33);
        res(g);
      }
    };
    ws.onerror = () => rej(new Error('손님이 붙지 못했어요'));
    g.close = () => { clearInterval(g.timer); try { ws.close(); } catch { /* 이미 닫힘 */ } };
  });
}

const baseRun = !flag('only-shots') && !flag('teacher-only');
if (baseRun) {
  // ---------- 1. 방 만들기 → 코드로 들어오기 → 각자 움직이기 ----------
  let A = await device('A'), B = await device('B');
  const put2 = (d, i, x) => d.page.evaluate(([i, x]) => { const w = window.__world(), p = w.players[i]; p.x = x; p.vx = 0; }, [i, x]);
  await A.open(); await B.open();
  ok('온라인 들머리가 처음 화면에 있다', await A.page.locator('.w-online').count() === 1);
  // 창: Esc 와 바깥 누르기로 닫히고, 닫으면 창을 연 단추로 초점이 돌아간다. Tab 은 창 안을 돈다
  const opener = A.page.getByRole('button', { name: '방 만들기' }).first();
  await opener.click(); await A.page.waitForSelector('.w-dialog');
  const inside = async () => A.page.evaluate(() => !!document.activeElement?.closest('.w-dialog'));
  let kept = await inside();
  for (let i = 0; i < 9; i++) { await A.page.keyboard.press('Tab'); kept &&= await inside(); }
  await A.page.keyboard.press('Escape');
  ok('창은 Esc 로 닫히고 초점이 창을 연 단추로 돌아간다(Tab 은 창 안을 돈다)', kept && await A.page.locator('.w-dialog').count() === 0 && await A.page.evaluate(() => document.activeElement?.hasAttribute('data-room-new')));
  await opener.click(); await A.page.waitForSelector('.w-dialog');
  await A.page.mouse.click(8, 8);
  ok('창은 바깥을 누르면 닫힌다', await A.page.locator('.w-dialog').count() === 0);
  await opener.click(); await A.page.locator('.w-dialog [data-close]').click();
  ok('창은 닫기 단추로 닫힌다', await A.page.locator('.w-dialog').count() === 0 && (await A.room()) === null);
  const code = await createRoom(A);
  ok('방을 만들면 여섯 글자 코드가 나온다', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  ok('방을 만들면 주소에 방 코드가 붙는다', A.page.url().includes(`?room=${code}`));
  await joinByCode(B, code);
  ok('코드로 들어온 기기는 방장이 스테이지를 고를 때까지 기다린다', await B.page.locator('.w-wait').count() === 1 && (await B.room()).host === 0 && (await B.room()).me === 1);
  await pickStage(A, 'etc/tutorial', 0);
  ok('방장이 스테이지를 고르면 손님도 게임 화면으로 간다', !!(await until(async () => (await B.world())?.n === 2)));
  await sleep(700);                                     // 첫 그림(도름이 색 입히기)이 끝난 뒤에 잰다
  const s0 = await A.world();
  // 2번(손님)이 오른쪽에 서 있다: 손님은 오른쪽으로 0.7초, 방장은 그 뒤를 0.4초 따라간다(서로 막지 않게)
  await Promise.all([B.hold('ArrowRight', 700), A.hold('ArrowRight', 400)]);
  await sleep(400);
  const a1 = await A.world(), b1 = await B.world();
  const moved = [a1.xs[0] - s0.xs[0], a1.xs[1] - s0.xs[1]];
  // 기계가 바쁘면 프레임이 밀려 덜 가기도 한다: 넉넉히 보되, 오래 누른 쪽이 더 멀리 갔는지와 너무 많이 가지 않았는지를 본다
  ok('실제 키로 두 도름이가 각자 움직인다', moved[0] > 30 && moved[0] < 95 && moved[1] > 60 && moved[1] < 147 && moved[1] > moved[0] + 15, `방장 +${Math.round(moved[0])}px(0.4초, 다 가면 70), 손님 +${Math.round(moved[1])}px(0.7초, 다 가면 122)`);
  ok('두 화면의 도름이 자리가 같다', near(a1.xs, b1.xs, 2) && near(a1.ys, b1.ys, 2), `방장 화면 ${JSON.stringify(a1.xs)} / 손님 화면 ${JSON.stringify(b1.xs)}`);
  ok('색은 들어온 차례대로다(하양, 분홍)', a1.colors.join() === '#F4F7FF,#FFB3C7' && b1.colors.join() === a1.colors.join());
  // 움직이는 도중에도 어긋나지 않는지: 손님이 뛰며 걷는 동안 두 화면을 여러 번 견준다
  let worst = 0, travelled = 0;
  const m0 = (await A.world()).xs[1];
  await B.page.keyboard.down('ArrowRight');
  for (let i = 0; i < 12; i++) { if (i % 4 === 0) await B.page.keyboard.press('Space'); await sleep(90); const [a, b] = await Promise.all([A.world(), B.world()]); worst = Math.max(worst, Math.abs(a.xs[1] - b.xs[1])); travelled = a.xs[1] - m0; }
  await B.page.keyboard.up('ArrowRight');
  ok('움직이는 동안 두 화면의 차이는 요약 한두 번 간격 안이다', travelled > 100 && worst < 40, `${Math.round(travelled)}px 달리는 동안 가장 벌어진 때 ${worst.toFixed(1)}px(달리는 빠르기 175px/초, 요약 간격 0.05초 + 늦게 그리기 0.05초)`);

  // ---------- 2. 저울 팩 01 을 두 기기가 양쪽 접시를 맡아 실제 확인 키로 푼다 ----------
  await A.page.locator('[data-pick]').click();
  await A.page.waitForSelector('[data-stage]');
  ok('방장이 고르는 화면으로 나가면 손님은 기다리는 화면으로 간다', !!(await until(async () => (await B.page.locator('.w-wait').count()) === 1)));
  await A.page.locator('[data-back]').click();
  await A.page.waitForSelector('[data-open="math/scale-equation"]');
  ok('방에 있는 채로 다른 팩으로 옮겨 간다', (await A.room())?.code === code && (await B.room())?.code === code);
  await pickStage(A, 'math/scale-equation', 0);
  await until(async () => (await B.world())?.lines?.length === 1 && (await B.net())?.room?.pack === 'math/scale-equation');
  const pans = await A.page.evaluate(() => { const w = window.__world(), d = w.stage.scales[0]; return { L: d.pans[0], R: d.pans[1], floor: d.floor, bins: w.stage.bins.map(b => b.x), x: w.scales[0].x, key: w.stage.key, door: w.stage.door }; });
  const put = (i, x) => A.page.evaluate(([i, x]) => { const w = window.__world(), p = w.players[i]; p.x = x; p.y = w.stage.scales[0].floor - p.h; p.vx = 0; p.vy = 0; }, [i, x]);
  const lbin = pans.bins.filter(x => x < pans.L.x).pop() + 4, rbin = pans.bins.find(x => x > pans.R.x) + 4;
  const start = await A.world(), startB = await B.world();
  ok('같은 씨앗으로 두 화면이 같은 식에서 시작한다', JSON.stringify(start.lines) === JSON.stringify(startB.lines), JSON.stringify(start.lines[0][0]));
  const enter = async d => { await d.page.keyboard.press('Enter'); await sleep(140); };
  let same = true, rounds = 0;
  for (let guard = 0; guard < 10; guard++) {
    const cur = await A.world(); if (cur.line[0][1] === 0) break;
    await put(0, pans.L.x + pans.L.w * 0.7); await put(1, pans.R.x + pans.R.w * 0.7); await sleep(120);
    await enter(A); await enter(B);                       // 방장은 왼쪽 접시에서, 손님은 오른쪽 접시에서 구슬을 든다
    if (guard === 0) {                                    // 손님 화면은 요약 한두 번만큼 늦으므로 잠깐 기다려 준다
      const both = await until(async () => { const [a, b] = await Promise.all([A.world(), B.world()]); return a.carry.join() === 'marble,marble' && b.carry.join() === 'marble,marble'; }, 1000, 40);
      const [a, b] = await Promise.all([A.world(), B.world()]);
      ok('든 구슬이 두 화면에 똑같이 보인다', !!both, `방장 화면 ${a.carry} / 손님 화면 ${b.carry}`);
    }
    await put(0, lbin); await put(1, rbin); await sleep(120);
    await enter(A); await enter(B);                       // 통에 버린다
    await sleep(750);
    // 줄이 늘 때마다 두 화면을 견준다(손님 화면은 요약 한두 번만큼 늦으므로 잠깐 기다려 준다)
    if (!(await until(async () => { const [a, b] = await Promise.all([A.world(), B.world()]); return JSON.stringify(a.lines) === JSON.stringify(b.lines) && JSON.stringify(a.line) === JSON.stringify(b.line); }, 1500, 60))) same = false;
    rounds++;
  }
  const solved = await until(async () => { const [a, b] = await Promise.all([A.world(), B.world()]); return a.solved[0] && b.solved[0] ? [a, b] : null; }, 5000);
  ok('두 기기가 양쪽 접시를 맡아 실제 확인 키로 식을 푼다', !!solved, solved ? `풀이 판 ${JSON.stringify(solved[0].lines[0])} (${rounds}번 덜어 냄, x = ${pans.x})` : JSON.stringify((await A.world()).lines));
  ok('풀이 판 줄이 두 화면에서 같다(줄이 늘 때마다 견줌)', same && solved && JSON.stringify(solved[0].lines) === JSON.stringify(solved[1].lines) && solved[0].lines[0].length >= 2);
  // 다리가 놓였으니 열쇠를 줍고 문으로: 여기부터는 두 기기 모두 실제 방향키와 확인 키만 쓴다
  await put(0, pans.key.x - 80); await put(1, pans.key.x - 120);
  await Promise.all([A.page.keyboard.down('ArrowRight'), B.page.keyboard.down('ArrowRight')]);
  const opened = await until(async () => (await B.world()).open, 6000);
  await Promise.all([A.page.keyboard.down('Enter'), B.page.keyboard.down('Enter')]);
  const won = await until(async () => { const [a, b] = await Promise.all([A.world(), B.world()]); return a.won && b.won; }, 8000);
  for (const d of [A, B]) { await d.page.keyboard.up('ArrowRight'); await d.page.keyboard.up('Enter'); }
  ok('열쇠를 주워 문을 열고 둘 다 문으로 들어가 끝난다', !!opened && !!won);
  ok('끝 창: 방장에게는 다음 스테이지 단추, 손님에게는 기다리라는 글', !!(await until(async () => await A.page.locator('.w-end [data-next]').count() === 1 && await B.page.locator('.w-end .w-end-wait').count() === 1)));

  // ---------- 3. 방장이 스테이지를 바꾸면 손님도 바뀐다 ----------
  await A.page.locator('.w-end [data-next]').click();
  ok('방장이 다음 스테이지를 누르면 손님도 따라간다', !!(await until(async () => (await B.net())?.room?.stage === 1 && (await B.world())?.hint === (await A.world())?.hint && !(await B.world()).won)));

  // ---------- 4. 늦게 들어온 사람도 같은 상태를 본다(QR 에 담긴 주소로) ----------
  await put(0, 300); await put(1, 360);
  await enter(A);
  const C = await device('C');
  await C.open(`?room=${code}`);
  const late = await until(async () => { const [a, c] = await Promise.all([A.world(), C.world()]); return a && c && c.n === 3 && a.n === 3 && near(a.xs, c.xs, 2) && JSON.stringify(a.lines) === JSON.stringify(c.lines) && JSON.stringify(a.line) === JSON.stringify(c.line) ? [a, c] : null; }, 8000);
  ok('늦게 들어온 사람도 같은 상태를 본다', !!late, late ? `세 번째 도름이 색 ${late[1].colors[2]}, 자리 ${JSON.stringify(late[1].xs)}` : JSON.stringify([await A.world(), await C.world()]).slice(0, 300));
  ok('세 화면 모두 3명으로 센다', (await A.net()).room.order.join() === '0,1,2' && (await C.net()).myIndex === 2 && (await B.page.locator('[data-count]').first().textContent()) === '3');

  // ---------- 5. 방장이 나가면 손님이 방장이 되어 이어 간다 ----------
  // 방장이 화면을 내려 두면(다른 앱으로 감) 게임 화면을 보는 다음 사람에게 방장이 넘어가고, 돌아와도 손님으로 이어서 한다
  await sleep(2500);                                    // 앞 방장의 요약 차례 번호가 넉넉히 쌓이게 둔다
  // 손님(C)이 왼쪽 키를 누르고 있는 채로 방장이 바뀐다. 되풀이 보내기는 1초에 한 번뿐이라, 새 방장에게 바로 다시 보내지 않으면 그동안 도름이가 선다
  await C.page.keyboard.down('ArrowLeft'); await sleep(1300);
  const heldBefore = (await A.net()).held;
  await A.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const handed = await until(async () => (await B.net())?.isHost === true && (await A.net())?.isHost === false, 4000);
  const heldAfter = await until(async () => { const h = (await B.net())?.held; return h && h[2] === -1 ? h : null; }, 500, 30);
  ok('방장은 손님의 마지막 조작을 이어 쓰고(1초에 한 번만 와도 계속 걷는다), 방장이 바뀐 직후에도 누르고 있던 조작이 끊기지 않는다', heldBefore?.[2] === -1 && !!heldAfter, `바뀌기 전 방장이 아는 조작 ${JSON.stringify(heldBefore)}, 바뀐 뒤 0.5초 안에 새 방장이 아는 조작 ${JSON.stringify(heldAfter ?? (await B.net())?.held)}`);
  await C.page.keyboard.up('ArrowLeft'); await sleep(300);
  await A.page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  const g0 = [(await A.net()).got, (await C.net()).got]; await sleep(600);
  const g1 = [(await A.net()).got, (await C.net()).got];
  ok('방장이 화면을 내려 두면 다음 사람이 방장을 이어받는다', !!handed && (await B.world()).n === 3, `자리 ${(await B.net()).host}번이 방장`);
  ok('방장이 바뀐 바로 뒤에도 손님들이 새 방장의 요약을 받는다(0.6초에 10번쯤)', g1[0] - g0[0] >= 8 && g1[1] - g0[1] >= 8, `앞 방장 화면 ${g1[0] - g0[0]}번, 다른 손님 화면 ${g1[1] - g0[1]}번`);
  const y0 = await B.world();
  await A.hold('ArrowRight', 400); await sleep(400);
  const [yb, ya] = await Promise.all([B.world(), A.world()]);
  ok('방장을 넘겨준 사람도 손님으로 이어서 움직인다', yb.xs[0] - y0.xs[0] > 25 && near(yb.xs, ya.xs, 2), `+${Math.round(yb.xs[0] - y0.xs[0])}px(0.4초, 다 가면 70)`);
  ok('방장을 넘겨받으면 단추도 바뀐다', await B.page.locator('[data-retry]').count() === 1 && await A.page.locator('[data-retry]').count() === 0 && await A.page.locator('[data-leave]').count() === 1);

  // 새로 고침: 주소에 방 코드가 남아 같은 방으로 돌아온다
  await C.page.reload({ waitUntil: 'networkidle' });
  ok('새로 고치면 같은 방, 같은 판으로 돌아온다', !!(await until(async () => (await C.room())?.code === code && (await C.world())?.n === 3 && (await B.world()).n === 3 && near((await B.world()).xs.slice(0, 2), (await C.world()).xs.slice(0, 2), 2), 8000)), `돌아온 사람 자리 번호 ${(await C.room())?.me}`);

  const before = await B.world();
  await B.close();                                      // 지금 방장(B)이 나간다. 남은 둘 가운데 먼저 들어온 A 가 다시 방장이 된다
  [A, B] = [B, A];                                      // 아래에서는 남은 방장을 B, 나간 사람을 A 로 부른다
  const promoted = await until(async () => (await B.net())?.isHost === true && (await B.world()).n === 2 && (await C.world()).n === 2, 8000);
  ok('방장이 나가면 그다음으로 오래된 손님이 방장이 된다', !!promoted, `남은 도름이 색 ${(await B.world()).colors}`);
  const p0 = (await C.net()).got; await sleep(600);
  ok('방장이 나간 바로 뒤에도 손님이 새 방장의 요약을 받는다', (await C.net()).got - p0 >= 8, `0.6초에 ${(await C.net()).got - p0}번`);
  ok('나간 사람의 도름이만 빠지고 남은 도름이는 제자리다', (await B.world()).colors.join() === '#F4F7FF,#A8DDF5' && Math.abs((await B.world()).xs[0] - before.xs[0]) < 3, `남은 색 ${(await B.world()).colors}`);
  await put2(B, 0, 300); await put2(B, 1, 500); await sleep(200);
  const c0 = await C.world();
  await Promise.all([B.hold('ArrowRight', 500), C.hold('ArrowLeft', 500)]);
  await sleep(400);
  const [b2, c2] = await Promise.all([B.world(), C.world()]);
  ok('새 방장 아래에서 게임이 이어진다(두 기기의 키가 모두 먹고 두 화면이 같다)', b2.xs[0] - c0.xs[0] > 40 && b2.xs[1] - c0.xs[1] < -40 && near(b2.xs, c2.xs, 2), `새 방장 화면 ${JSON.stringify(b2.xs)} / 손님 화면 ${JSON.stringify(c2.xs)}`);
  ok('새 방장에게 방장 단추(다시 하기)가 생긴다', await B.page.locator('[data-retry]').count() === 1 && await C.page.locator('[data-retry]').count() === 0);
  await B.close(); await C.close();

  // ---------- 6. 공개 방이 목록에 뜨고 눌러 들어간다 ----------
  const D = await device('D'), E = await device('E');
  await D.open();
  const pubCode = await createRoom(D, { pub: true });
  await E.open();
  const row = E.page.locator(`[data-pub="${pubCode}"]`);
  ok('공개 방이 처음 화면 목록에 뜬다', !!(await until(async () => await row.count() === 1, 10000)), pubCode);
  await row.click();
  ok('목록에서 눌러 들어간다', !!(await until(async () => (await E.room())?.me === 1 && (await D.room())?.seats?.length === 2)));
  // 방 하나가 목록에 알리는 것은 1초에 한 번까지라, 사람 수는 방장의 다음 알림(5초마다) 안에 맞춰진다
  const list = await until(async () => { const l = await (await fetch(`${ROOM}/public`, { headers: { Origin: ORIGIN } })).json(); return l.some(r => r.code === pubCode && r.count === 2) ? l : null; }, 8000, 300) ?? [];
  ok('공개 방 목록에 사람 수가 맞게 나온다', list.some(r => r.code === pubCode && r.count === 2), JSON.stringify(list));
  ok('비공개 방은 목록에 없다', !list.some(r => r.code === code));
  await D.close();
  ok('방장이 나가도 손님이 남아 있으면 방은 목록에 남고, 남은 손님이 방장이 된다', !!(await until(async () => (await E.room())?.isHost === true)));
  await E.close();
  await sleep(300);
  ok('모두 나간 방은 목록에서 바로 내려간다', !(await (await fetch(`${ROOM}/public`)).json()).some(r => r.code === pubCode));

  // ---------- 7. 함께 보기: 조작기 화면의 단추가 큰 화면의 도름이를 움직인다 ----------
  const F = await device('큰 화면', { w: 1440, h: 810 }), G = await device('조작기', { w: 390, h: 844, touch: true }), H = await device('조작기 2', { w: 844, h: 390, touch: true });
  await F.open();
  const bigCode = await createRoom(F, { big: true });
  await G.open(); await joinByCode(G, bigCode);
  await H.open(`?room=${bigCode}`);
  ok('함께 보기 방에 들어온 기기는 조작기 화면이 된다', !!(await until(async () => await G.page.locator('.w-ctl').count() === 1 && await H.page.locator('.w-ctl').count() === 1)));
  await pickStage(F, 'etc/tutorial', 0);
  await until(async () => (await F.world())?.n === 2);
  const f0 = await F.world();
  ok('큰 화면에는 조작기로 들어온 두 사람만 도름이로 선다(큰 화면은 보여 주기만)', f0.n === 2 && (await F.net()).myIndex === -1, `도름이 색 ${f0.colors}`);
  ok('조작기에 내 번호와 색이 보인다', (await G.page.locator('.w-ctl-num').textContent()) === '1' && (await H.page.locator('.w-ctl-num').textContent()) === '2' && (await G.page.locator('.w-ctl-name').textContent()).includes('분홍'));
  // 화면 단추를 실제로 누르고 있다 뗀다(누른 자리의 포인터 사건이 그대로 간다)
  const press = async (d, k, ms) => { const box = await d.page.locator(`.w-ctl [data-k="${k}"]`).boundingBox(); await d.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await d.page.mouse.down(); await sleep(ms); await d.page.mouse.up(); };
  await press(H, 'r', 600); await sleep(300);           // 2번이 오른쪽에 서 있어 막히지 않는다
  const f1 = await F.world();
  ok('조작기의 오른쪽 단추가 큰 화면의 내 도름이를 움직인다', Math.abs(f1.xs[1] - f0.xs[1] - 105) < 30 && Math.abs(f1.xs[0] - f0.xs[0]) < 3, `2번 +${Math.round(f1.xs[1] - f0.xs[1])}px(0.6초, 기대 105), 1번 +${Math.round(f1.xs[0] - f0.xs[0])}px`);
  let top = f1.ys[0];
  const watch = (async () => { for (let i = 0; i < 12; i++) { top = Math.min(top, (await F.world()).ys[0]); await sleep(40); } })();
  await press(G, 'j', 120); await watch;
  ok('조작기의 뛰기 단추로 큰 화면의 도름이가 뛴다', f1.ys[0] - top > 30, `1번이 ${Math.round(f1.ys[0] - top)}px 떠오름`);
  ok('조작기는 세계 요약을 받지 않는다', (await G.page.evaluate(() => !window.__world)) === true);
  await G.page.locator('[data-own]').click();
  ok('조작기에서 내 화면으로 보기를 누르면 같은 판을 자기 화면으로 본다', !!(await until(async () => { const [f, g] = await Promise.all([F.world(), G.world()]); return g && near(f.xs, g.xs, 2); })));
  await F.page.locator('[data-joinin]').click();
  ok('큰 화면에서 나도 뛰기를 켜면 도름이가 하나 는다', !!(await until(async () => (await F.world()).n === 3 && (await G.world()).n === 3 && (await F.net()).myIndex === 2)));
  await F.close(); await G.close(); await H.close();
  // 큰 화면이 꺼지고 조작기뿐이면: 가장 먼저 들어온 조작기가 게임 화면으로 바뀌어 방장을 맡고, 그 스테이지를 처음부터 연다
  const F2 = await device('큰 화면 2'), G2 = await device('조작기 3', { w: 844, h: 390, touch: true }), H2 = await device('조작기 4', { w: 390, h: 844, touch: true });
  await F2.open(); const big2 = await createRoom(F2, { big: true });
  await G2.open(`?room=${big2}`); await G2.page.waitForSelector('.w-ctl'); await H2.open(`?room=${big2}`); await H2.page.waitForSelector('.w-ctl');
  await pickStage(F2, 'etc/tutorial', 0); await until(async () => (await F2.world())?.n === 2);
  await F2.close();
  const took = await until(async () => (await G2.net())?.isHost === true && (await G2.world())?.n === 2 && (await G2.net()).room.stage === 0, 8000);
  ok('큰 화면이 꺼지면 가장 먼저 들어온 조작기가 게임 화면으로 바뀌어 방장을 맡는다', !!took && await G2.page.locator('.w-ctl').count() === 0 && await H2.page.locator('.w-ctl').count() === 1, took ? `도름이 색 ${(await G2.world()).colors}, 내 차례 ${(await G2.net()).myIndex + 1}번` : JSON.stringify(await G2.room()));
  const t0 = await G2.world();
  await press(H2, 'r', 500); await sleep(300);
  ok('새 방장의 화면에서 남은 조작기의 단추가 그대로 먹는다', (await G2.world()).xs[1] - t0.xs[1] > 50);
  await G2.close(); await H2.close();

  // ---------- 8. 안내: 없는 방, 가득 찬 방 ----------
  const I = await device('I');
  await I.open();
  await I.page.locator('#w-code').fill('ZZZZZZ');
  await I.page.getByRole('button', { name: '들어가기', exact: true }).first().click();
  ok('없는 방 코드에는 그런 방이 없다고 알린다', !!(await until(async () => (await I.page.locator('.w-online-note').textContent().catch(() => '')).includes('그런 방이 없어요'))) && !I.page.url().includes('room='));
  await I.page.locator('#w-code').fill('ab1');
  await I.page.getByRole('button', { name: '들어가기', exact: true }).first().click();
  ok('모양이 틀린 코드는 보내지 않고 바로 알린다', (await I.page.locator('.w-online-note').textContent()).includes('여섯 글자'));
  const fullCode = await createRoom(I);
  const crowd = []; for (let i = 0; i < 29; i++) crowd.push(await ghost(fullCode, { send: false }));
  ok('한 방에 30명까지 들어온다', crowd.every(g => g.seat >= 1) && new Set(crowd.map(g => g.seat)).size === 29 && (await I.room()).seats.length === 30);
  const over = await ghost(fullCode, { send: false });
  ok('31번째 연결은 방이 가득 찼다고 거절한다', over.no === 4003);
  const J = await device('J'); await J.open(`?room=${fullCode}`);
  ok('가득 찬 방에 들어가려는 화면에 안내가 뜬다', !!(await until(async () => (await J.page.locator('.w-online-note').textContent().catch(() => '')).includes('가득 찼어요'))));
  await J.close();

  // ---------- 9. 사람이 많을 때 방장이 버티는지: 30개 연결, 그리고 8개 연결 ----------
  const measure = async label => {
    await I.page.evaluate(() => { const n = window.__net(); n; });
    const g = crowd.find(x => x.ws.readyState === 1); g.got = 0; g.bytes = 0;
    const t0 = Date.now(), n0 = await I.net();
    await sleep(5000);
    const n1 = await I.net(), sec = (Date.now() - t0) / 1000;
    const steps = n1.steps - n0.steps, frames = n1.frames - n0.frames, snaps = n1.snaps - n0.snaps;
    const r = { players: (await I.world()).n, snapBytes: n1.snapBytes, snapsPerSec: +(snaps / sec).toFixed(1), stepMs: +((n1.stepMs - n0.stepMs) / steps).toFixed(3), frameMs: +((n1.frameMs - n0.frameMs) / frames).toFixed(2), fps: +(frames / sec).toFixed(1), stepsPerSec: +(steps / sec).toFixed(1), guestGotPerSec: +(g.got / sec).toFixed(1), guestBytesPerSec: Math.round(g.bytes / sec) };
    console.log(`       ${label}: ${JSON.stringify(r)}`);
    return r;
  };
  await pickStage(I, 'math/scale-equation', 4);
  for (const g of crowd) g.timer = setInterval(() => { if (Math.random() < 0.15) g.n++; if (g.ws.readyState === 1) g.ws.send(JSON.stringify({ t: 'p', m: [-1, 0, 1][Math.floor(Math.random() * 3)], j: Math.random() < 0.3 ? 1 : 0, a: Math.random() < 0.1 ? 1 : 0, n: g.n })); }, 33);
  await until(async () => (await I.world())?.n === 30);
  await sleep(1500);
  const m30 = await measure('30개 연결(방장 1 + 손님 29, 손님마다 초당 30번 조작)');
  ok('30명: 방장이 물리를 초당 60걸음 가깝게 돌리고, 손님이 초당 20번 가깝게 요약을 받는다', m30.players === 30 && m30.stepsPerSec > 54 && m30.guestGotPerSec > 17 && m30.stepMs < 8 && m30.snapBytes < 32768, `걸음당 ${m30.stepMs}ms, 요약 ${m30.snapBytes}바이트, 손님 수신 초당 ${m30.guestGotPerSec}번`);
  ok('30명이 마구 눌러도 아무도 빈도 상한에 걸려 끊기지 않는다', crowd.every(g => g.ws.readyState === 1) && (await I.room()).seats.length === 30);
  for (const g of crowd.slice(7)) g.close();
  await until(async () => (await I.world())?.n === 8, 8000);
  await sleep(1000);
  const m8 = await measure('8개 연결(방장 1 + 손님 7)');
  ok('8명: 사람이 줄면 요약도 작아지고 방장은 넉넉하다', m8.players === 8 && m8.stepsPerSec > 54 && m8.snapBytes < m30.snapBytes && m8.guestGotPerSec > 17, `걸음당 ${m8.stepMs}ms, 요약 ${m8.snapBytes}바이트`);
  for (const g of crowd) g.close();
  await I.close();

  // ---------- 10. 방 서버의 방어 ----------
  const raw = (path, origin = ORIGIN) => new Promise(res => { const ws = new WebSocket(`${WS}${path}`, { headers: { Origin: origin } }); const log = []; ws.onmessage = e => log.push(e.data); ws.onclose = e => { log.push(`close ${e.code}`); }; ws.onerror = () => log.push('error'); setTimeout(() => res({ ws, log }), 500); });
  const evil = await raw('/room/ABCDEF?mode=create', 'https://evil.example');
  ok('다른 사이트에서 온 연결은 받지 않는다', evil.log.includes('error') && !evil.log.some(x => String(x).includes('"hi"')));
  ok('다른 사이트에서는 공개 방 목록도 읽지 못한다', (await fetch(`${ROOM}/public`, { headers: { Origin: 'https://evil.example' } })).status === 403);
  const hostWs = await raw('/room/QRSTUV?mode=create'), guestWs = await raw('/room/QRSTUV?mode=join');
  guestWs.ws.send(JSON.stringify({ t: 'room', room: { pack: 'x/y', stage: 0, seed: 1, run: 1, pub: true, big: false, order: [] } }));
  guestWs.ws.send(JSON.stringify({ t: 's', d: {} })); guestWs.ws.send('garbage'); guestWs.ws.send(JSON.stringify({ t: 'p', m: 1, j: 0, a: 0, n: 1, x: '<b>' }));
  await sleep(400);
  ok('손님은 방 정보도 세계 요약도 바꾸지 못하고, 조작은 검사한 값으로만 방장에게 간다', hostWs.log.slice(1).filter(x => !String(x).includes('"who"')).join() === '{"t":"p","s":1,"m":1,"j":0,"a":0,"n":1}', hostWs.log.slice(1).join(' '));
  for (let i = 0; i < 400; i++) guestWs.ws.send('{"t":"p","m":0,"j":0,"a":0,"n":0}');
  await sleep(500);
  ok('너무 빨리 보내는 연결은 끊는다', guestWs.log.includes('close 4008'), guestWs.log.slice(-1).join());
  hostWs.ws.send('x'.repeat(40000)); await sleep(400);
  ok('너무 큰 글을 보내는 연결은 끊는다', hostWs.log.includes('close 4007'));
}

// ---------- 12. 선생님 방: 출입증 · 방 제목 · 닉네임 신청과 승인 · 순위 · 쓰임 알림 ----------
if (!flag('only-shots') && ownRoom) {
  const T = await device('선생님', { w: 1440, h: 900 }), S1 = await device('학생 1'), S2 = await device('학생 2', { w: 390, h: 844, touch: true });
  await T.open(`#pass=${makePass()}`);
  ok('출입증은 받자마자 주소에서 지우고, 처음 화면에 선생님 닉네임을 보인다', !T.page.url().includes('pass') && (await T.page.locator('.w-online .w-teacher-nick').textContent()) === '@창욱쌤', T.page.url());
  await S1.open();
  const login = S1.page.locator('.w-online .w-teacher-login');
  ok('출입증이 없으면 선생님 줄 대신 도름스 로그인 안내와 링크가 보인다', await S1.page.locator('.w-teacher-nick').count() === 0 && (await login.getAttribute('href')) === 'https://dorms.school/login?next=/world' && (await login.getAttribute('target')) === '_blank');
  await S1.page.getByRole('button', { name: '방 만들기' }).first().click(); await S1.page.waitForSelector('.w-dialog [data-make]');
  ok('출입증이 없는 사람의 방 만들기 창에는 방 제목 · 순위 칸이 없다', await S1.page.locator('.w-dialog #w-title, .w-dialog [data-rank]').count() === 0);
  await S1.page.keyboard.press('Escape');
  await T.page.getByRole('button', { name: '방 만들기' }).first().click(); await T.page.waitForSelector('.w-dialog #w-title');
  await T.page.locator('.w-dialog [data-rank="1"]').click(); await T.page.locator('.w-dialog [data-make]').click();
  ok('순위에 올리려면 방 제목을 적어야 한다(방 제목에 학생 이름을 넣지 말라는 안내가 있다)', (await T.page.locator('.w-dialog .w-make-note').textContent()).includes('방 제목을 적어') && (await T.page.locator('.w-dialog .w-title-note').textContent()).includes('학생 이름을 넣지 마세요') && (await T.room()) === null);
  await T.page.keyboard.press('Escape');
  const code = await createRoom(T, { title: '3학년 2반', rank: true });
  const made = await until(async () => { const r = await T.room(); return r?.teacher && r.cls ? r : null; });
  ok('출입증으로 만든 방은 선생님 방이 된다(방 제목 · 순위에 올리기)', !!made && made.cls.title === '3학년 2반' && made.cls.rank === true && made.cls.teachers.join() === '0', JSON.stringify(made?.cls));
  ok('선생님 화면: 방 코드 · QR · 닉네임 신청 줄 · 명단이 한 화면에 있다', (await T.page.locator('.w-teach .w-bigcode').textContent()) === code && await T.page.locator('.w-teach .w-qr svg').count() === 1 && await T.page.locator('.w-teach .w-asks-none').count() === 1 && await T.page.locator('.w-teach .w-teach-row').count() === 1 && (await T.page.locator('.w-teach .w-room-title').textContent()) === '3학년 2반');
  await joinByCode(S1, code); await S2.open(`?room=${code}`);
  ok('학생은 이름 입력 없이 바로 들어오고, 기다리는 화면에 방 제목과 닉네임 단추가 있다', !!(await until(async () => await S1.page.locator('.w-wait [data-nick]').count() === 1 && (await S1.page.locator('.w-wait .w-room-title').textContent()) === '3학년 2반' && (await S2.room())?.me === 2)));
  // 닉네임 신청 → 반려 → 다시 입력 → 승인
  await S1.page.locator('.w-wait [data-nick]').click(); await S1.page.waitForSelector('#w-nick');
  ok('닉네임 창은 이름 대신 별명을 적으라고 알린다', (await S1.page.locator('.w-dialog .w-nick-how').textContent()).includes('이름 대신 별명'));
  await S1.page.locator('#w-nick').fill('달팽이'); await S1.page.locator('.w-dialog [data-send]').click();
  const asked = await until(async () => await T.page.locator('.w-teach .w-ask').count() === 1 && (await T.page.locator('.w-teach .w-ask-nick').first().textContent()) === '달팽이');
  const waiting = await until(async () => (await S1.room()).myAsk === '달팽이', 2000, 50);
  ok('닉네임을 신청하면 선생님 화면의 신청 줄에 바로 뜬다(학생 화면은 확인 중으로 바뀐다)', !!asked && !!waiting && (await S1.page.locator('.w-wait [data-nick]').textContent()).includes('확인 중'), `선생님 화면 ${JSON.stringify((await T.room()).asks)}, 학생 화면 ${JSON.stringify((await S1.room()).myAsk)}`);
  ok('승인 전의 닉네임은 다른 학생에게 가지 않는다', (await S2.room()).names.length === 0 && !(await S2.page.content()).includes('달팽이'));
  await T.page.locator('.w-teach [data-judge="no"]').first().click();
  ok('반려하면 학생에게 다시 적으라는 입력 창이 뜬다', !!(await until(async () => await S1.page.locator('#w-nick').count() === 1 && (await S1.page.locator('.w-dialog .w-nick-note').textContent()).includes('다른 닉네임'))) && (await S1.room()).myAsk === '');
  await S1.page.locator('#w-nick').fill('<b>고래</b>'); await S1.page.locator('.w-dialog [data-send]').click();
  await until(async () => await T.page.locator('.w-teach .w-ask').count() === 1);
  await T.page.locator('.w-teach [data-judge="yes"]').first().click();
  const named = await until(async () => { const [a, b, t] = await Promise.all([S1.room(), S2.room(), T.room()]); return [a, b, t].every(r => JSON.stringify(r.names) === '[[1,"<b>고래</b>"]]') ? t : null; });
  ok('승인하면 모든 화면에 닉네임이 보인다', !!named && (await S1.page.locator('.w-people-list').textContent()).includes('<b>고래</b>'));
  ok('닉네임은 글자 그대로 그려진다(꺾쇠가 화면을 바꾸지 못한다)', await T.page.locator('.w-teach-list b b, .w-teach-list .w-ask-nick > *').count() === 0 && await S1.page.locator('.w-people-list b').count() === 0 && (await T.page.locator('.w-teach-list').textContent()).includes('<b>고래</b>'));
  // 학생이 승인을 흉내 내거나 방장인 척 순위를 보내도 아무 일이 없다
  const spy = await ghost(code, { send: false });
  spy.ws.send(JSON.stringify({ t: 'name', v: '몰래' })); await sleep(300);
  spy.ws.send(JSON.stringify({ t: 'ok', s: spy.seat, y: 1, v: '몰래' })); spy.ws.send(JSON.stringify({ t: 'ok', s: 1, y: 0, v: '<b>고래</b>' }));
  spy.ws.send(JSON.stringify({ t: 'pass', v: makePass({ u: '99999999-2222-4333-8444-555555555555' }), title: '빼앗은 방', rank: 1 }));
  await sleep(500);
  ok('출입증 없이 보낸 승인 · 반려는 버려지고, 다른 선생님의 출입증으로는 이 방의 선생님이 되지 못한다', JSON.stringify((await T.room()).names) === '[[1,"<b>고래</b>"]]' && (await T.room()).cls.title === '3학년 2반' && spy.log.some(m => m.t === 'pass' && m.ok === 0) && !spy.log.some(m => m.t === 'asks') && (await T.page.locator('.w-teach .w-ask-nick').first().textContent()) === '몰래');
  await T.page.locator('.w-teach [data-judge="no"]').first().click();
  // 함께 스테이지로: 머리 위 닉네임, 순위, 쓰임 알림
  await pickStage(T, 'etc/tutorial', 0);
  await until(async () => (await S1.world())?.n === 4);
  ok('도름이 머리 위에 승인된 닉네임이 적힌다(선생님의 도름이는 선생님)', JSON.stringify((await T.net()).heads) === '["선생님","<b>고래</b>","",""]' && JSON.stringify((await S1.net()).heads) === JSON.stringify((await T.net()).heads), JSON.stringify((await T.net()).heads));
  ok('쓰임 알림: 선생님 방에서 팩이 처음 열릴 때 한 번 도름스에 닿는다', !!(await until(async () => dorms.uses.length === 1)) && dorms.uses[0].packId === 'etc/tutorial' && dorms.uses[0].teacher === TEACHER, JSON.stringify(dorms.uses));
  spy.ws.send(JSON.stringify({ t: 'won', r: (await T.net()).room.run, ms: 3000 }));
  await sleep(3300);
  ok('손님이 방장인 척 보낸 순위는 도름스에 닿지 않는다', dorms.ranks.length === 0);
  spy.close();
  await T.page.evaluate(() => { const w = window.__world(); w.doorOpen = true; w.players.forEach(p => { p.inDoor = true; }); });
  const ranked = await until(async () => dorms.ranks.length === 1 && (await T.page.locator('.w-end .w-rankline').textContent().catch(() => '')).includes('번째로 빨라요') && (await S1.page.locator('.w-end .w-rankline').textContent().catch(() => '')).includes('번째로 빨라요'), 8000);
  const rec = dorms.ranks[0] ?? {};
  ok('다 함께 깨면 방 서버가 도름스에 순위를 적는다(팩 · 스테이지 · 시간 · 인원 · 방 제목 · 선생님)', !!ranked && rec.packId === 'etc/tutorial' && rec.stage === 0 && rec.ms >= 3000 && rec.ms < 15000 && rec.players === 3 && rec.title === '3학년 2반' && rec.teacher === TEACHER && dorms.denied === 0, JSON.stringify(rec));
  ok('끝 창에 우리 방 기록과 등수가 뜬다(방장과 손님 모두)', !!ranked && /우리 방 기록 00:0\d, 1번째로 빨라요/.test(await S1.page.locator('.w-end .w-rankline').textContent()), await T.page.locator('.w-end .w-rankline').textContent().catch(() => ''));
  await T.page.locator('.w-end [data-again]').click(); await sleep(400);
  ok('쓰임 알림은 팩마다 방에서 한 번뿐이다', dorms.uses.length === 1);
  await T.page.locator('[data-pick]').click(); await T.page.waitForSelector('.w-ranks .w-rank');
  ok('팩 화면에 순위 줄이 뜬다(등수 · 방 제목 · 시간 · 인원 · 선생님 닉네임)', (await T.page.locator('.w-ranks .w-rank').first().textContent()).replace(/\s+/g, ' ').includes('3학년 2반') && /00:0\d/.test(await T.page.locator('.w-ranks .w-rank-time').first().textContent()) && (await T.page.locator('.w-ranks .w-rank-by').first().textContent()) === '@창욱쌤');
  await T.page.locator('.w-ranks [data-rank-stage="1"]').click();
  ok('기록이 없는 스테이지는 아직 기록이 없다고 알린다', (await T.page.locator('.w-ranks .w-rank-none').textContent()).includes('아직 기록이 없어요'));
  // 선생님이 나가 있는 동안의 신청은 쌓였다가, 출입증으로 다시 들어오면 보인다
  await T.page.goto('about:blank');
  await until(async () => (await S1.room())?.isHost === true);
  ok('선생님이 나가도 방은 이어지고(다음 사람이 방장), 선생님 방인 것도 그대로다', (await S1.room()).cls?.title === '3학년 2반' && (await S1.room()).cls.teachers.length === 0 && await S1.page.locator('.w-teach, [data-teach]').count() === 0);
  await S2.page.locator('[data-nick]').first().click(); await S2.page.waitForSelector('#w-nick'); await S2.page.locator('#w-nick').fill('상어'); await S2.page.locator('.w-dialog [data-send]').click();
  await until(async () => (await S2.room()).myAsk === '상어');
  await T.open(`?room=${code}`);
  const back = await until(async () => { const r = await T.room(); return r?.teacher && r.isHost && JSON.stringify(r.asks) === '[[2,"상어"]]' ? r : null; }, 8000);
  ok('선생님이 출입증으로 다시 들어오면 쌓인 신청이 보이고 승인할 수 있다', !!back && back.isHost === true && await T.page.locator('.w-teach .w-ask').count() === 1);   // 돌아온 선생님은 방장을 돌려받는다(순위는 선생님의 기기가 방장일 때만 오른다)
  await T.page.locator('.w-teach [data-judge="yes"]').first().click();
  ok('돌아온 선생님의 승인이 모두에게 닿는다', !!(await until(async () => (await S1.room()).names.some(n => n[1] === '상어') && (await S2.room()).names.some(n => n[1] === '상어'))));
  // 게임 도중에 선생님이 나갔다 돌아온다: 판이 처음으로 돌아가지 않고, 선생님 도름이도 다시 선다
  await pickStage(T, 'etc/tutorial', 0);
  await until(async () => { const r = await S1.room(), w = await S1.world().catch(() => null); return r?.shown === 'game' && r.room.stage === 0 && w?.n === 3; }, 8000);
  await T.page.goto('about:blank');
  await until(async () => (await S1.room())?.isHost === true && (await S1.world().catch(() => null))?.n === 2);
  await sleep(500);
  // 남은 두 학생 가운데 오른쪽에 선 학생을 걷게 한다(도름이끼리는 지나가지 못해 왼쪽 학생은 막힌다)
  const order2 = (await S1.room()).room.order, xs2 = (await S1.world()).xs;
  const moverSeat = order2[xs2.indexOf(Math.max(...xs2))], mover = moverSeat === (await S1.room()).me ? S1 : S2;
  /** 보는 기기(viewer)의 세계에서 걷는 학생의 가로 자리. 차례가 바뀌어도 자리 번호로 찾는다. */
  const moverX = async viewer => { const r = await viewer.room(), w = await viewer.world().catch(() => null); const i = r?.room.order.indexOf(moverSeat) ?? -1; return w && i >= 0 ? w.xs[i] : null; };
  const start = await moverX(S1);
  await mover.page.bringToFront(); await mover.hold('ArrowRight', 1500); await sleep(500);
  const far = await moverX(S1);
  await T.open(`?room=${code}`);
  const again = await until(async () => { const r = await T.room(), w = await T.world().catch(() => null); return r?.teacher && r.isHost && w?.n === 3 ? w : null; }, 10000);
  await sleep(1200);
  const [seenByS1, seenByT, afterWorld] = [await moverX(S1), await moverX(T), await S1.world()];
  ok('게임 도중에 돌아온 선생님이 방장을 돌려받아도 판이 처음으로 돌아가지 않는다(학생이 걸어간 자리 그대로, 도름이 셋)',
    !!again && far > start + 40 && seenByS1 > far - 30 && seenByT > far - 30 && afterWorld.n === 3,
    JSON.stringify({ start, far, seenByS1, seenByT, n: afterWorld.n }));
  // 방장을 맡은 기기가 요약을 보내지 않아도(멎었거나 일부러) 선생님은 방장을 돌려받는다: 2.5초 기다린 뒤 스테이지를 처음부터 다시 연다
  const mute = await ghost(code, { send: false });
  await S1.page.goto('about:blank'); await S2.page.goto('about:blank'); await T.page.goto('about:blank');
  const muteHost = await until(async () => mute.log.some(m => m.t === 'who' && m.host === mute.seat), 6000);
  const runBefore = mute.log.filter(m => m.t === 'room').at(-1)?.room?.run ?? -1;
  await T.open(`?room=${code}`);
  const trace = [], t0 = Date.now(); let lastKey = '';
  const took = await until(async () => { const r = await T.room(), w = await T.world().catch(() => null); const key = JSON.stringify([r?.teacher, r?.isHost, r?.host, r?.room?.run, r?.shown, w?.n]); if (key !== lastKey) { lastKey = key; trace.push(`${Date.now() - t0}ms ${key}`); } return r?.teacher && r.isHost && r.room.stage === 0 && w?.n === 2 && Date.now() - t0 > 6000 ? r : null; }, 12000, 60);
  if (process.env.NET_DEBUG) console.log('TRACE', trace.join(' | '), '| mute who/room:', JSON.stringify(mute.log.filter(m => m.t === 'who' || m.t === 'room').slice(-6).map(m => m.t === 'who' ? ['who', m.host] : ['room', m.room.run, m.room.stage])));
  ok('요약을 보내지 않는 기기가 방장이어도 선생님이 방장을 돌려받고 스테이지를 다시 연다', !!muteHost && !!took && took.room.run > runBefore, JSON.stringify({ muteHost: !!muteHost, run: took?.room.run, runBefore }));
  mute.ws.close();
  await T.close(); await S1.close(); await S2.close();

  // 학생끼리 연 방: 방 제목도 닉네임도 순위도 없다
  const K = await device('학생끼리'), K2 = await device('학생끼리 2');
  await K.open(); const kcode = await createRoom(K); await K2.open(); await joinByCode(K2, kcode);
  const kid = await ghost(kcode, { send: false });
  kid.ws.send(JSON.stringify({ t: 'name', v: '달팽이' })); await sleep(500);
  ok('학생끼리 연 방에서는 닉네임 신청을 받지 않는다(방 제목 · 닉네임 단추도 없다)', kid.hi && !('cls' in kid.hi) && !kid.log.some(m => m.t === 'me' || m.t === 'class') && (await K2.room()).cls === null && await K2.page.locator('[data-nick], .w-room-title:not([hidden])').count() === 0 && await K.page.locator('.w-teach, [data-teach]').count() === 0);
  const before = dorms.ranks.length, usesBefore = dorms.uses.length;
  await pickStage(K, 'etc/tutorial', 0); await sleep(3300);
  await K.page.evaluate(() => { const w = window.__world(); w.doorOpen = true; w.players.forEach(p => { p.inDoor = true; }); });
  await K.page.waitForSelector('.w-end [data-next]'); await sleep(600);
  ok('학생끼리 연 방은 순위에도 쓰임 알림에도 닿지 않고, 끝 창에 순위 줄이 없다', dorms.ranks.length === before && dorms.uses.length === usesBefore && await K.page.locator('.w-end .w-rankline:not([hidden])').count() === 0);
  kid.close(); await K.close(); await K2.close();

  // 선생님 방 안내: 동의 기록이 없는 선생님은 방 만들기 창에서 안내를 보고 동의해야 선생님 방이 열린다
  const N = await device('처음 여는 선생님', { w: 1440, h: 900 });
  await N.open(`#pass=${makePass({ c: 0, u: '77777777-2222-4333-8444-555555555555', n: '새쌤' })}`);
  await N.page.getByRole('button', { name: '방 만들기' }).first().click();
  await N.page.waitForSelector('.w-dialog .w-notice');
  ok('동의 기록이 없는 선생님에게는 안내가 뜨고, 동의 전에는 방 제목 칸을 쓸 수 없다', await N.page.locator('.w-dialog #w-title').isDisabled() && (await N.page.locator('.w-dialog .w-notice').innerText()).includes('개인정보를 적지 않게'));
  if (flag('shots')) await N.shot('notice', 'teacher');
  await N.page.locator('.w-dialog [data-make]').click(); await N.page.waitForSelector('.w-dialog [data-code]'); await N.page.locator('.w-dialog [data-done]').click();
  await sleep(900);
  ok('동의하지 않고 만들면 보통 방으로 열린다(선생님 방이 아니다)', !(await N.room()).cls && dorms.consents.length === 0);
  await N.page.locator('[data-leave]').first().click(); await sleep(500);
  await N.page.getByRole('button', { name: '방 만들기' }).first().click(); await N.page.waitForSelector('.w-dialog .w-notice');
  await N.page.locator('.w-dialog #w-agree').check();
  await N.page.locator('.w-dialog #w-title').fill('새 반');
  await N.page.locator('.w-dialog [data-make]').click(); await N.page.waitForSelector('.w-dialog [data-code]'); await N.page.locator('.w-dialog [data-done]').click();
  const agreed = await until(async () => { const r = await N.room(); return r?.cls?.title === '새 반' && dorms.consents.length === 1 ? r : null; }, 8000);
  ok('동의하고 만들면 선생님 방이 열리고 동의가 도름스에 적힌다', !!agreed && dorms.consents[0].teacher === '77777777-2222-4333-8444-555555555555' && dorms.consents[0].version === 1);
  await N.page.locator('[data-leave]').first().click(); await sleep(500);
  await N.page.getByRole('button', { name: '방 만들기' }).first().click(); await N.page.waitForSelector('.w-dialog [data-make]');
  ok('한 번 동의한 기기에서는 다시 묻지 않는다', await N.page.locator('.w-dialog .w-notice').count() === 0);
  await N.close();

  // 변조되거나 기한이 지난 출입증
  const [v, body, sig] = makePass().split('.');
  const now = Math.floor(Date.now() / 1000);
  const forged = `${v}.${b64(JSON.stringify({ u: '99999999-2222-4333-8444-555555555555', n: '가짜쌤', a: 1, iat: now - 60, exp: now + 3600, c: 1 }))}.${sig}`;
  const F = await device('변조된 출입증', { w: 1440, h: 900 });
  await F.open(`#pass=${forged}`);
  const fcode = await createRoom(F, { title: '가짜 방', rank: true });
  const refused = await until(async () => (await F.page.locator('.w-toast:not([hidden])').textContent().catch(() => '')).includes('선생님 확인을 하지 못해'), 8000);
  ok('변조된 출입증으로 만든 방은 보통 방으로 열리고 그렇게 알린다', !!refused && (await F.room()).cls === null && (await F.room()).teacher === false && await F.page.locator('.w-teach').count() === 0, fcode);
  await F.close();
  for (const [what, pass] of [['다른 비밀값으로 서명한', makePass({}, 'another-secret-0123456789abcdef012345')], ['서명이 잘린', `${v}.${body}.${sig.slice(0, 20)}`]]) {
    const g = await ghost(fcode.replace(/.$/, c => (c === 'A' ? 'B' : 'A')), { send: false, mode: 'create' });
    g.ws.send(JSON.stringify({ t: 'pass', v: pass, title: '방', rank: 1 })); await sleep(500);
    ok(`${what} 출입증은 받지 않는다`, g.seat === 0 && g.log.some(m => m.t === 'pass' && m.ok === 0) && !g.log.some(m => m.t === 'class'));
    g.close(); await sleep(200);
  }
  const E = await device('기한 지난 출입증');
  await E.open(`#pass=${makePass({ iat: now - 13 * 3600, exp: now - 3600 })}`);
  ok('기한이 지난 출입증은 화면이 버린다(주소에서 지우고 로그인 안내를 보인다)', !E.page.url().includes('pass') && await E.page.locator('.w-online .w-teacher-login').count() === 1 && await E.page.locator('.w-teacher-nick').count() === 0);
  const old = await ghost('QRSTUW', { send: false, mode: 'create' });
  old.ws.send(JSON.stringify({ t: 'pass', v: makePass({ iat: now - 13 * 3600, exp: now - 3600 }), title: '방', rank: 1 })); await sleep(500);
  ok('기한이 지난 출입증은 방 서버도 받지 않는다', old.log.some(m => m.t === 'pass' && m.ok === 0) && !old.log.some(m => m.t === 'class'));
  old.close(); await E.close();
}

// ---------- 11. 방 서버가 새로 떠도(배포) 방이 이어진다 · 방 서버 주소가 없으면 들머리가 없다 ----------
if (baseRun && ownRoom) {
  const A = await device('A2'), B = await device('B2');
  await A.open(); await B.open();
  const code = await createRoom(A); await joinByCode(B, code);
  await pickStage(A, 'etc/tutorial', 0); await until(async () => (await B.world())?.n === 2); await sleep(600);
  await B.hold('ArrowRight', 400); await sleep(200);
  roomKid.kill('SIGTERM'); await sleep(1200);
  ok('연결이 끊기면 다시 잇는 중이라고 알린다', !!(await until(async () => (await A.page.locator('.w-toast').textContent().catch(() => '')).includes('다시 잇고'), 4000)));
  roomKid = roomUp(); await waitFor(`${ROOM}/`, '방 서버');
  const back = await until(async () => { const [a, b] = await Promise.all([A.room(), B.room()]); return a?.open && b?.open && a.isHost && a.seats.length === 2 && b.code === code && a.room.order.length === 2 && a.room.stage === 0; }, 20000, 250);
  ok('방 서버가 새로 떠도 방장이 같은 코드로 방을 다시 세우고 손님이 돌아온다', !!back, code);
  await until(async () => (await B.world())?.n === 2 && (await A.world())?.n === 2, 4000);
  await sleep(500);
  const x0 = (await A.world()).xs[1];
  await B.hold('ArrowRight', 400); await sleep(400);
  const [a, b] = await Promise.all([A.world(), B.world()]);
  ok('다시 이어진 뒤에도 손님의 키가 먹고 두 화면이 같다', a.xs[1] - x0 > 40 && near(a.xs, b.xs, 2), `손님 +${Math.round(a.xs[1] - x0)}px`);
  ok('다시 이어지면 알림이 사라진다', await A.page.locator('.w-toast:not([hidden])').count() === 0);
  await A.close(); await B.close();
}
if (baseRun && BARE) {
  const Z = await device('주소 없음');
  await Z.page.goto(`${BARE}?room=ABCDEF`, { waitUntil: 'networkidle' }); await Z.page.waitForSelector('.ar-grid');
  ok('방 서버 주소가 비어 있으면 온라인 들머리를 그리지 않는다(방 코드가 붙은 주소도 처음 화면으로)', await Z.page.locator('.w-online, .w-strip, [data-room-new], #w-code').count() === 0 && (await Z.room()) === null);
  await Z.page.locator('[data-open="etc/tutorial"]').click(); await Z.page.locator('[data-stage]').first().click(); await Z.page.waitForFunction(() => !!window.__world);
  ok('방 서버 주소가 없어도 연습 방식은 그대로 돈다', (await Z.world()).n >= 2 && await Z.page.locator('[data-swap]').count() === 1);
  await Z.close();
}

// ---------- 13. 같은 인터넷 주소에서 방을 마구 만들거나 방 코드를 훑는 것을 막는다 ----------
if (!flag('only-shots') && ownRoom) {
  // 횟수 제한을 켠 방 서버로 바꿔 띄운다(앞의 시험은 한 주소에서 방을 잇달아 만들어야 해서 꺼 두었다)
  roomKid.kill('SIGTERM'); await sleep(1500);
  roomKid = roomUp(true); await waitFor(`${ROOM}/`, '방 서버(횟수 제한 켬)');
  /** 방 서버에 바로 붙어 첫 답(들어옴 또는 거절)을 받는다. */
  const knock = (code, mode) => new Promise(res => {
    const ws = new WebSocket(`${WS}/room/${code}?mode=${mode}`, { headers: { Origin: ORIGIN } });
    const done = v => { clearTimeout(timer); res({ ws, ...v }); };
    const timer = setTimeout(() => done({ t: 'timeout' }), 4000);
    ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.t === 'hi' || m.t === 'no') done(m); } catch { /* 다른 글 */ } };
    ws.onerror = () => done({ t: 'error' });
  });
  const AB = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', codeOf = (head, i) => `${head}${AB[Math.floor(i / AB.length) % AB.length]}${AB[i % AB.length]}`;
  const rooms = []; for (let i = 0; i < 10; i++) rooms.push(await knock(codeOf('GATE', i), 'create'));
  const over = await knock(codeOf('GATE', 10), 'create');
  ok('같은 주소에서 방 만들기는 1분에 10번까지: 열한 번째는 너무 빠르다고 거절한다', rooms.every(r => r.t === 'hi') && over.t === 'no' && over.c === 4008, `열 번 ${rooms.map(r => r.t).join(' ')}, 열한 번째 ${JSON.stringify({ t: over.t, c: over.c })}`);
  const klass = await Promise.all(Array.from({ length: 29 }, () => knock(codeOf('GATE', 0), 'join')));
  ok('한 반 30명이 같은 주소에서 한꺼번에 들어오는 것은 걸리지 않는다', klass.every(r => r.t === 'hi') && new Set(klass.map(r => r.me)).size === 29, `${klass.filter(r => r.t === 'hi').length}명 들어옴`);
  const again = []; for (let i = 0; i < 6; i++) again.push(await knock('ZZZZZZ', 'join'));
  const wrong = []; for (let i = 0; i < 29; i++) wrong.push(await knock(codeOf('WXYZ', i), 'join'));
  await sleep(400);
  const still = await knock(codeOf('GATE', 1), 'join');                 // 틀린 코드 서른 개(같은 코드 여섯 번은 한 개)까지는 그대로 들어온다
  wrong.push(await knock(codeOf('WXYZ', 29), 'join'));                  // 서른한 개째
  await sleep(400);
  const blocked = await knock(codeOf('GATE', 2), 'join');
  ok('서로 다른 틀린 방 코드를 1분에 30개 넘게 넣으면 그 주소의 들어오기를 쉰다(같은 코드를 여러 번 틀린 것은 한 개로 센다)', again.every(r => r.c === 4004) && wrong.every(r => r.c === 4004) && still.t === 'hi' && blocked.t === 'no' && blocked.c === 4008, `서른 개까지는 ${still.t}, 서른한 개 뒤 맞는 방에 들어가려 하자 ${JSON.stringify({ t: blocked.t, c: blocked.c })}`);
  ok('이미 들어와 있던 사람은 그대로다', klass.every(r => r.ws.readyState === 1));
  for (const r of [...rooms, ...klass, over, still, blocked, ...again, ...wrong]) { try { r.ws.close(); } catch { /* 이미 닫힘 */ } }
  roomKid.kill('SIGTERM'); await sleep(1500);
  roomKid = roomUp(); await waitFor(`${ROOM}/`, '방 서버');     // 화면 찍기는 다시 횟수 제한 없이
}

// ---------- 선생님 방 화면 찍기: 1440 · 390 · 조작기 가로 844 ----------
if ((flag('shots') || flag('only-shots')) && ownRoom) {
  const say = async (d, sel, text) => { await d.page.locator(sel).first().click(); await d.page.waitForSelector('#w-nick'); await d.page.locator('#w-nick').fill(text); };
  for (const [w, h, touch] of [[1440, 900, false], [390, 844, true]]) {
    const T = await device(`선생님 ${w}`, { w, h, touch }), S = await device(`학생 ${w}`, { w: 390, h: 844, touch: true }), P = await device(`조작기 ${w}`, { w: 844, h: 390, touch: true });
    const tag = t => `${t}${w === 1440 ? '' : '-narrow'}`;
    await S.open(); await S.shot(tag('home-no-pass'), 'teacher');
    await T.open(`#pass=${makePass()}`); await T.shot('home', 'teacher');
    const code = await createRoom(T, { title: '3학년 2반', rank: true, big: true, shots: 'dialog-', kind: 'teacher' });
    await until(async () => (await T.room())?.teacher); await T.shot('screen-empty', 'teacher');
    await S.open(`?room=${code}`); await S.page.waitForSelector('.w-ctl'); await S.page.locator('[data-own]').click(); await S.page.waitForSelector('.w-wait'); await S.shot(tag('student-wait'), 'teacher');
    await P.open(`?room=${code}`); await P.page.waitForSelector('.w-ctl');
    await say(S, '[data-nick]', '달팽이'); await S.shot(tag('student-nick'), 'teacher'); await S.page.locator('.w-dialog [data-send]').click();
    await say(P, '[data-nick]', '가나다라마바사아자차'); await P.shot(tag('pad-nick'), 'teacher'); await P.page.locator('.w-dialog [data-send]').click();
    await until(async () => (await T.room()).asks.length === 2);
    if (w < 1100) { await T.shot('strip-badge', 'teacher'); await T.page.locator('[data-teach]').first().click(); }
    await T.shot('screen-asks', 'teacher');
    await T.page.locator('.w-teach [data-judge="no"]').first().click();
    await S.page.waitForFunction(() => document.querySelector('.w-nick-note')?.textContent.includes('다른 닉네임')); await S.shot(tag('student-rejected'), 'teacher');
    await S.page.locator('#w-nick').fill('고래'); await S.page.locator('.w-dialog [data-send]').click();
    await until(async () => (await T.room()).asks.length === 2);
    await T.page.locator('.w-teach [data-judge="yes"]').first().click(); await sleep(300); await T.page.locator('.w-teach [data-judge="yes"]').first().click();
    await until(async () => (await T.room()).names.length === 2);
    await T.shot('screen-names', 'teacher'); await S.shot(tag('student-named'), 'teacher'); await P.shot(tag('pad-named'), 'teacher');
    if (w < 1100) await T.page.locator('.w-teach [data-teach-close]').click();
    await pickStage(T, 'math/scale-equation', 0); await sleep(900);
    await T.shot('game', 'teacher'); await S.shot(tag('student-game'), 'teacher'); await P.shot(tag('pad-game'), 'teacher');
    await sleep(2600);
    await T.page.evaluate(() => { const wd = window.__world(); wd.doorOpen = true; wd.players.forEach(p => { p.inDoor = true; }); });
    await T.page.waitForFunction(() => document.querySelector('.w-end .w-rankline')?.textContent.includes('번째'), null, { timeout: 8000 });
    await T.shot('end', 'teacher'); await S.shot(tag('student-end'), 'teacher');
    await T.page.locator('.w-end [data-list]').click(); await T.page.waitForSelector('.w-ranks .w-rank'); await T.page.locator('.w-ranks').scrollIntoViewIfNeeded(); await T.shot('pack-ranks', 'teacher');
    await T.close(); await S.close(); await P.close();
  }
  // 360 폭 학생 화면
  const T = await device('선생님 360', { w: 1440, h: 900 }), S = await device('학생 360', { w: 360, h: 740, touch: true });
  await T.open(`#pass=${makePass()}`); const code = await createRoom(T, { title: '수요일 3교시 수학 3학년 2반 모둠', rank: true });
  await S.open(`?room=${code}`); await S.page.waitForSelector('.w-wait'); await S.shot('student-wait', 'teacher');
  await say(S, '[data-nick]', '가나다라마바사아자차'); await S.shot('student-nick', 'teacher'); await S.page.locator('.w-dialog [data-send]').click();
  await until(async () => (await T.room()).asks.length === 1); await T.page.locator('.w-teach [data-judge="yes"]').first().click();
  await pickStage(T, 'etc/tutorial', 0); await sleep(900); await S.shot('student-game', 'teacher'); await T.shot('game-long-title', 'teacher');
  await T.close(); await S.close();
}

// ---------- 화면 찍기: 1440 과 390 ----------
if (flag('shots') || flag('only-shots')) {
  for (const [w, h, touch] of [[1440, 900, false], [390, 844, true]]) {
    const P = await device(`공개 방 ${w}`), A = await device(`찍기 ${w}`, { w, h, touch }), B = await device(`찍기 손님 ${w}`, { w, h, touch });
    await P.open(); const pub = await createRoom(P, { pub: true }); await pickStage(P, 'math/scale-equation', 1);
    await A.open(); await A.page.waitForSelector(`[data-pub="${pub}"]`, { timeout: 12000 });
    await A.shot('home-entry-public');
    await A.page.locator('#w-code').fill('ab1'); await A.page.getByRole('button', { name: '들어가기', exact: true }).first().click(); await A.shot('note-bad-code');
    await A.page.locator('#w-code').fill('ZZZZZZ'); await A.page.getByRole('button', { name: '들어가기', exact: true }).first().click();
    await A.page.waitForFunction(() => document.querySelector('.w-online-note')?.textContent.includes('그런 방')); await A.shot('note-no-room');
    const code = await createRoom(A, { shots: '' });
    await A.shot('home-strip');
    await B.open(); await joinByCode(B, code); await B.shot('guest-wait');
    await A.page.locator('[data-open="math/scale-equation"]').click(); await A.page.waitForSelector('[data-stage]'); await A.shot('pack-in-room');
    await A.page.locator('[data-stage]').nth(0).click(); await A.page.waitForFunction(() => !!window.__world); await sleep(700);
    await A.shot('game-host-hud'); await B.shot('game-guest-hud');
    await sleep(6000); await A.shot('game-host-after-hint');
    if (w <= 560) { await A.page.locator('[data-pick]').click(); await A.page.waitForSelector('.w-strip'); }   // 좁은 화면에서는 친구 부르기가 고르는 화면의 방 줄에 있다
    await A.page.locator('[data-invite]').click(); await A.page.waitForSelector('.w-dialog [data-code]'); await A.shot('invite-again'); await A.page.keyboard.press('Escape');
    await A.close(); await B.close(); await P.close();
    // 방 만들기 창과 QR, 함께 보기 방의 조작기 화면
    const F = await device(`큰 화면 ${w}`, { w, h, touch }), G = await device(`조작기 ${w}`, { w, h, touch });
    await F.open(); const big = await createRoom(F, { big: true, shots: 'dialog-' });
    await G.open(`?room=${big}`); await G.page.waitForSelector('.w-ctl'); await G.shot('pad-waiting');
    await pickStage(F, 'etc/tutorial', 0); await sleep(800); await G.shot('pad-playing'); await F.shot('big-screen');
    await F.close(); await G.close();
  }
  // 조작기 가로 화면(휴대폰을 눕혀 쥔 모습)
  const F = await device('큰 화면 가로'), G = await device('조작기 가로', { w: 844, h: 390, touch: true });
  await F.open(); const big = await createRoom(F, { big: true }); await G.open(`?room=${big}`); await G.page.waitForSelector('.w-ctl'); await pickStage(F, 'etc/tutorial', 0); await sleep(600); await G.shot('pad-landscape');
  await F.page.locator('[data-invite]').click(); await G.page.locator('[data-own]').click(); await sleep(600); await G.shot('guest-game-landscape');
  await F.close(); await G.close();
  console.log(`화면을 ${shotDir} 에 찍었어요.`);
}

console.log('errors', errors.length ? errors.slice(0, 8).join('\n') : 'none');
await browser.close();
stopAll();
console.log(bad || errors.length ? `실패 ${bad}건, 화면 오류 ${errors.length}건` : '모두 통과');
process.exit(bad || errors.length ? 1 : 0);

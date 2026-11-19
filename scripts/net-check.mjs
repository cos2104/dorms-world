// 온라인으로 함께 하기를 실제 브라우저 여러 대로 끝까지 돌려 본다.
//   node scripts/net-check.mjs                      방 서버(wrangler dev)와 개발 서버를 스스로 띄우고 끝나면 끈다
//   node scripts/net-check.mjs --site <주소> --room <주소>   이미 떠 있는 것을 쓴다(예: http://127.0.0.1:5325/world/ http://127.0.0.1:8791)
//   --shots 를 붙이면 1440 · 390 폭 화면도 .verify/shots/online-*.png 로 찍는다. --only-shots 는 찍기만 한다.
// 브라우저 실행 파일은 PW_CHROME 으로 준다. 방 서버는 room-server/ 에서 npm i 를 한 번 해 두어야 한다.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const args = process.argv.slice(2), arg = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; }, flag = n => args.includes(`--${n}`);
const root = fileURLToPath(new URL('..', import.meta.url)), shotDir = `${root}.verify/shots/`;
const ROOM_PORT = 8793, SITE_PORT = 5327;
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
const roomUp = () => up(`${root}room-server/node_modules/.bin/wrangler`, ['dev', '--port', String(ROOM_PORT), '--inspector-port', '9333', '--ip', '127.0.0.1'], `${root}room-server`, { WRANGLER_SEND_METRICS: 'false' });
let roomKid = null, BARE = '';
if (ownRoom) { ROOM = `http://127.0.0.1:${ROOM_PORT}`; roomKid = roomUp(); await waitFor(`${ROOM}/`, '방 서버'); }
if (ownSite) {
  SITE = `http://127.0.0.1:${SITE_PORT}/world/`; BARE = `http://127.0.0.1:${SITE_PORT + 1}/world/`;
  up(`${root}node_modules/.bin/vite`, ['--port', String(SITE_PORT), '--strictPort', '--host', '127.0.0.1'], root, { VITE_ROOM_URL: ROOM });
  up(`${root}node_modules/.bin/vite`, ['--port', String(SITE_PORT + 1), '--strictPort', '--host', '127.0.0.1'], root, { VITE_ROOM_URL: '' });   // 방 서버 주소 없이 지은 화면
  await waitFor(SITE, '개발 서버'); await waitFor(BARE, '개발 서버(방 서버 주소 없음)');
}
const ORIGIN = new URL(SITE).origin, WS = ROOM.replace(/^http/, 'ws');
const stopAll = () => { for (const k of kids) { try { k.kill('SIGTERM'); } catch { /* 이미 꺼짐 */ } } };
process.on('exit', stopAll); process.on('SIGINT', () => { stopAll(); process.exit(130); });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let bad = 0;
const ok = (name, pass, detail = '') => { console.log(`${pass ? 'OK    ' : 'FAILED'} ${name}${detail ? `: ${detail}` : ''}`); if (!pass) bad++; };
async function device(name, { w = 1280, h = 720, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e}`));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  const d = { name, ctx, page, w,
    open: async (path = '') => { await page.goto(SITE + path, { waitUntil: 'networkidle' }); await page.waitForSelector('.w-root'); },
    room: () => page.evaluate(() => window.__room?.() ?? null),
    net: () => page.evaluate(() => window.__net?.() ?? null),
    world: () => page.evaluate(() => { const w = window.__world?.(); return w ? { n: w.players.length, xs: w.players.map(p => Math.round(p.x * 10) / 10), ys: w.players.map(p => Math.round(p.y * 10) / 10), colors: w.players.map(p => p.color), carry: w.players.map(p => p.carry?.kind ?? null), inDoor: w.players.map(p => p.inDoor), lines: w.scales.map(s => s.lines), line: w.scales.map(s => s.line), solved: w.scales.map(s => s.solved), tilt: w.scales.map(s => s.tilt), key: [Math.round(w.key.x), Math.round(w.key.y), w.key.holder, w.key.used], open: w.doorOpen, won: w.won, cols: w.stage.cols, hint: w.stage.hint } : null; }),
    hold: async (code, ms) => { await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code); },
    shot: async tag => { mkdirSync(shotDir, { recursive: true }); await sleep(250); await page.screenshot({ path: `${shotDir}online-${tag}-${w}.png` }); },
    close: () => ctx.close(),
  };
  return d;
}
/** 방 만들기 창을 거쳐 방을 연다. 방 코드를 돌려준다. */
async function createRoom(d, { pub = false, big = false, shots = '' } = {}) {
  await d.page.getByRole('button', { name: '방 만들기' }).first().click();
  await d.page.waitForSelector('.w-dialog [data-make]');
  if (pub) await d.page.locator('.w-dialog [data-pub="1"]').click();
  if (big) await d.page.locator('.w-dialog [data-big="1"]').click();
  if (shots) await d.shot(`${shots}create`);
  await d.page.locator('.w-dialog [data-make]').click();
  await d.page.waitForSelector('.w-dialog [data-code]');
  const code = (await d.page.locator('.w-dialog [data-code]').textContent()).trim();
  if (shots) await d.shot(`${shots}invite-qr`);
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
function ghost(code, { view = 'play', send = true } = {}) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${WS}/room/${code}?mode=join&view=${view}`, { headers: { Origin: ORIGIN } });
    const g = { ws, seat: -1, got: 0, bytes: 0, no: 0, timer: null, n: 0 };
    ws.onmessage = e => {
      if (typeof e.data !== 'string') return;
      if (e.data.startsWith('{"t":"s"')) { g.got++; g.bytes += e.data.length; return; }
      const m = JSON.parse(e.data);
      if (m.t === 'no') { g.no = m.c; res(g); }
      if (m.t === 'hi') {
        g.seat = m.me;
        if (send) g.timer = setInterval(() => { if (Math.random() < 0.2) g.n++; if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'p', m: [-1, 0, 1][Math.floor(Math.random() * 3)], j: Math.random() < 0.3 ? 1 : 0, a: 0, n: g.n })); }, 33);
        res(g);
      }
    };
    ws.onerror = () => rej(new Error('손님이 붙지 못했어요'));
    g.close = () => { clearInterval(g.timer); try { ws.close(); } catch { /* 이미 닫힘 */ } };
  });
}

if (!flag('only-shots')) {
  // ---------- 1. 방 만들기 → 코드로 들어오기 → 각자 움직이기 ----------
  const A = await device('A'), B = await device('B');
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
  ok('실제 키로 두 도름이가 각자 움직인다', Math.abs(moved[0] - 70) < 25 && Math.abs(moved[1] - 122) < 25, `방장 +${Math.round(moved[0])}px(0.4초, 기대 70), 손님 +${Math.round(moved[1])}px(0.7초, 기대 122)`);
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
    if (guard === 0) { const [a, b] = await Promise.all([A.world(), B.world()]); ok('든 구슬이 두 화면에 똑같이 보인다', a.carry.join() === 'marble,marble' && b.carry.join() === 'marble,marble', `방장 화면 ${a.carry} / 손님 화면 ${b.carry}`); }
    await put(0, lbin); await put(1, rbin); await sleep(120);
    await enter(A); await enter(B);                       // 통에 버린다
    await sleep(750);
    const [a, b] = await Promise.all([A.world(), B.world()]);
    if (JSON.stringify(a.lines) !== JSON.stringify(b.lines)) same = false;
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
  const before = await B.world();
  await A.close();
  const promoted = await until(async () => (await B.net())?.isHost === true && (await B.world()).n === 2 && (await C.world()).n === 2, 8000);
  ok('방장이 나가면 그다음으로 오래된 손님이 방장이 된다', !!promoted, `남은 도름이 색 ${(await B.world()).colors}`);
  ok('나간 사람의 도름이만 빠지고 남은 도름이는 제자리다', near((await B.world()).xs, before.xs.slice(1), 3));
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
  const list = await (await fetch(`${ROOM}/public`, { headers: { Origin: ORIGIN } })).json();
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

// ---------- 11. 방 서버가 새로 떠도(배포) 방이 이어진다 · 방 서버 주소가 없으면 들머리가 없다 ----------
if (!flag('only-shots') && ownRoom) {
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
if (!flag('only-shots') && BARE) {
  const Z = await device('주소 없음');
  await Z.page.goto(`${BARE}?room=ABCDEF`, { waitUntil: 'networkidle' }); await Z.page.waitForSelector('.ar-grid');
  ok('방 서버 주소가 비어 있으면 온라인 들머리를 그리지 않는다(방 코드가 붙은 주소도 처음 화면으로)', await Z.page.locator('.w-online, .w-strip, [data-room-new], #w-code').count() === 0 && (await Z.room()) === null);
  await Z.page.locator('[data-open="etc/tutorial"]').click(); await Z.page.locator('[data-stage]').first().click(); await Z.page.waitForFunction(() => !!window.__world);
  ok('방 서버 주소가 없어도 연습 방식은 그대로 돈다', (await Z.world()).n >= 2 && await Z.page.locator('[data-swap]').count() === 1);
  await Z.close();
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

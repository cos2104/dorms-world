// 실제 키 입력으로 뛰기가 버려지지 않는지 본다(개발 서버 전용): node scripts/jump-check.mjs [주소]
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:5311/world/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(base + 'g/etc/tutorial', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '2명', exact: true }).click();
await page.getByRole('button', { name: /처음 만난 장치들/ }).click();
await page.waitForTimeout(700);
await page.keyboard.press('Tab');                       // 2번(오른쪽) 도름이
// 뛴 횟수를 페이지 안에서 센다(속도가 위쪽으로 바뀌는 순간)
await page.evaluate(() => { window.__jumps = 0; let prev = 0; const tick = () => { const p = window.__world().players[1]; if (prev >= 0 && p.vy < -300) window.__jumps++; prev = p.vy; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
const jumps = () => page.evaluate(() => window.__jumps);
const wallSpot = () => page.evaluate(() => { const w = window.__world(); const p = w.players[1]; p.x = 30 * 30 - 60; p.y = 15 * 30 - p.h - 0.5; p.vy = 0; });
const tap = async (code, ms = 40) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); };
let bad = 0;
const report = (name, ok, detail) => { console.log(`${ok ? 'OK    ' : 'MISSED'} ${name}: ${detail}`); if (!ok) bad++; };

// 1. 높은 벽(뛰어도 못 넘는다)에 막힌 채 오른쪽을 누르고, 내려설 때마다 누른다
await wallSpot();
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(600);
let before = await jumps(), presses = 0;
for (const gap of [700, 690, 680, 720, 700, 675, 710, 695, 705, 685, 730, 700]) { await tap('Space'); presses++; await page.waitForTimeout(gap - 40); }
await page.waitForTimeout(400);
report('벽에 막힌 채, 내려설 때마다 누름', (await jumps()) - before === presses, `${presses}번 눌러 ${(await jumps()) - before}번 뜀`);

// 2. 벽에 막힌 채 마구 누른다(0.28초마다 6초): 내려서자마자 다시 떠야 한다(한 번 뛰는 데 0.67초쯤)
before = await jumps();
const t0 = Date.now(); while (Date.now() - t0 < 6000) { await tap('Space', 50); await page.waitForTimeout(230); }
await page.waitForTimeout(700);
const mash = (await jumps()) - before;
report('벽에 막힌 채 마구 누름(6초)', mash >= 8, `${mash}번 뜀(쉬지 않고 뛰면 8~9번)`);

// 3. 오른쪽 + ↑ 를 누른 채 스페이스(키 셋이 겹침)
await page.waitForTimeout(500);
before = await jumps();
await page.keyboard.down('ArrowUp'); await page.waitForTimeout(900);          // ↑ 로 한 번 뛰고 내려선다
const afterUp = (await jumps()) - before;
await page.keyboard.down('Space'); await page.waitForTimeout(300);
const afterSpace = (await jumps()) - before;
await page.keyboard.up('Space'); await page.keyboard.up('ArrowUp');
report('오른쪽 + ↑ 를 누른 채 스페이스', afterUp === 1 && afterSpace === 2, `↑ 뒤 ${afterUp}번, 스페이스 뒤 ${afterSpace}번`);
await page.keyboard.up('ArrowRight');

// 4. 달리며 방향을 바꿀 때 좌우가 겹쳐도 멈추지 않고, 그 상태에서 뛰기도 된다
await page.evaluate(() => { const w = window.__world(); const p = w.players[1]; p.x = 8 * 30; p.y = 15 * 30 - p.h - 0.5; p.vy = 0; });
await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(200);
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(250);      // 왼쪽을 떼지 않고 오른쪽
const vx = await page.evaluate(() => window.__world().players[1].vx);
before = await jumps(); await tap('Space', 60); await page.waitForTimeout(200);
report('좌우를 겹쳐 누름', vx > 0 && (await jumps()) - before === 1, `속도 ${vx}(오른쪽이면 양수), 뛰기 ${(await jumps()) - before}번`);
await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight');

console.log('errors', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(bad || errors.length ? 1 : 0);

// 실제 브라우저에서 키를 눌러 도름이가 움직이는지 본다: node scripts/play-check.mjs [주소]
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:5310/world/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '들어가기' }).first().click();
await page.getByRole('button', { name: '2명' }).click();
await page.getByRole('button', { name: /처음 만난 장치들/ }).click();
await page.waitForTimeout(800);
const at = () => page.evaluate(() => { const w = window.__world(); return w.players.map(p => [Math.round(p.x), Math.round(p.y), p.on, p.inDoor]); });
const a0 = await at();
// 1번(왼쪽)은 바로 옆에 선 2번에게 막힌다
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(700); await page.keyboard.up('ArrowRight');
const a1 = await at();
console.log('blocked by neighbour:', a1[0][0] + 22 <= a1[1][0], JSON.stringify([a0[0], a1[0], a1[1]]));
// 2번으로 바꿔 1초 걷고, 뛴다
await page.keyboard.press('Tab');
await page.keyboard.down('KeyD'); await page.waitForTimeout(1000); await page.keyboard.up('KeyD');
const a2 = await at();
await page.keyboard.press('Space'); await page.waitForTimeout(150);
const a3 = await at();
console.log('moved', a2[1][0] - a1[1][0], 'px in 1s (175 expected) · jumped', a3[1][1] < a2[1][1]);
// 열린 문 앞: 닿기만 해서는 안 들어가고 확인(엔터)을 눌러야 들어간다
await page.evaluate(() => { const w = window.__world(); const d = w.stage.door; w.doorOpen = true; w.key.used = true; const p = w.players[1]; p.x = d.x + 20; p.y = d.y + d.h - p.h; p.vy = 0; });
await page.waitForTimeout(500);
const b0 = await at();
await page.screenshot({ path: '.shots/play-door.png' });
await page.keyboard.press('Enter'); await page.waitForTimeout(200);
const b1 = await at();
console.log('door: before confirm inDoor', b0[1][3], '· after confirm inDoor', b1[1][3]);
await page.screenshot({ path: '.shots/play-moved.png' });
await page.getByRole('button', { name: /나가기/ }).click();
console.log('back to pack screen:', await page.getByRole('button', { name: /처음 만난 장치들/ }).count() === 1, '· url', page.url());
console.log('errors', errors.length ? errors.slice(0, 5).join('\n') : 'none');
await browser.close();

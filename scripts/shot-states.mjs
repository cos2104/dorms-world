// 게임 화면의 상태별 캡처: node scripts/shot-states.mjs [주소]
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:5311/world/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
async function open(w, h, people, touch = false) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + 'g/etc/tutorial', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: `${people}명`, exact: true }).click();
  await page.getByRole('button', { name: /처음 만난 장치들/ }).click();
  await page.waitForTimeout(900);
  return page;
}
let page = await open(1440, 900, 8);
await page.evaluate(() => { const w = window.__world(); w.players.forEach((p, i) => { p.x = 560 + i * 42; }); });
await page.waitForTimeout(700);
await page.screenshot({ path: '.shots/play-8.png' });
await page.evaluate(() => { const w = window.__world(); w.doorOpen = true; w.players.forEach(p => { p.inDoor = true; }); w.won = true; });
await page.waitForTimeout(500);
await page.screenshot({ path: '.shots/end.png' });
const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
await page.keyboard.press('Tab');
const afterTab = await page.evaluate(() => document.activeElement?.textContent?.trim());
console.log('end dialog focus:', focused, '→ Tab →', afterTab);
await page.close();
page = await open(844, 390, 30, true);
await page.screenshot({ path: '.shots/play-phone-30.png' });
console.log('touch pad visible:', await page.locator('.w-pad button').first().isVisible());
await page.close();
console.log('errors', errors.length ? errors.slice(0, 5).join('\n') : 'none');
await browser.close();

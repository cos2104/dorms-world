// 화면 확인용: node scripts/shot.mjs <주소> <저장이름> [가로] [세로] [단계...]
import { chromium } from 'playwright';
const [url, name, w = '1440', h = '900', ...steps] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: +w < 600, isMobile: +w < 600 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
for (const s of steps) {
  const [kind, arg] = s.split('=');
  if (kind === 'click') await page.getByRole('button', { name: arg }).first().click();
  else if (kind === 'key') await page.keyboard.press(arg);
  else if (kind === 'type') await page.keyboard.type(arg, { delay: 30 });
  else if (kind === 'wait') await page.waitForTimeout(+arg);
  else if (kind === 'eval') await page.evaluate(arg);
}
await page.waitForTimeout(800);
await page.screenshot({ path: `${process.env.HOME}/dorms-world/.shots/${name}.png` });
console.log('errors', errors.length ? errors.slice(0, 6).join('\n') : 'none');
await browser.close();

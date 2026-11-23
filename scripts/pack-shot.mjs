// 팩의 모든 스테이지 첫 화면을 찍는다: node scripts/pack-shot.mjs <팩 id> [인원] [주소] [가로] [세로]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const SHOTS = join(fileURLToPath(new URL('..', import.meta.url)), '.shots') + (process.platform === 'win32' ? '\\' : '/');   // 윈도우·맥 어디서나 같은 폴더
mkdirSync(SHOTS, { recursive: true });
const [pack = 'math/scale-equation', people = '2', base = 'http://localhost:5310/world/', w = '1280', h = '800'] = process.argv.slice(2);
if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(pack) || !/^\d{1,2}$/.test(people) || !/^\d{3,4}$/.test(w) || !/^\d{3,4}$/.test(h)) { console.error('인자를 확인해 주세요.'); process.exit(1); }
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}g/${pack}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}pack-${pack.replace('/', '_')}-list-${w}.png` });
const count = await page.locator('[data-stage]').count();
for (let i = 0; i < count; i++) {
  await page.goto(`${base}g/${pack}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: `${people}명`, exact: true }).first().click().catch(() => {});
  await page.locator('[data-stage]').nth(i).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}pack-${pack.replace('/', '_')}-${String(i + 1).padStart(2, '0')}-${people}p-${w}.png` });
}
console.log('스테이지', count, 'errors', errors.length ? errors.slice(0, 6).join('\n') : 'none');
await browser.close();

// 게임 화면 위쪽 줄이 한 줄로 서고 넘치지 않는지 폭마다 잰다: node scripts/hud-check.mjs [주소]
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:5311/world/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
let bad = 0;
for (const [w, h, touch] of [[1440, 900, false], [844, 390, true], [667, 375, true], [390, 844, true]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  await page.goto(base + 'g/etc/tutorial', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '30명', exact: true }).click();
  await page.getByRole('button', { name: /처음 만난 장치들/ }).click();
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const hud = document.querySelector('.lab-hud'), box = hud.getBoundingClientRect();
    const kids = [...hud.querySelectorAll('.w-hud-l > *, .w-hud-r > *')].map(e => e.getBoundingClientRect());
    const mids = kids.map(k => Math.round(k.top + k.height / 2));
    const btns = [...hud.querySelectorAll('button')].map(b => { const k = b.getBoundingClientRect(); return [Math.round(k.width), Math.round(k.height), b.getAttribute('aria-label') || b.textContent.trim()]; });
    let overlap = 0; for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) if (kids[i].right > kids[j].left + 0.5 && kids[j].right > kids[i].left + 0.5) overlap++;
    return { spread: Math.max(...mids) - Math.min(...mids), inside: kids.every(k => k.left >= box.left - 0.5 && k.right <= box.right + 0.5), overlap, scrollX: document.documentElement.scrollWidth - innerWidth, btns };
  });
  const ok = r.spread <= 1 && r.inside && r.overlap === 0 && r.scrollX <= 0 && r.btns.every(b => b[1] >= 36 && b[0] >= 36);
  if (!ok) bad++;
  console.log(`${w}x${h}`, ok ? 'OK' : 'BAD', JSON.stringify(r));
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);

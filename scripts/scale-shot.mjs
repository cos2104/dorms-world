// 저울 화면 확인용: node scripts/scale-shot.mjs [주소] [가로] [세로]
// 연습 팩의 저울 스테이지를 열고, 실제 확인 키로 구슬을 들고 버리고 나누며 장면마다 찍는다.
import { chromium } from 'playwright';
const [base = 'http://localhost:5311/world/', w = '1280', h = '800', pack = 'etc/tutorial', stageName = '저울 익히기'] = process.argv.slice(2);
if (!/^\d{3,4}$/.test(w) || !/^\d{3,4}$/.test(h)) { console.error('가로와 세로는 숫자로 적어 주세요.'); process.exit(1); }
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}g/${pack}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: '2명' }).first().click().catch(() => {});
await page.getByRole('button', { name: stageName }).first().click();
await page.waitForTimeout(1500);
const shot = async name => { await page.waitForTimeout(350); await page.screenshot({ path: `${new URL('../.shots/', import.meta.url).pathname}scale-${name}-${w}.png` }); };
const put = (i, x) => page.evaluate(([i, x]) => { const wd = window.__world(); const p = wd.players[i]; p.x = x; p.y = wd.stage.scales[0].floor - p.h; p.vx = 0; p.vy = 0; }, [i, x]);
const info = () => page.evaluate(() => { const wd = window.__world(); const s = wd.scales[0], d = wd.stage.scales[0]; return { x: s.x, line: s.line, lines: s.lines, mode: s.mode, tilt: s.tilt, solved: s.solved, note: s.note, pans: d.pans, bins: wd.stage.bins.map(b => b.x), levers: wd.stage.levers.map(l => [l.does, l.x]), active: [...wd.active] }; });
const enter = async () => { await page.keyboard.press('Enter'); await page.waitForTimeout(120); };
const tab = async () => { await page.keyboard.press('Tab'); await page.waitForTimeout(120); };
const st = await info();
const L = st.pans[0], R = st.pans[1];
const spot = { lm: L.x + L.w * 0.7, rm: R.x + R.w * 0.7, lb: L.x + 20, lbin: st.bins[0] + 4, rbin: st.bins[1] + 4, addsub: st.levers.find(l => l[0] === 'addsub')[1] + 4, divide: st.levers.find(l => l[0] === 'divide')[1] + 4 };
console.log('시작', JSON.stringify(st.line), 'x =', st.x);
await shot('1-start');
// 도름이 0(왼쪽 담당)이 구슬 하나를 든다 → 기운다
await put(0, spot.lm); await put(1, spot.rm); await enter();
await page.waitForTimeout(600); await shot('2-tilt');
console.log('한쪽만', JSON.stringify((await info()).line), 'tilt', (await info()).tilt);
// 통은 아직 더하기라 못 버린다
await put(0, spot.lbin); await enter(); await shot('3-refuse');
console.log('알림', (await info()).note);
// 레버를 빼기로
await put(0, spot.addsub); await page.waitForTimeout(200); await shot('4-lever-hint'); await enter();
await put(0, spot.lbin); await enter();
// 도름이 1(오른쪽 담당)도 하나 버린다
await tab(); await enter(); await put(1, spot.rbin); await enter(); await page.waitForTimeout(900); await shot('5-one-line');
// 남은 구슬을 양쪽에서 같은 만큼 치운다
for (let guard = 0; guard < 12; guard++) {
  const s = await info(); if (s.line[1] === 0) break;
  await tab(); await put(0, spot.lm); await enter(); await put(0, spot.lbin); await enter();
  await tab(); await put(1, spot.rm); await enter(); await put(1, spot.rbin); await enter(); await page.waitForTimeout(700);
}
await shot('6-subtracted');
console.log('빼고 나서', JSON.stringify((await info()).lines));
await put(1, spot.divide); await page.waitForTimeout(200); await enter(); await page.waitForTimeout(700); await shot('7-divided');
await page.waitForTimeout(1500); await shot('8-solved');
const end = await info();
console.log('끝', JSON.stringify(end.lines), 'solved', end.solved, 'bridge', end.active);
console.log('errors', errors.length ? errors.slice(0, 6).join('\n') : 'none');
await browser.close();

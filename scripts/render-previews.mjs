// 팩의 맵 미리보기를 그림 파일로 뽑는다(오락실 카드와 공유 그림에 쓴다): node scripts/render-previews.mjs [<교과>/<팩> ...]
// 팩을 적지 않으면 실린 팩 전부. 게임 화면이 카드에 그리는 미리보기(첫 스테이지)를 그대로 받아 두 배로 키워 public/previews/<교과>--<팩>.png 로 쓴다.
// 개발 서버를 잠깐 띄워 실제 브라우저에서 받는다. 브라우저: PW_CHROME(실행 파일 경로) 또는 설치된 크롬.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const want = process.argv.slice(2).filter(a => /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/.test(a));
const PORT = 5390 + Math.floor(Math.random() * 9);
const win = process.platform === 'win32';
const server = spawn(win ? 'npx.cmd' : 'npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', shell: win, env: { ...process.env, VITE_ROOM_URL: '' } });
const stop = () => { try { server.kill(); } catch { /* 이미 끝남 */ } };
process.on('exit', stop);
const base = `http://127.0.0.1:${PORT}/world/`;
let up = false;
for (let i = 0; i < 60 && !up; i++) { await new Promise(r => setTimeout(r, 500)); try { up = (await fetch(base)).ok; } catch { /* 아직 */ } }
if (!up) { console.error('개발 서버가 뜨지 않았어요.'); stop(); process.exit(1); }
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : { channel: 'chrome' });
let made = 0;
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-pack] canvas');
  await page.waitForTimeout(600);   // 그림과 글꼴이 다 그려질 때까지
  const shots = await page.evaluate(() => [...document.querySelectorAll('[data-pack]')].map(card => {
    const src = card.querySelector('canvas'); if (!src) return null;
    const big = document.createElement('canvas'); big.width = src.width * 2; big.height = src.height * 2;
    const c = big.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(src, 0, 0, big.width, big.height);   // 도트가 뭉개지지 않게 그대로 키운다
    return { id: card.getAttribute('data-pack'), png: big.toDataURL('image/png') };
  }).filter(Boolean));
  mkdirSync('public/previews', { recursive: true });
  for (const s of shots) {
    if (!/^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/.test(s.id) || (want.length && !want.includes(s.id))) continue;
    const bytes = Buffer.from(s.png.split(',')[1], 'base64');
    if (bytes.length < 2000) { console.error(`${s.id}: 그림이 비어 있어요.`); continue; }
    writeFileSync(`public/previews/${s.id.replace('/', '--')}.png`, bytes);
    console.log(`${s.id}: public/previews/${s.id.replace('/', '--')}.png (${Math.round(bytes.length / 1000)}KB)`);
    made++;
  }
} finally { await browser.close(); stop(); }
if (want.length && made < want.length) { console.error('뽑지 못한 팩이 있어요.'); process.exit(1); }

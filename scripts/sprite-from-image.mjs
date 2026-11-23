// 그림 파일(png·jpg·webp)을 판의 글자 그림으로 바꾼다: 판의 물감으로만 칠하고 가장자리를 남색 윤곽으로 두른다.
// Higgsfield 같은 그림 도구로 뽑은 그림도 이 길을 거쳐야 팩에 들어간다(화풍을 하나로 지키는 약속).
//   npm run sprite:image -- <그림 파일> <교과>/<팩> <그림 이름> [--width 24]
// 그림 파일은 읽기만 한다. 팩에는 sprites/<그림 이름>.txt 하나만 생긴다(원본 그림 파일은 팩에 넣지 않는다).
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const width = Number(flag('--width', '24'));
const force = args.includes('--force'); if (force) args.splice(args.indexOf('--force'), 1);
const [file, pack, name] = args;
const stop = msg => { console.error(msg); process.exit(1); };
if (!file || !pack || !name) stop('쓰는 법: npm run sprite:image -- <그림 파일> <교과>/<팩> <그림 이름> [--width 24]');
if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(pack)) stop('팩은 <교과>/<팩> 모양으로 적어 주세요. 예: science/digestion');
if (!/^[a-z0-9-]{1,40}$/.test(name)) stop('그림 이름은 영문 소문자, 숫자, 줄표로 40자까지예요.');
if (!Number.isInteger(width) || width < 6 || width > 48) stop('--width 는 6~48 점이에요(한 점이 화면에서 2px).');
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(file).toLowerCase()];
if (!mime) stop('png, jpg, webp 그림만 바꿀 수 있어요.');
if (!existsSync(file)) stop(`그림 파일이 없어요: ${file}`);
const bytes = readFileSync(file);
if (bytes.length > 20 * 1024 * 1024) stop('그림 파일이 너무 커요(20MB까지).');
const dir = join('packs', pack, 'sprites'), out = join(dir, `${name}.txt`);
if (!existsSync(join('packs', pack, 'pack.json'))) stop(`packs/${pack}/pack.json 이 없어요. 팩 폴더를 먼저 만들어 주세요.`);
if (existsSync(out) && !force) stop(`${out} 이 이미 있어요. 바꾸려면 --force 를 붙여 주세요.`);

// 판(platform/sprite.ts)의 물감. 윤곽(n)은 마지막에 따로 두른다
const src = readFileSync(new URL('../platform/sprite.ts', import.meta.url), 'utf8');
const INKS = Object.fromEntries([...src.matchAll(/^\s+([a-z]): '#([0-9A-Fa-f]{6})'/gm)].map(m => [m[1], [0, 2, 4].map(k => parseInt(m[2].slice(k, k + 2), 16))]));
if (Object.keys(INKS).length < 10) stop('판의 물감 목록을 읽지 못했어요(platform/sprite.ts).');

// 그림을 읽는 일은 브라우저(캔버스)에 맡긴다: 윈도우·맥 어디서나 png·jpg·webp 를 똑같이 읽는다
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined }).catch(() => stop('브라우저를 열지 못했어요. 처음이면 npx playwright install chromium 을 한 번 돌려 주세요.'));
const page = await browser.newPage();
const px = await page.evaluate(async ({ b64, mime }) => {
  const img = new Image(); img.src = `data:${mime};base64,${b64}`; await img.decode();
  if (img.naturalWidth * img.naturalHeight > 40e6) return null;   // 너무 큰 그림은 읽지 않는다(컴퓨터가 멈추지 않게)
  // 먼저 가로세로 512점 안으로 줄여 그린 뒤 읽는다(글자 그림은 48점까지라 충분하다)
  const f = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * f)); c.height = Math.max(1, Math.round(img.naturalHeight * f));
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
  return { w: c.width, h: c.height, d: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
}, { b64: bytes.toString('base64'), mime });
await browser.close();
if (!px) stop('그림이 너무 커요(가로×세로 4천만 점까지). 작게 줄인 그림으로 다시 해 주세요.');

// 바탕 지우기: 투명하지 않은 그림이면 네 귀퉁이의 색을 바탕으로 본다
const at = (x, y) => { const i = (y * px.w + x) * 4; return px.d.slice(i, i + 4); };
const corners = [at(0, 0), at(px.w - 1, 0), at(0, px.h - 1), at(px.w - 1, px.h - 1)];
const opaque = corners.every(c => c[3] > 250);
const bg = corners[0];
const isBg = p => p[3] < 128 || (opaque && Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) < 60);
let x0 = px.w, y0 = px.h, x1 = -1, y1 = -1;
for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) if (!isBg(at(x, y))) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
if (x1 < 0) stop('그림에서 바탕 말고 그려진 것을 찾지 못했어요.');

// 줄이기: 그려진 부분을 가로 width 점(윤곽 두 점 포함)에 맞춘다
const inner = width - 2, scale = (x1 - x0 + 1) / inner;
const ih = Math.max(1, Math.min(46, Math.round((y1 - y0 + 1) / scale)));
const near = rgb => { let best = 'a', bd = Infinity; for (const [k, v] of Object.entries(INKS)) { if (k === 'n' || k === 'b') continue; const d = (v[0] - rgb[0]) ** 2 * 0.3 + (v[1] - rgb[1]) ** 2 * 0.59 + (v[2] - rgb[2]) ** 2 * 0.11; if (d < bd) { bd = d; best = k; } } return best; };
const grid = [];
for (let r = 0; r < ih; r++) {
  const row = [];
  for (let c = 0; c < inner; c++) {
    let n = 0, fill = 0; const sum = [0, 0, 0];
    for (let y = Math.floor(y0 + r * scale); y < Math.min(y1 + 1, Math.floor(y0 + (r + 1) * scale) || y0 + r + 1); y++)
      for (let x = Math.floor(x0 + c * scale); x < Math.min(x1 + 1, Math.floor(x0 + (c + 1) * scale) || x0 + c + 1); x++) {
        n++; const p = at(x, y); if (isBg(p)) continue; fill++; sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2];
      }
    row.push(fill * 2 >= n && fill ? near(sum.map(v => v / fill)) : '.');
  }
  grid.push(row);
}
// 윤곽: 한 점씩 바깥으로 넓혀 남색 테두리를 두른다
const H = ih + 2, W = width;
const pic = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (r > 0 && r <= ih && c > 0 && c <= inner ? grid[r - 1][c - 1] : '.')));
const filled = (r, c) => r >= 0 && c >= 0 && r < H && c < W && pic[r][c] !== '.';
const edge = [];
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (pic[r][c] === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dr, dc]) => filled(r + dr, c + dc))) edge.push([r, c]);
for (const [r, c] of edge) pic[r][c] = 'n';
const text = pic.map(r => r.join('')).join('\n') + '\n';
mkdirSync(dir, { recursive: true });
writeFileSync(out, text);
console.log(text);
console.log(`${out} 에 ${W}×${H} 점 그림으로 저장했어요. npm run check:packs 로 약속을 확인하고, 개발 서버 화면에서 직접 보세요.`);

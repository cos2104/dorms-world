/**
 * 그래프 공장의 두 창: 찍는 방(식 넣기)과 손잡이 방(지나는 점·x 범위 넣기).
 * 식 입력기는 앵그리매스 때 쓰던 MathLive 를 그대로 쓴다(그래프 장치가 있는 스테이지에서만 불러온다).
 * 창 안의 미리보기는 판과 같은 계산(readFormula · makeShape)을 쓴다. 맞고 틀림을 말하지 않고 모양을 보여 준다.
 */
import { icon } from '../platform/icons';
import { PALETTE } from '../platform/look';
import { esc } from '../platform/text';
import { readFormula, sampleRuns, type Formula } from '../platform/graph/expr';
import { fmt, makeShape, pointProblem, rangeProblem, trustLatex, RANGE_MAX, type Shape } from '../platform/graph/model';
import { latexText } from '../platform/graph/draw';
import type { Order } from '../platform/graph/order';

type MathField = HTMLElement & { value: string; mathVirtualKeyboardPolicy: string; smartFence: boolean; focus(): void };
let ml: Promise<void> | null = null;
/** MathLive 를 한 번만 불러온다. 글꼴은 이 사이트에 둔 것만 쓴다(바깥 주소로 나가지 않게). */
function loadMathLive() {
  ml ??= import('mathlive').then(m => {
    m.MathfieldElement.fontsDirectory = `${import.meta.env.BASE_URL}mathlive/fonts`;
    m.MathfieldElement.soundsDirectory = null;
    // 식 안의 링크를 여는 길을 막는다(\href 같은 것은 식 검사에서도 거절된다)
    const me = m.MathfieldElement as unknown as { openUrl?: (href: string) => void };
    if ('openUrl' in me) me.openUrl = () => undefined;
  });
  return ml;
}

export type PanelOpts = {
  host: HTMLElement;                 // 창을 붙일 곳(게임 판 상자)
  kind: 'press' | 'desk';
  fac: number;
  latex: () => string;               // 그 공장의 지금 식(손잡이 방에서 쓴다)
  send: (o: Order) => string;        // 주문을 넣는다. 돌려준 글은 창에 적는다(빈 글이면 닫는다)
  onClose: () => void;
};

const W = 360, H = 230, UNIT = 16;   // 미리보기 한 눈금 16px

/** 좌표평면(모눈, 축) 위에 곡선을 그린다. 보이는 x 범위는 [-11, 11], y 는 [-7, 7]. */
function plane(cv: HTMLCanvasElement, f: Formula | null, a?: number, b?: number, pt?: [number, number]) {
  const c = cv.getContext('2d')!, ox = W / 2, oy = H / 2;
  c.fillStyle = PALETTE.paper; c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(57,120,206,0.16)';
  for (let x = ox % UNIT; x < W; x += UNIT) c.fillRect(Math.round(x), 0, 1, H);
  for (let y = oy % UNIT; y < H; y += UNIT) c.fillRect(0, Math.round(y), W, 1);
  c.fillStyle = PALETTE.navy; c.fillRect(0, oy, W, 2); c.fillRect(ox, 0, 2, H);
  c.font = '10px Galmuri11, monospace'; c.textAlign = 'center';
  for (let k = -10; k <= 10; k += 5) if (k) { c.fillText(String(k), ox + k * UNIT, oy + 14); c.fillText(String(k), ox - 12, oy - k * UNIT + 4); }
  if (!f) return;
  const draw = (lo: number, hi: number, width: number, color: string) => {
    c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round';
    for (const run of sampleRuns(f, lo, hi, 0.05)) { c.beginPath(); run.forEach(([x, y], i) => { const px = ox + x * UNIT, py = oy - Math.max(-40, Math.min(40, y)) * UNIT; if (i) c.lineTo(px, py); else c.moveTo(px, py); }); c.stroke(); }
  };
  draw(-11.5, 11.5, 2, 'rgba(20,40,95,0.45)');
  if (a != null && b != null && b > a) {
    c.fillStyle = 'rgba(245,197,66,0.22)'; c.fillRect(ox + a * UNIT, 0, (b - a) * UNIT, H);
    draw(a, b, 4, PALETTE.navy);
  }
  if (pt) {
    c.fillStyle = PALETTE.navy; c.fillRect(ox + pt[0] * UNIT - 5, oy - pt[1] * UNIT - 5, 10, 10);
    c.fillStyle = PALETTE.button; c.fillRect(ox + pt[0] * UNIT - 3, oy - pt[1] * UNIT - 3, 6, 6);
  }
}

/** 손잡이를 세워 들었을 때의 모양(판에서 보이는 그대로). 잡는 곳이 아래 가운데. */
function lifted(cv: HTMLCanvasElement, shape: Shape | null) {
  const c = cv.getContext('2d')!, w = cv.width, h = cv.height;
  c.fillStyle = PALETTE.skyLow; c.fillRect(0, 0, w, h);
  if (!shape) return;
  const k = Math.min(1, (w - 20) / Math.max(30, shape.box.w), (h - 24) / Math.max(30, shape.box.h + 10));
  const gx = w / 2 - (shape.box.x + shape.box.w / 2) * k, gy = h - 8 - Math.max(0, shape.box.y + shape.box.h) * k;
  c.fillStyle = PALETTE.navy; c.fillRect(Math.round(gx) - 2, Math.round(gy - 26 * k), 4, Math.round(26 * k));
  c.strokeStyle = PALETTE.navy; c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const run of shape.runs) { c.beginPath(); run.forEach(([x, y], i) => (i ? c.lineTo(gx + x * k, gy + y * k) : c.moveTo(gx + x * k, gy + y * k))); c.stroke(); }
  c.strokeStyle = PALETTE.key; c.lineWidth = 2;
  for (const run of shape.runs) { c.beginPath(); run.forEach(([x, y], i) => (i ? c.lineTo(gx + x * k, gy + y * k) : c.moveTo(gx + x * k, gy + y * k))); c.stroke(); }
  c.fillStyle = PALETTE.button; c.fillRect(Math.round(gx) - 3, Math.round(gy - 26 * k) - 3, 6, 6);
}

/** 창을 연다. 닫는 함수를 돌려준다. */
export function openPanel(o: PanelOpts): () => void {
  const el = document.createElement('div');
  el.className = 'w-end w-gpanel';
  const press = o.kind === 'press';
  el.innerHTML = `<div class="ar-cabinet lab-modal" role="dialog" aria-modal="true" aria-label="${press ? '찍는 방' : '손잡이 방'}"><div class="ar-bezel"><div class="ar-brand"><span class="ar-badge">${press ? 'PRESS' : 'HANDLE'}</span> ${press ? '찍는 방' : '손잡이 방'}</div></div><div class="ar-screen"><div class="ar-screen-inner">
    ${press
      ? `<p class="ar-sub w-gp-lead">함수식을 넣으면 그 모양으로 그래프를 찍어요. 손잡이 방에서 점과 범위를 정하면 출구로 나와요.</p>
         <div class="w-gp-row"><span class="w-gp-fx">y =</span><div class="w-gp-mf"><span class="w-gp-wait">식 입력기를 여는 중이에요</span></div></div>`
      : `<p class="ar-sub w-gp-lead">지금 식 <b class="w-gp-cur"></b></p>
         <div class="w-gp-grid">
           <label>지나는 점 x<input type="number" step="0.5" inputmode="decimal" data-v="x0" value="0"></label>
           <label>지나는 점 y<input type="number" step="0.5" inputmode="decimal" data-v="y0" value=""></label>
           <label>x 범위 시작<input type="number" step="0.5" inputmode="decimal" data-v="a" value="-2"></label>
           <label>x 범위 끝<input type="number" step="0.5" inputmode="decimal" data-v="b" value="2"></label>
         </div>`}
    <div class="w-gp-views"><canvas class="w-gp-plane" width="${W}" height="${H}" role="img" aria-label="좌표평면 미리보기"></canvas>${press ? '' : `<figure class="w-gp-lift"><canvas width="150" height="${H}" role="img" aria-label="손잡이를 세워 든 모양"></canvas><figcaption>세워 들면</figcaption></figure>`}</div>
    <p class="w-gp-msg" aria-live="polite"></p>
    <div class="lab-actions"><button class="ar-key mustard" data-ok>${icon('check', 17)}${press ? '식 넣기' : '그래프 찍기'}</button><button class="ar-key ghost" data-close>${icon('close', 17)}닫기</button></div>
  </div></div></div>`;
  o.host.appendChild(el);
  const msg = el.querySelector<HTMLElement>('.w-gp-msg')!, cv = el.querySelector<HTMLCanvasElement>('.w-gp-plane')!;
  const say = (t: string) => { msg.textContent = t; };
  let closed = false;
  const close = () => { if (closed) return; closed = true; window.removeEventListener('keydown', onKey, true); el.remove(); o.onClose(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  window.addEventListener('keydown', onKey, true);
  el.querySelector<HTMLButtonElement>('[data-close]')!.onclick = close;
  const ok = el.querySelector<HTMLButtonElement>('[data-ok]')!;

  if (press) {
    plane(cv, null);
    let mf: MathField | null = null;
    const latex = () => (mf?.value ?? '').trim();
    const update = () => {
      const t = latex();
      if (!t) { plane(cv, null); say(''); return; }
      const r = readFormula(t);
      plane(cv, r.ok ? r.formula : null);
      say(r.ok ? '' : r.reason);
    };
    const submit = () => {
      const r = readFormula(latex());
      if (!r.ok) { say(r.reason); return; }
      const out = o.send({ k: 'f', fac: o.fac, latex: latex() });
      if (out) say(out); else close();
    };
    ok.onclick = submit;
    loadMathLive().then(() => {
      if (closed) return;
      mf = document.createElement('math-field') as MathField;
      mf.setAttribute('aria-label', '함수식 입력');
      mf.mathVirtualKeyboardPolicy = window.matchMedia('(pointer: coarse)').matches ? 'auto' : 'manual';
      mf.smartFence = true;
      const cur = trustLatex(o.latex()); if (cur) mf.value = cur;   // 수식으로 다시 쓴 것만 넣는다
      mf.addEventListener('input', update);
      mf.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      el.querySelector('.w-gp-mf')!.replaceChildren(mf);
      update();
      setTimeout(() => mf?.focus(), 30);
    }, () => say('식 입력기를 불러오지 못했어요. 새로 고침해 주세요'));
  } else {
    const cur = trustLatex(o.latex()), f = cur ? readFormula(cur) : null;
    el.querySelector('.w-gp-cur')!.textContent = cur ? `y = ${latexText(cur)}` : '아직 없어요';
    const lift = el.querySelector<HTMLCanvasElement>('.w-gp-lift canvas')!;
    const inputs = [...el.querySelectorAll<HTMLInputElement>('input[data-v]')];
    const val = (k: string) => { const v = inputs.find(i => i.dataset.v === k)!.value.trim(); return v === '' ? NaN : Number(v); };
    const yIn = inputs.find(i => i.dataset.v === 'y0')!;
    const update = () => {
      if (!f?.ok) { plane(cv, null); lifted(lift, null); say('찍는 방에서 식을 먼저 넣어 주세요'); return null; }
      const x0 = val('x0'), y0 = val('y0'), a = val('a'), b = val('b');
      plane(cv, f.formula, a, b, Number.isFinite(x0) && Number.isFinite(y0) ? [x0, y0] : undefined);
      const bad = rangeProblem(a, b, x0) ?? (Number.isFinite(y0) ? pointProblem(f.formula, x0, y0) : '지나는 점의 y 를 적어 주세요');
      const shape = bad ? null : makeShape({ latex: cur, a, b, x0 });
      lifted(lift, shape && typeof shape !== 'string' ? shape : null);
      const why = bad ?? (typeof shape === 'string' ? shape : '');
      say(why || `x 범위 ${fmt(a)} ~ ${fmt(b)}, 손잡이는 점 (${fmt(x0)}, ${fmt(y0)}) 에 달려요`);
      return why ? null : { x0, y0, a, b };
    };
    inputs.forEach(i => { i.addEventListener('input', update); i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } }); });
    ok.onclick = () => {
      const v = update();
      if (!v) return;
      const out = o.send({ k: 'h', fac: o.fac, ...v });
      if (out) say(out); else close();
    };
    update();
    setTimeout(() => (yIn.value ? inputs[0] : inputs[0]).focus(), 30);
    void RANGE_MAX; void esc;
  }
  return close;
}

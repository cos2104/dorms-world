/**
 * 스테이지 읽기. 글자 지도(NN.map.txt)와 장치 값(NN.json)을 판이 쓰는 모양으로 바꾼다.
 * 형식 설명은 kit/STAGE_FORMAT.md. 잘못된 곳은 쉬운 한국어로 알려 준다.
 */
import { checkSpec, type EquationSpec, type Range } from './equation';
import type { Sprite } from './sprite';

export const T = 30;

export type Need = number | 'half' | 'third' | 'all';
export type Rect = { x: number; y: number; w: number; h: number };

export type LegendEntry =
  | { type: 'button'; need?: Need; opens?: string[] }
  | { type: 'bridge'; mode?: 'appear' | 'vanish' }
  | { type: 'crate'; need?: Need }
  | { type: 'sign'; texts?: string[] }
  | { type: 'deco'; sprite?: string }
  | { type: 'pan'; scale?: string; side?: 'left' | 'right' }
  | { type: 'bin'; scale?: string }
  | { type: 'lever'; scale?: string; does?: 'addsub' | 'divide' };

/** 저울 하나. 식의 수는 범위로 적고 시작할 때마다 뽑는다. */
export type ScaleJson = {
  x?: Range;
  left?: { boxes?: Range; marbles?: Range };
  right?: { boxes?: Range };
  opens?: string[];
  spill?: number;
  skin?: { box?: string; marble?: string };
};

export type StageJson = { legend?: Record<string, LegendEntry>; scales?: Record<string, ScaleJson>; hint?: string };

export type Button = Rect & { ch: string; need: Need; opens: string[] };
export type Bridge = { ch: string; mode: 'appear' | 'vanish'; cells: [number, number][] };
export type CrateDef = Rect & { ch: string; need: Need };
export type Sign = { x: number; y: number; texts: string[] };
export type ScaleDef = {
  name: string;
  spec: EquationSpec;
  opens: string[];
  spill: number;                 // 기운 채로 이만큼(초) 지나면 쏟아진다. 0 이면 쏟아지지 않는다
  pans: [Rect, Rect];            // 왼쪽, 오른쪽 접시가 놓인 칸
  floor: number;                 // 접시 아래 땅의 윗면(y)
  hasAddSub: boolean;            // 더하기·빼기 레버가 있다(없으면 통에서 넣고 빼기를 다 한다)
  skin: { box?: Sprite; marble?: Sprite };   // 상자와 구슬 대신 그릴 팩의 그림(없으면 기본 그림)
};
/** 꾸밈 그림. 부딪히지 않고 도름이 뒤에 그려진다. x, y 는 그림의 왼쪽 위. */
export type Deco = { x: number; y: number; sprite: Sprite };
export type Bin = Rect & { scale: number };
export type Lever = Rect & { scale: number; does: 'addsub' | 'divide' };

export type Stage = {
  cols: number; rows: number;
  solid: Uint8Array;
  spawn: { x: number; y: number };
  key: { x: number; y: number } | null;
  door: Rect | null;
  buttons: Button[];
  bridges: Bridge[];
  crates: CrateDef[];
  signs: Sign[];
  scales: ScaleDef[];
  decos: Deco[];
  bins: Bin[];
  levers: Lever[];
  hint: string;
};

export function resolveNeed(need: Need, players: number): number {
  const n = Math.max(1, players);
  if (need === 'all') return n;
  if (need === 'half') return Math.max(1, Math.ceil(n / 2));
  if (need === 'third') return Math.max(1, Math.ceil(n / 3));
  return Math.max(1, Math.min(n, Math.floor(need)));
}

const validNeed = (v: unknown): v is Need => v === 'half' || v === 'third' || v === 'all' || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 30);

/** 옆·위아래로 붙은 같은 글자 칸을 한 덩어리로 묶는다. */
function groups(cells: [number, number][]): [number, number][][] {
  const key = (c: number, r: number) => `${c},${r}`;
  const left = new Map(cells.map(([c, r]) => [key(c, r), [c, r] as [number, number]]));
  const out: [number, number][][] = [];
  while (left.size) {
    const first = left.values().next().value as [number, number];
    left.delete(key(first[0], first[1]));
    const g = [first]; const q = [first];
    while (q.length) {
      const [c, r] = q.pop()!;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(c + dc, r + dr); const n = left.get(k);
        if (n) { left.delete(k); g.push(n); q.push(n); }
      }
    }
    out.push(g);
  }
  return out;
}

/** 이름으로 그림을 찾는다. 팩이 적은 이름은 남이 쓴 글이라 모양을 보고, 그림 목록이 직접 가진 이름만 받는다(constructor 같은 이름으로 엉뚱한 값을 꺼내지 못하게). */
const pickSprite = (sprites: Record<string, Sprite>, name: unknown): Sprite | undefined =>
  (typeof name === 'string' && /^[a-z0-9-]{1,40}$/.test(name) && Object.hasOwn(sprites, name) ? sprites[name] : undefined);

/** sprites: 그 팩의 글자 그림(이름 → 그림). 스테이지가 그림을 쓰면 여기서 찾는다. */
export function parseStage(mapText: string, json: StageJson = {}, sprites: Record<string, Sprite> = {}): Stage {
  const lines = mapText.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').filter((l, i, a) => l.length > 0 || (i > 0 && i < a.length - 1));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) throw new Error('지도가 비어 있어요.');
  const cols = lines[0].length, rows = lines.length;
  if (cols < 20 || cols > 80) throw new Error(`지도 가로는 20~80칸이어야 해요(지금 ${cols}칸).`);
  if (rows < 12 || rows > 18) throw new Error(`지도 세로는 12~18칸이어야 해요(지금 ${rows}칸).`);
  lines.forEach((l, i) => { if (l.length !== cols) throw new Error(`지도 ${i + 1}번째 줄 길이가 달라요(${l.length}칸, 첫 줄은 ${cols}칸).`); });

  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new Error('NN.json 은 { "legend": { ... } } 모양이어야 해요.');
  for (const k of Object.keys(json)) if (k !== 'legend' && k !== 'hint' && k !== 'scales') throw new Error(`NN.json 의 "${k}" 는 모르는 칸이에요. legend, scales, hint 만 쓸 수 있어요.`);
  if (json.hint != null && (typeof json.hint !== 'string' || json.hint.length > 60)) throw new Error('hint 는 60자까지의 한 줄이에요.');
  const legend = json.legend ?? {};
  if (legend === null || typeof legend !== 'object' || Array.isArray(legend)) throw new Error('legend 는 { "a": { "type": ... } } 모양이어야 해요.');
  const KEYS: Record<string, string[]> = { button: ['type', 'need', 'opens'], bridge: ['type', 'mode'], crate: ['type', 'need'], sign: ['type', 'texts'], deco: ['type', 'sprite'], pan: ['type', 'scale', 'side'], bin: ['type', 'scale'], lever: ['type', 'scale', 'does'] };
  const TYPES = Object.keys(KEYS).join(', ');
  for (const [ch, def] of Object.entries(legend) as [string, unknown][]) {
    if (def === null || typeof def !== 'object' || Array.isArray(def)) throw new Error(`legend 의 "${ch}" 는 { "type": "button" } 같은 모양이어야 해요.`);
    const type = (def as { type?: unknown }).type;
    if (typeof type !== 'string' || !KEYS[type]) throw new Error(`"${ch}" 의 type 을 모르겠어요. ${TYPES} 가운데 하나예요.`);
    for (const k of Object.keys(def)) if (!KEYS[type].includes(k)) throw new Error(`"${ch}"(${type})의 "${k}" 는 모르는 칸이에요. 쓸 수 있는 칸: ${KEYS[type].join(', ')}.`);
  }
  for (const ch of Object.keys(legend)) if (!/^[a-z0-9]$/.test(ch)) throw new Error(`장치 글자는 영문 소문자나 숫자 한 글자여야 해요: "${ch}"`);

  const scaleJson = json.scales ?? {};
  if (scaleJson === null || typeof scaleJson !== 'object' || Array.isArray(scaleJson)) throw new Error('scales 는 { "a": { "x": [2, 5], ... } } 모양이어야 해요.');
  const scaleNames = Object.keys(scaleJson);
  if (scaleNames.length > 6) throw new Error('저울은 한 스테이지에 6대까지예요.');
  const range = (v: unknown, fallback: [number, number], what: string): [number, number] => {
    if (v == null) return fallback;
    if (typeof v === 'number') return [v, v];
    if (Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number')) return [v[0], v[1]];
    throw new Error(`${what} 는 수 하나나 [작은 수, 큰 수] 로 적어 주세요.`);
  };
  const scaleSpecs = scaleNames.map(name => {
    if (!/^[a-z0-9]{1,8}$/.test(name)) throw new Error(`저울 이름은 영문 소문자와 숫자 8자까지예요: "${name}"`);
    const d = scaleJson[name] as ScaleJson;
    if (d === null || typeof d !== 'object' || Array.isArray(d)) throw new Error(`저울 "${name}" 는 { "x": [2, 5], "left": { ... } } 모양이어야 해요.`);
    for (const k of Object.keys(d)) if (!['x', 'left', 'right', 'opens', 'spill', 'skin'].includes(k)) throw new Error(`저울 "${name}" 의 "${k}" 는 모르는 칸이에요. 쓸 수 있는 칸: x, left, right, opens, spill, skin.`);
    const skinDef = d.skin ?? {}, skin: { box?: Sprite; marble?: Sprite } = {};
    if (skinDef === null || typeof skinDef !== 'object' || Array.isArray(skinDef)) throw new Error(`저울 "${name}" 의 skin 은 { "box": "그림 이름", "marble": "그림 이름" } 모양이에요.`);
    for (const [k, limit] of [['box', 18], ['marble', 9]] as const) {
      const v = (skinDef as Record<string, unknown>)[k];
      if (v == null) continue;
      const sp = pickSprite(sprites, v);
      if (!sp) throw new Error(`저울 "${name}" 의 skin.${k} "${String(v)}" 그림이 팩의 sprites 폴더에 없어요.`);
      if (sp.w > limit || sp.h > limit) throw new Error(`저울 "${name}" 의 ${k === 'box' ? '상자' : '구슬'} 그림은 ${limit}×${limit}점까지예요("${sp.name}" 은 ${sp.w}×${sp.h}).`);
      skin[k] = sp;
    }
    for (const k of Object.keys(skinDef)) if (k !== 'box' && k !== 'marble') throw new Error(`저울 "${name}" 의 skin 에는 box 와 marble 만 적어요.`);
    for (const side of ['left', 'right'] as const) { const v = d[side]; if (v != null && (typeof v !== 'object' || Array.isArray(v))) throw new Error(`저울 "${name}" 의 ${side} 는 { "boxes": 2 } 같은 모양이어야 해요.`); }
    for (const k of Object.keys(d.left ?? {})) if (k !== 'boxes' && k !== 'marbles') throw new Error(`저울 "${name}" 의 left 에는 boxes 와 marbles 만 적어요.`);
    for (const k of Object.keys(d.right ?? {})) if (k !== 'boxes') throw new Error(`저울 "${name}" 의 right 에는 boxes 만 적어요(오른쪽 구슬 수는 저울이 맞게 계산해요).`);
    const spec: EquationSpec = {
      x: range(d.x, [2, 5], `저울 "${name}" 의 x`),
      leftBoxes: range(d.left?.boxes, [1, 1], `저울 "${name}" 의 왼쪽 상자`),
      leftMarbles: range(d.left?.marbles, [0, 0], `저울 "${name}" 의 왼쪽 구슬`),
      rightBoxes: range(d.right?.boxes, [0, 0], `저울 "${name}" 의 오른쪽 상자`),
    };
    const bad = checkSpec(spec);
    if (bad) throw new Error(`저울 "${name}": ${bad}`);
    const opens = d.opens ?? [];
    if (!Array.isArray(opens) || opens.length > 8 || opens.some(o => typeof o !== 'string')) throw new Error(`저울 "${name}" 의 opens 는 다리 글자 목록이에요(8개까지). 예: ["x"]`);
    for (const o of opens) if (legend[o]?.type !== 'bridge') throw new Error(`저울 "${name}" 이 여는 "${o}" 는 bridge 여야 해요.`);
    const spill = d.spill ?? 0;
    if (typeof spill !== 'number' || spill < 0 || spill > 60 || (spill > 0 && spill < 2)) throw new Error(`저울 "${name}" 의 spill 은 0(쏟아지지 않음)이거나 2~60 초예요.`);
    return { name, spec, opens, spill, skin };
  });

  const solid = new Uint8Array(cols * rows);
  let spawn: Stage['spawn'] | null = null, key: Stage['key'] = null, door: Stage['door'] = null;
  const found = new Map<string, [number, number][]>();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = lines[r][c];
    if (ch === '#') solid[r * cols + c] = 1;
    else if (ch === '.' || ch === ' ') continue;
    else if (ch === '@') { if (spawn) throw new Error('시작 자리(@)는 한 곳만 둘 수 있어요.'); spawn = { x: c * T, y: (r + 1) * T }; }
    else if (ch === 'K') { if (key) throw new Error('열쇠(K)는 하나만 둘 수 있어요.'); key = { x: c * T - 1, y: r * T + 10 }; }
    else if (ch === 'D') { if (door) throw new Error('문(D)은 하나만 둘 수 있어요.'); door = { x: c * T, y: (r - 2) * T, w: 2 * T, h: 3 * T }; if (r < 2 || c + 1 >= cols) throw new Error('문(D)은 가로 2칸, 세로 3칸 자리가 필요해요. D 는 문의 왼쪽 아래 칸이에요.'); }
    else if (legend[ch]) { if (!found.has(ch)) found.set(ch, []); found.get(ch)!.push([c, r]); }
    else throw new Error(`지도 ${r + 1}번째 줄 ${c + 1}번째 칸의 "${ch}" 는 뜻을 모르는 글자예요. NN.json 의 legend 에 적어 주세요.`);
  }
  if (!spawn) throw new Error('시작 자리(@)가 없어요.');
  if (!key) throw new Error('열쇠(K)가 없어요.');
  if (!door) throw new Error('문(D)이 없어요.');

  const at = (c: number, r: number) => (c < 0 || c >= cols || r < 0 ? '#' : r >= rows ? '.' : lines[r][c]);
  const sc = spawn.x / T, sr = spawn.y / T - 1;
  if (at(sc, sr - 1) === '#') throw new Error('시작 자리(@) 바로 위가 땅이에요. 도름이 키가 한 칸보다 커서 위 칸이 비어 있어야 해요.');
  if (at(sc, sr + 1) !== '#') throw new Error('시작 자리(@) 바로 아래는 땅(#)이어야 해요.');
  const dc = door.x / T, dr = door.y / T;
  for (let r = dr; r < dr + 3; r++) for (let c = dc; c < dc + 2; c++) if (at(c, r) !== '.' && at(c, r) !== 'D' && at(c, r) !== ' ') throw new Error('문(D)이 놓일 가로 2칸, 세로 3칸은 빈칸이어야 해요(D 는 왼쪽 아래 칸).');
  if (at(dc, dr + 3) !== '#' || at(dc + 1, dr + 3) !== '#') throw new Error('문(D) 바로 아래 두 칸은 땅(#)이어야 해요.');

  const buttons: Button[] = [], bridges: Bridge[] = [], crates: CrateDef[] = [], signs: Sign[] = [];
  const bins: Bin[] = [], levers: Lever[] = [], decos: Deco[] = [];
  const panAt: Record<string, { left?: Rect; right?: Rect; floor?: number }> = {};
  const scaleIndex = (ch: string, what: string, name: unknown) => {
    const i = typeof name === 'string' ? scaleNames.indexOf(name) : -1;
    if (i < 0) throw new Error(`${what} "${ch}" 의 scale 에 저울 이름을 적어 주세요(scales 에 있는 이름: ${scaleNames.join(', ') || '없음'}).`);
    return i;
  };
  for (const [ch, def] of Object.entries(legend)) {
    const cells = found.get(ch);
    if (!cells) throw new Error(`legend 의 "${ch}" 가 지도에 없어요.`);
    if (def.type === 'button') {
      const need = def.need ?? 1;
      if (!validNeed(need)) throw new Error(`단추 "${ch}" 의 need 는 1~30 숫자나 "half", "third", "all" 이어야 해요.`);
      const opens = def.opens ?? [];
      if (!Array.isArray(opens) || !opens.length || opens.length > 8 || opens.some(o => typeof o !== 'string')) throw new Error(`단추 "${ch}" 의 opens 에 여는 다리 글자를 목록으로 적어 주세요(8개까지). 예: ["x"]`);
      for (const o of opens) if (legend[o]?.type !== 'bridge') throw new Error(`단추 "${ch}" 가 여는 "${o}" 는 bridge 여야 해요.`);
      for (const g of groups(cells)) {
        const cs = g.map(x => x[0]), r = g[0][1];
        if (g.some(x => x[1] !== r)) throw new Error(`단추 "${ch}" 는 옆으로만 이어 놓을 수 있어요.`);
        for (const [bc] of g) if (at(bc, r + 1) !== '#') throw new Error(`단추 "${ch}" 바로 아래는 땅(#)이어야 해요(지도 ${r + 1}번째 줄 ${bc + 1}번째 칸).`);
        const c0 = Math.min(...cs), c1 = Math.max(...cs);
        buttons.push({ ch, need, opens, x: c0 * T + 3, y: (r + 1) * T - 8, w: (c1 - c0 + 1) * T - 6, h: 8 });
      }
    } else if (def.type === 'bridge') {
      if (def.mode != null && def.mode !== 'appear' && def.mode !== 'vanish') throw new Error(`다리 "${ch}" 의 mode 는 "appear" 나 "vanish" 예요.`);
      bridges.push({ ch, mode: def.mode === 'vanish' ? 'vanish' : 'appear', cells });
    } else if (def.type === 'crate') {
      const need = def.need ?? 2;
      if (!validNeed(need)) throw new Error(`상자 "${ch}" 의 need 는 1~30 숫자나 "half", "third", "all" 이어야 해요.`);
      for (const g of groups(cells)) {
        const cs = g.map(x => x[0]), rs = g.map(x => x[1]);
        const c0 = Math.min(...cs), c1 = Math.max(...cs), r0 = Math.min(...rs), r1 = Math.max(...rs);
        if (g.length !== (c1 - c0 + 1) * (r1 - r0 + 1)) throw new Error(`상자 "${ch}" 는 빈틈없는 네모여야 해요.`);
        crates.push({ ch, need, x: c0 * T, y: r0 * T, w: (c1 - c0 + 1) * T, h: (r1 - r0 + 1) * T });
      }
    } else if (def.type === 'sign') {
      if (!Array.isArray(def.texts)) throw new Error(`표지 "${ch}" 의 texts 는 글 목록이어야 해요. 예: ["첫째 글", "둘째 글"]`);
      const texts = def.texts.map(String);
      if (!texts.length) throw new Error(`표지 "${ch}" 에 글(texts)이 없어요.`);
      if (texts.length > 10) throw new Error(`표지 "${ch}" 의 글은 10개까지예요.`);
      for (const t of texts) if (t.length > 40) throw new Error(`표지 "${ch}" 의 글은 40자까지예요: "${t.slice(0, 12)}…"`);
      for (const [c, r] of cells) signs.push({ x: c * T, y: r * T, texts });
    } else if (def.type === 'deco') {
      const sp = pickSprite(sprites, def.sprite);
      if (!sp) throw new Error(`꾸밈 "${ch}" 의 sprite "${String(def.sprite)}" 그림이 팩의 sprites 폴더에 없어요.`);
      // 글자를 놓은 칸의 왼쪽 아래에 그림의 왼쪽 아래를 맞춘다(한 점이 2px)
      for (const [c, r] of cells) decos.push({ x: c * T, y: (r + 1) * T - sp.h * 2, sprite: sp });
      if (decos.length > 60) throw new Error('꾸밈 그림은 한 스테이지에 60개까지예요.');
    } else if (def.type === 'pan') {
      const si = scaleIndex(ch, '접시', def.scale), name = scaleNames[si];
      if (def.side !== 'left' && def.side !== 'right') throw new Error(`접시 "${ch}" 의 side 는 "left" 나 "right" 예요.`);
      const gs = groups(cells);
      if (gs.length !== 1 || gs[0].some(x => x[1] !== gs[0][0][1])) throw new Error(`접시 "${ch}" 는 한 줄로 옆으로 이어진 한 덩어리여야 해요.`);
      const cs = cells.map(x => x[0]), r = cells[0][1], c0 = Math.min(...cs), c1 = Math.max(...cs);
      if (c1 - c0 + 1 < 6 || c1 - c0 + 1 > 8) throw new Error(`접시 "${ch}" 의 너비는 6~8칸이어야 해요(지금 ${c1 - c0 + 1}칸).`);
      for (let c = c0; c <= c1; c++) {
        for (let k = 1; k <= 3; k++) if (at(c, r + k) !== '.' && at(c, r + k) !== ' ') throw new Error(`접시 "${ch}" 아래 세 칸은 비워 주세요(땅도 다른 장치도 안 돼요). 도름이가 그 밑에 서서 올려놓아요.`);
        if (at(c, r + 4) !== '#') throw new Error(`접시 "${ch}" 에서 네 칸 아래는 땅(#)이어야 해요(지도 ${r + 5}번째 줄 ${c + 1}번째 칸).`);
        if (r < 7) throw new Error(`접시 "${ch}" 는 위에서 여덟째 줄이나 그 아래에 놓아 주세요(위에 저울대와 풀이 판이 걸려요).`);
        for (let k = 1; k <= 3; k++) if (at(c, r - k) === '#') throw new Error(`접시 "${ch}" 위로 세 칸은 비워 주세요(저울대가 걸려요).`);
      }
      const slot = (panAt[name] ??= {});
      if (slot[def.side]) throw new Error(`저울 "${name}" 에 ${def.side === 'left' ? '왼쪽' : '오른쪽'} 접시가 둘이에요.`);
      slot[def.side] = { x: c0 * T, y: r * T, w: (c1 - c0 + 1) * T, h: T };
      slot.floor = (r + 4) * T;
    } else if (def.type === 'bin' || def.type === 'lever') {
      const what = def.type === 'bin' ? '통' : '레버';
      const si = scaleIndex(ch, what, def.scale);
      if (def.type === 'lever' && def.does !== 'addsub' && def.does !== 'divide') throw new Error(`레버 "${ch}" 의 does 는 "addsub"(더하기·빼기)나 "divide"(나누기)예요.`);
      for (const [c, r] of cells) {
        if (at(c, r + 1) !== '#') throw new Error(`${what} "${ch}" 바로 아래는 땅(#)이어야 해요(지도 ${r + 1}번째 줄 ${c + 1}번째 칸).`);
        const rect = { x: c * T, y: r * T, w: T, h: T };
        if (def.type === 'bin') bins.push({ ...rect, scale: si });
        else levers.push({ ...rect, scale: si, does: def.does! });
      }
    } else {
      throw new Error(`"${ch}" 의 type 을 모르겠어요. ${TYPES} 가운데 하나예요.`);
    }
  }
  const scales: ScaleDef[] = scaleSpecs.map((sc, si) => {
    const pan = panAt[sc.name];
    if (!pan?.left || !pan.right) throw new Error(`저울 "${sc.name}" 에는 왼쪽 접시와 오른쪽 접시가 하나씩 있어야 해요(legend 에 type "pan").`);
    if (pan.left.y !== pan.right.y) throw new Error(`저울 "${sc.name}" 의 두 접시는 같은 높이에 놓아 주세요.`);
    if (pan.right.x - (pan.left.x + pan.left.w) < 2 * T) throw new Error(`저울 "${sc.name}" 의 두 접시 사이는 두 칸 이상 띄워 주세요(가운데에 기둥이 서요). 왼쪽 접시가 왼쪽에 와야 해요.`);
    if (!bins.some(b => b.scale === si)) throw new Error(`저울 "${sc.name}" 에 통(type "bin")이 없어요. 구슬을 버리거나 꺼낼 곳이 있어야 해요.`);
    const mine = levers.filter(l => l.scale === si);
    if (mine.filter(l => l.does === 'addsub').length > 1 || mine.filter(l => l.does === 'divide').length > 1) throw new Error(`저울 "${sc.name}" 에 같은 일을 하는 레버가 둘이에요.`);
    if (sc.spec.leftBoxes[1] - sc.spec.rightBoxes[0] > 1 && !mine.some(l => l.does === 'divide')) throw new Error(`저울 "${sc.name}" 은 상자가 둘 이상 남을 수 있어요. 나누기 레버(does "divide")를 놓아 주세요.`);
    return { ...sc, pans: [pan.left, pan.right], floor: pan.floor!, hasAddSub: mine.some(l => l.does === 'addsub') };
  });
  // 통과 레버는 접시 밑이나 바로 옆 칸에 둘 수 없다(거기서 확인을 누르면 들고 놓기 대신 통·레버가 움직인다)
  for (const d of [...bins, ...levers]) for (const sc of scales) for (const pan of sc.pans) {
    if (d.x + d.w + T > pan.x && d.x - T < pan.x + pan.w) throw new Error(`통과 레버는 접시 밑이나 바로 옆 칸에 둘 수 없어요(지도 ${d.y / T + 1}번째 줄 ${d.x / T + 1}번째 칸). 접시에서 한 칸 넘게 띄워 주세요.`);
  }
  for (const b of bridges) if (!buttons.some(x => x.opens.includes(b.ch)) && !scales.some(x => x.opens.includes(b.ch))) throw new Error(`다리 "${b.ch}" 를 여는 단추나 저울이 없어요.`);
  const hint = json.hint ?? '';
  return { cols, rows, solid, spawn, key, door, buttons, bridges, crates, signs, scales, decos, bins, levers, hint };
}

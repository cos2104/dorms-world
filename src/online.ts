/**
 * 온라인으로 함께 하기. 방을 만들고(공개 여부·방식), QR·방 코드·공개 방 목록으로 들어오고,
 * 방에 함께 있는 채로 방장이 고르는 스테이지를 모두 따라간다. 가입도 이름 입력도 없다: 들어온 차례대로 색과 번호가 정해진다.
 *
 * 방식은 둘이고 한 방에 섞여도 된다.
 *  - 각자 화면: 자기 기기에서 게임 화면을 보며 움직인다.
 *  - 함께 보기: 방을 연 큰 화면에 모두가 보이고, 다른 사람은 휴대폰을 조작기로만 쓴다(좌우·뛰기·확인, 내 색과 번호).
 *
 * 물리는 방장 기기만 돌린다. 손님은 조작만 보내고 방장이 보내는 세계 요약을 받아 그린다(platform/sync.ts).
 * 방 서버 주소(VITE_ROOM_URL)가 비어 있으면 이 파일은 화면에 아무것도 그리지 않는다.
 */
import '../platform/ui/online.css';
import qrcode from 'qrcode-generator';
import { icon } from '../platform/icons';
import { colorFor, swatchFor } from '../platform/identity';
import { PadInput } from '../platform/input';
import { VIEW_H, VIEW_W } from '../platform/look';
import { joinRoom, listPublic, type Down, type RoomLink } from '../platform/net';
import { findPack, type Pack } from '../platform/packs';
import { cameraFor, nearText, render, type Camera } from '../platform/render';
import { cleanRoomCode, newRoomCode, validRoomCode } from '../platform/room-code';
import { MAX_SEATS, type PublicRoom, type RoomInfo } from '../platform/room-rules';
import { createWorld, removePlayer, setPlayerCount, step, NO_PAD, type Pad, type World } from '../platform/sim';
import { SNAP_EVERY, applyWire, blend, newTrack, pushWire, toWire, wireSeats, type Track, type Wire } from '../platform/sync';
import { esc } from '../platform/text';

/** main.ts 가 빌려주는 것들. */
export type Host = {
  app: HTMLElement;
  shell(inner: string, status: string, right: string, back?: string): string;
  /** 주소를 바꾸고 그 화면을 그린다(방에 있으면 방 코드가 주소에 따라붙는다). */
  go(path: string): void;
  /** 지금 주소의 화면을 다시 그린다. */
  route(): void;
  /** 앞 화면을 멈추고, 새 화면을 멈출 함수를 건다. */
  setStop(fn: (() => void) | null): void;
};

const BASE = import.meta.env.BASE_URL;
const ROOM_URL = (import.meta.env.VITE_ROOM_URL ?? '').trim().replace(/\/+$/, '');
/** 방 서버 주소가 있어야 온라인 들머리를 그린다. */
export const available = () => /^https?:\/\//.test(ROOM_URL);

let host: Host;
let link: RoomLink | null = null;
let game: Game | null = null;
let shown = '';                       // 지금 온라인이 그린 화면(같은 화면을 다시 그리지 않으려고)
let notice = '';                      // 처음 화면 안내 줄에 한 번 보여 줄 글
let joinIn = false;                   // 함께 보기 방의 방장: 이 화면에서도 도름이를 움직인다
let pendingInvite = false;            // 방을 막 만들었다: 들어오면 초대 창을 띄운다
let remade = 0;                       // 방 코드가 겹쳐 새로 뽑은 횟수
let role: 'none' | 'guest' | 'host' = 'none';

export function init(h: Host) {
  host = h;
  if (!available()) return;
  // 방장이 화면을 내려 두면(다른 앱으로 감) 게임이 멈춘다. 게임 화면을 보고 있는 다음 사람에게 방장을 넘긴다.
  document.addEventListener('visibilitychange', () => { if (document.hidden && game && link?.isHost) link.yieldHost(); });
  // 화면을 떠나면(닫기 · 새로 고침) 연결만 조용히 끊는다. 주소의 방 코드는 그대로 두어 새로 고치면 같은 방으로 돌아온다.
  window.addEventListener('pagehide', () => { const l = link; if (!l) return; link = null; l.leave(); });
  // 뒤로 가기로 되살아난 화면은 연결이 끊긴 채다: 주소를 보고 다시 들어간다
  window.addEventListener('pageshow', e => { if (e.persisted) { shown = ''; host.route(); } });
}

export const inRoom = () => !!link;
/** 방에 있는 동안 주소 뒤에 붙는 값. */
export const query = () => (link ? `?room=${link.code}` : '');

// ---------- 이 창을 가리는 번호 ----------
/** 연결이 잠깐 끊겼다 다시 붙을 때 앉아 있던 자리를 잇는 데만 쓴다. 창을 닫으면 사라지고, 사람을 알아볼 수 있는 값이 아니다. */
function tabId() {
  const KEY = 'dorms-world.tab';
  try { const v = sessionStorage.getItem(KEY); if (v && /^[0-9a-f]{16}$/.test(v)) return v; } catch { /* 저장이 막힌 기기 */ }
  const a = new Uint8Array(8); crypto.getRandomValues(a);
  const id = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem(KEY, id); } catch { /* 무시 */ }
  return id;
}

// ---------- 알림(화면 위에 잠깐 뜨는 글) ----------
let toastEl: HTMLElement | null = null, toastTimer = 0;
function toast(text: string, ms = 4500) {
  if (!toastEl) { toastEl = document.createElement('p'); toastEl.className = 'w-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
  toastEl.textContent = text; toastEl.hidden = !text;
  clearTimeout(toastTimer);
  if (text && ms > 0) toastTimer = window.setTimeout(() => { if (toastEl) toastEl.hidden = true; }, ms);
}

const WHY: Record<Down, string> = {
  full: '방이 가득 찼어요. 한 방에는 30명까지 들어갈 수 있어요.',
  none: '그런 방이 없어요. 방 코드를 다시 확인해 주세요.',
  taken: '방을 만들지 못했어요. 다시 만들어 주세요.',
  fast: '연결이 고르지 않아 방에서 나왔어요. 다시 들어와 주세요.',
  lost: '연결이 끊겨 방에서 나왔어요. 와이파이를 확인하고 다시 들어와 주세요.',
  left: '',
};

// ---------- 방에 들어가고 나오기 ----------
function enter(code: string, o: { create?: boolean; pub?: boolean; big?: boolean } = {}) {
  joinIn = false; role = 'none';
  /** 방장인지 손님인지가 바뀌었는지 본다. 손님으로 있다가 방장이 됐으면 true. */
  const turned = (l: RoomLink) => {
    const now = l.isHost ? 'host' : 'guest', promoted = role === 'guest' && now === 'host';
    if (promoted) joinIn = l.room.order.includes(l.me);    // 뛰던 사람이 방장이 되면 계속 뛴다
    role = now;
    return promoted;
  };
  const changed = (l: RoomLink) => {
    if (l !== link) return;
    const promoted = turned(l);
    if (l.isHost) reconcile();
    if (promoted) toast('앞 방장이 나가서 이제 내가 방장이에요.');
    refresh();
  };
  const mine = joinRoom(ROOM_URL, code, { ...o, view: 'auto', id: tabId() }, {
    hello: l => { if (l !== link) return; remade = 0; toast(''); changed(l); if (pendingInvite && l.isHost) { pendingInvite = false; inviteDialog(true); } },
    who: changed,
    room: l => { if (l === link) refresh(); },
    pad: (seat, pad) => game?.onPad(seat, pad),
    snap: wire => game?.onSnap(wire),
    retry: n => { if (mine === link) toast(n ? '연결이 끊겼어요. 다시 잇고 있어요.' : '', 0); },
    down: why => {
      if (mine !== link) return;
      link = null; toast('');
      if (why === 'taken' && o.create && remade++ < 3) { enter(newRoomCode(), o); return; }   // 방 코드가 겹쳤다: 새로 뽑는다
      pendingInvite = false; closeDialog();
      // 한 번도 붙지 못했으면 '나왔어요'가 아니라 '못 했어요'로 알린다
      notice = why === 'lost' && mine.me < 0 ? (o.create ? '방을 만들지 못했어요. 연결을 확인하고 다시 해 주세요.' : '방에 들어가지 못했어요. 연결을 확인하고 다시 해 주세요.') : WHY[why];
      shown = '';
      history.replaceState(null, '', location.pathname);   // 주소에서 방 코드를 뗀다
      host.route();
    },
  });
  link = mine;
}

function leaveRoom() {
  const l = link; if (!l) return;
  link = null; l.leave();                                 // 내가 나간 것이라 안내 글은 없다
  toast(''); shown = ''; notice = '';
  history.replaceState(null, '', location.pathname);
  host.go('');
}

/**
 * 주소를 보고 방 상태를 맞춘다. main.ts 의 route() 가 맨 먼저 부른다.
 * true 를 돌려주면 온라인이 화면을 그렸다(들어가는 중, 손님의 대기·게임·조작기 화면).
 */
export function route(): boolean {
  if (!available()) return false;
  const raw = new URLSearchParams(location.search).get('room'), want = cleanRoomCode(raw ?? '');
  if (link && want !== link.code) { const l = link; link = null; l.leave(); toast(''); }        // 뒤로 가기로 방 주소를 벗어났다
  if (!link && raw != null) {
    if (validRoomCode(want)) enter(want);
    else { notice = WHY.none; history.replaceState(null, '', location.pathname); }
  }
  if (!link) { shown = ''; return false; }
  if (link.me < 0) { drawJoining(); return true; }
  if (link.isHost) { shown = 'host'; return false; }      // 방장은 고르는 화면(처음 화면·팩 화면)을 그대로 쓴다
  shown = ''; refresh();
  return true;
}

/** 방 상태가 바뀔 때마다: 지금 보여야 할 화면을 맞춘다. */
function refresh() {
  const l = link; if (!l || l.me < 0) return;
  const pack = l.room.stage >= 0 ? findPack(l.room.pack) : null;
  const playing = !!pack && l.room.stage < pack.stageData.length;
  if (l.isHost) {
    if (game) { game.sync(); return; }
    if (shown !== 'host') {
      // 막 방을 만들었거나, 손님 화면(기다리기·조작기)에 있다가 방장이 됐다
      if (playing) { start(pack!, l.room.stage); return; }   // 조작기만 쓰던 기기는 세계를 갖고 있지 않아 그 스테이지를 처음부터 연다
      shown = 'host'; host.route(); return;
    }
    updateStrip();
    return;
  }
  if (l.viewOf(l.me) === 'pad') { game?.stop(); drawPad(); return; }
  if (playing) { openGame(pack!, l.room.stage); return; }
  game?.stop();
  drawWait(l.room.stage >= 0 && !playing ? '이 기기에는 그 스테이지가 아직 없어요. 새로 고침한 뒤 다시 들어와 주세요.' : '');
}

/** 방장: 들고 난 사람에 맞춰 도름이 차례(자리 번호 목록)를 고쳐 모두에게 알린다. 새로 온 사람은 뒤에 붙는다. */
function reconcile() {
  const l = link; if (!l?.isHost) return;
  const here = new Set(l.seats.map(s => s.seat));
  const order = l.room.order.filter(s => here.has(s) && (s !== l.me || !l.room.big || joinIn));
  for (const s of l.seats) if (!order.includes(s.seat) && (s.seat !== l.me || !l.room.big || joinIn)) order.push(s.seat);
  if (order.length === l.room.order.length && order.every((s, i) => s === l.room.order[i])) return;
  game?.reorder(l.room.order, order);
  l.setRoom({ ...l.room, order });
}

/** 방장: 스테이지를 고르는 화면으로 돌아왔다(손님은 기다리는 화면으로). */
function idleRoom() {
  const l = link;
  if (l?.isHost && l.room.stage >= 0) l.setRoom({ ...l.room, stage: -1 });
}

/** 방장: 스테이지를 연다. 방에 있는 모두가 따라온다. */
export function start(p: Pack, si: number) {
  const l = link; if (!l?.isHost) return;
  reconcile();
  l.setRoom({ ...l.room, pack: p.id, stage: si, seed: 1 + Math.floor(Math.random() * 2147483000), run: l.room.run + 1 });
  openGame(p, si);
}

// ---------- 처음 화면 · 팩 화면에 얹는 것 ----------
/** 처음 화면이 그려진 뒤: 방 밖이면 들머리(방 만들기·코드 입력·공개 방), 방 안이면 방 줄. */
export function home() {
  if (!available()) return;
  if (link) { idleRoom(); mountStrip(); return; }
  const at = host.app.querySelector('.ar-toolbar') ?? host.app.querySelector('.ar-screen-inner > :last-child');
  if (!at) return;
  const el = document.createElement('section');
  el.className = 'w-online'; el.setAttribute('aria-label', '함께 하기');
  el.innerHTML = `
    <div class="w-online-row">
      <button class="ar-key ghost" data-room-new>${icon('users', 17)}방 만들기</button>
      <div class="w-codebox">
        <label class="ar-kicker" for="w-code">방 코드</label>
        <input id="w-code" class="ar-input w-codeinput" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="여섯 글자">
        <button class="ar-key ghost" data-room-join>들어가기</button>
      </div>
    </div>
    <p class="lab-note w-online-note" role="status">${esc(notice)}</p>
    <div class="w-public"><p class="ar-kicker w-kicker">공개 방</p><div class="lab-roster w-publist"><p class="w-public-none">공개 방을 찾고 있어요.</p></div></div>`;
  notice = '';
  at.before(el);
  const input = el.querySelector<HTMLInputElement>('input')!, note = el.querySelector<HTMLElement>('.w-online-note')!;
  const join = () => {
    const code = cleanRoomCode(input.value);
    if (!validRoomCode(code)) { note.textContent = '방 코드는 여섯 글자예요. 숫자 0과 1, 알파벳 O, I, L 은 쓰지 않아요.'; input.focus(); return; }
    enter(code); host.go('');
  };
  input.oninput = () => { input.value = cleanRoomCode(input.value); note.textContent = ''; };
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); join(); } };
  el.querySelector<HTMLButtonElement>('[data-room-join]')!.onclick = join;
  el.querySelector<HTMLButtonElement>('[data-room-new]')!.onclick = e => createDialog(e.currentTarget as HTMLElement);

  const listEl = el.querySelector<HTMLElement>('.w-publist')!;
  let alive = true;
  const load = async () => {
    const rooms = await listPublic(ROOM_URL);
    if (!alive || !listEl.isConnected) return;
    listEl.innerHTML = rooms.length ? rooms.map(pubRow).join('') : '<p class="w-public-none">지금 열린 공개 방이 없어요.</p>';
    listEl.querySelectorAll<HTMLButtonElement>('[data-pub]').forEach(b => b.onclick = () => { enter(b.dataset.pub!); host.go(''); });
  };
  void load();
  const timer = window.setInterval(load, 8000);
  host.setStop(() => { alive = false; clearInterval(timer); });
}

function pubRow(r: PublicRoom) {
  const p = findPack(r.pack), where = p && r.stage >= 0 && r.stage < p.stages.length ? `${p.name} ${String(r.stage + 1).padStart(2, '0')}` : '스테이지 고르는 중';
  return `<button class="ar-row w-pubrow" data-pub="${esc(r.code)}" aria-label="공개 방 ${esc(r.code)} 들어가기, ${esc(where)}, ${r.count}명"><span class="ar-count ar-mono w-pubcode">${esc(r.code)}</span><span class="ar-label">${esc(where)}</span><span class="ar-count w-people">${icon('users', 14)}<span><span class="lab-num">${r.count}</span>명</span></span></button>`;
}

/** 팩 화면이 그려진 뒤: 방 안이면 연습 인원 고르기를 걷고 방 줄을 단다. */
export function pack() {
  if (!link) return;
  idleRoom(); mountStrip();
  const counts = host.app.querySelector('.w-counts');
  counts?.previousElementSibling?.remove(); counts?.remove();
  const keys = host.app.querySelector('.w-keys');
  if (keys) keys.innerHTML = '<span>스테이지를 고르면 방에 있는 모두가 함께 시작해요.</span> <span>움직이기 왼쪽·오른쪽 방향키</span> · <span>뛰기 스페이스(또는 Z)</span> · <span>확인 엔터(문에 들어가기, 들고 놓기, 레버 당기기)</span>';
}

/** 방 줄: 방 코드, 사람 수, 친구 부르기, 방 나가기. 상태 줄 오른쪽에 붙는다. */
function mountStrip() {
  const bar = host.app.querySelector('.w-status');
  if (!bar || !link) return;
  bar.querySelector('.w-strip')?.remove();
  const el = document.createElement('div');
  el.className = 'w-strip';
  el.innerHTML = `${roomTags()}<button class="ar-key ghost" data-invite aria-label="친구 부르기">${icon('plus', 17)}<span class="w-hide-s">친구 부르기</span></button><button class="ar-key ghost" data-leave aria-label="방 나가기">${icon('door', 17)}<span class="w-hide-s">방 나가기</span></button>`;
  bar.appendChild(el);
  el.querySelector<HTMLButtonElement>('[data-invite]')!.onclick = e => inviteDialog(false, e.currentTarget as HTMLElement);
  el.querySelector<HTMLButtonElement>('[data-leave]')!.onclick = leaveRoom;
  shown = 'host';
}
/** 방에서 뛰는 사람 수(도름이 수). 함께 보기 방의 큰 화면은 세지 않는다. 방장이 차례를 알리기 전이면 연결 수. */
const people = () => (link ? link.room.order.length || link.count : 0);
function updateStrip() { for (const el of document.querySelectorAll<HTMLElement>('[data-count]')) el.textContent = String(people()); }
const roomTags = () => `<span class="ar-count w-roomtag"><span class="w-hide-s">방</span><b class="ar-mono">${esc(link?.code ?? '')}</b></span><span class="ar-count w-people">${icon('users', 14)}<span><span class="lab-num" data-count>${people()}</span>명</span></span>`;

// ---------- 창 ----------
let dialog: { el: HTMLElement; close(): void } | null = null;
function closeDialog() { dialog?.close(); }
/** 창을 띄운다. Esc 나 바깥을 누르면 닫히고, 닫으면 창을 연 단추로 초점이 돌아간다. */
function openDialog(label: string, badge: string, body: string, opener?: HTMLElement | null) {
  closeDialog();
  const el = document.createElement('div');
  el.className = 'arcade-root w-root w-dialog';
  el.innerHTML = `<div class="ar-cabinet lab-modal" role="dialog" aria-modal="true" aria-label="${esc(label)}">
    <div class="ar-bezel"><div class="ar-brand"><span class="ar-badge">${esc(badge)}</span> ${esc(label)}</div><button class="ar-key ghost w-x" data-close aria-label="닫기">${icon('close', 17)}</button></div>
    <div class="ar-screen"><div class="ar-screen-inner">${body}</div></div></div>`;
  document.body.appendChild(el);
  const before = opener ?? (document.activeElement as HTMLElement | null);
  const focusable = () => [...el.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')].filter(n => !n.hasAttribute('disabled') && n.offsetParent !== null);
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();                                  // 창이 떠 있는 동안 누른 키가 뒤의 게임(뛰기 · 확인)으로 새지 않게
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusable(); if (!f.length) return;
    const first = f[0], last = f[f.length - 1], cur = document.activeElement;
    if (!el.contains(cur)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  };
  const close = () => {
    if (dialog?.el !== el) return;
    dialog = null;
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    if (before?.isConnected) before.focus();
  };
  el.addEventListener('pointerdown', e => { if (e.target === el) close(); });
  el.querySelector<HTMLButtonElement>('[data-close]')!.onclick = close;
  document.addEventListener('keydown', onKey, true);
  dialog = { el, close };
  (el.querySelector<HTMLElement>('[data-first]') ?? focusable()[1] ?? focusable()[0])?.focus();
  return el;
}

/** 방 만들기 창: 공개 여부와 방식을 고른다. */
function createDialog(opener: HTMLElement) {
  let pub = false, big = false;
  const el = openDialog('방 만들기', 'ROOM', `
    <p class="ar-kicker w-kicker" id="w-pub-k">누가 들어올 수 있나요</p>
    <div class="ar-view-tabs" role="group" aria-labelledby="w-pub-k"><button class="ar-key ghost" data-pub="0" data-first>코드를 아는 친구만</button><button class="ar-key ghost" data-pub="1">누구나</button></div>
    <p class="ar-sub w-pick-note" data-pub-note></p>
    <p class="ar-kicker w-kicker" id="w-big-k">어떻게 함께 할까요</p>
    <div class="ar-view-tabs" role="group" aria-labelledby="w-big-k"><button class="ar-key ghost" data-big="0">각자 화면</button><button class="ar-key ghost" data-big="1">함께 보기</button></div>
    <p class="ar-sub w-pick-note" data-big-note></p>
    <div class="lab-actions"><button class="ar-key mustard" data-make>${icon('users', 17)}방 만들기</button></div>`, opener);
  const paint = () => {
    el.querySelectorAll<HTMLElement>('[data-pub]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.pub === '1') === pub)));
    el.querySelectorAll<HTMLElement>('[data-big]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.big === '1') === big)));
    el.querySelector('[data-pub-note]')!.textContent = pub ? '처음 화면의 공개 방 목록에 떠서 누구나 들어올 수 있어요.' : '방 코드나 QR 을 받은 친구만 들어와요.';
    el.querySelector('[data-big-note]')!.textContent = big ? '이 화면에 모두가 보이고, 친구들은 휴대폰을 조작기로 써요.' : '저마다 자기 기기에서 게임 화면을 보며 움직여요.';
  };
  el.querySelectorAll<HTMLButtonElement>('[data-pub]').forEach(b => b.onclick = () => { pub = b.dataset.pub === '1'; paint(); });
  el.querySelectorAll<HTMLButtonElement>('[data-big]').forEach(b => b.onclick = () => { big = b.dataset.big === '1'; paint(); });
  el.querySelector<HTMLButtonElement>('[data-make]')!.onclick = e => {
    (e.currentTarget as HTMLButtonElement).disabled = true;
    pendingInvite = true; remade = 0;
    enter(newRoomCode(), { create: true, pub, big });
    host.go(location.pathname.slice(BASE.length));       // 주소에 방 코드를 붙이고 화면에 방 줄을 단다
  };
  paint();
}

const inviteUrl = () => `${(import.meta.env.VITE_PUBLIC_URL ?? '').trim().replace(/\/+$/, '') || location.origin}${BASE}?room=${link?.code ?? ''}`;

/** QR 을 SVG 로 그린다(주소를 바깥으로 보내지 않고 이 기기에서 만든다). */
function qrSvg(text: string) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), pad = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg class="w-qr-svg" viewBox="${-pad} ${-pad} ${n + pad * 2} ${n + pad * 2}" shape-rendering="crispEdges" role="img" aria-label="방 주소가 담긴 QR"><rect x="${-pad}" y="${-pad}" width="${n + pad * 2}" height="${n + pad * 2}" fill="#F4F7FF"/><path d="${d}" fill="#14285F"/></svg>`;
}

/** 친구 부르기 창: 방 코드를 크게, QR, 주소 복사. */
function inviteDialog(fresh: boolean, opener?: HTMLElement) {
  if (!link) return;
  const url = inviteUrl();
  const el = openDialog('친구 부르기', 'ROOM', `
    <p class="ar-kicker w-kicker">방 코드</p>
    <div class="lab-code w-bigcode" data-code>${esc(link.code)}</div>
    <div class="w-qr">${qrSvg(url)}</div>
    <p class="ar-sub w-invite-how">QR 을 찍거나, 도름스 월드 처음 화면에서 방 코드를 넣으면 바로 들어와요.</p>
    <p class="lab-note w-invite-note" role="status"></p>
    <div class="lab-actions">${fresh ? `<button class="ar-key mustard" data-done data-first>${icon('play', 17)}스테이지 고르러 가기</button>` : ''}<button class="ar-key ghost" data-copy ${fresh ? '' : 'data-first'}>${icon('copy', 17)}주소 복사</button></div>`, opener);
  el.querySelector<HTMLButtonElement>('[data-done]')?.addEventListener('click', closeDialog);
  el.querySelector<HTMLButtonElement>('[data-copy]')!.onclick = async () => {
    const note = el.querySelector<HTMLElement>('.w-invite-note')!;
    try { await navigator.clipboard.writeText(url); note.textContent = '주소를 복사했어요.'; }
    catch { note.textContent = url; }                    // 복사가 막힌 기기에서는 주소를 그대로 보여 준다
  };
}

// ---------- 손님 화면: 들어가는 중 · 기다리기 ----------
function drawJoining() {
  if (shown === 'join') return;
  game?.stop();
  host.setStop(null);
  host.app.innerHTML = host.shell(`<div class="w-wait"><p class="ar-kicker w-kicker">방 코드</p><div class="lab-code w-bigcode">${esc(link?.code ?? '')}</div><p class="ar-sub" role="status">방에 들어가고 있어요.</p><div class="lab-actions"><button class="ar-key ghost" data-leave>${icon('back', 17)}처음으로</button></div></div>`, '방에 들어가고 있어요', 'ROOM');
  host.app.querySelector<HTMLButtonElement>('[data-leave]')!.onclick = leaveRoom;
  shown = 'join';
}

const personRow = (seat: number, n: number, l: RoomLink) => {
  const sw = swatchFor(seat), tags = [seat === l.me ? '나' : '', seat === l.host ? '방장' : ''].filter(Boolean).join(' · ');
  const screenOnly = seat === l.host && l.room.big && !n;   // 함께 보기 방의 큰 화면(도름이 없이 보여 주기만 한다)
  return `<div class="ar-row w-person"><span class="w-swatch" data-color="${screenOnly ? '#14285F' : sw.hex}"></span><span class="ar-label">${screenOnly ? '큰 화면' : `${esc(sw.name)} 도름이${n ? ` ${n}` : ''}`}</span><span class="ar-count">${esc(tags || (l.viewOf(seat) === 'pad' ? '조작기' : '각자 화면'))}</span></div>`;
};
const paintSwatches = (root: ParentNode) => root.querySelectorAll<HTMLElement>('[data-color]').forEach(el => { el.style.background = el.dataset.color!; });

function drawWait(problem = '') {
  const l = link; if (!l) return;
  game?.stop();
  if (shown !== 'wait') {
    host.setStop(null);
    host.app.innerHTML = host.shell(`<div class="w-wait">
        <p class="ar-kicker w-kicker">방 코드</p><div class="lab-code w-bigcode">${esc(l.code)}</div>
        <p class="ar-sub w-wait-say" role="status"></p>
        <div class="lab-roster w-people-list"></div>
        <div class="lab-actions"><button class="ar-key ghost" data-leave>${icon('door', 17)}방 나가기</button></div>
      </div>`, '방에 들어왔어요', 'ROOM');
    host.app.querySelector<HTMLButtonElement>('[data-leave]')!.onclick = leaveRoom;
    shown = 'wait';
  }
  host.app.querySelector('.w-wait-say')!.textContent = problem || '방장이 스테이지를 고르고 있어요. 고르면 바로 함께 시작해요.';
  const list = host.app.querySelector<HTMLElement>('.w-people-list')!;
  list.innerHTML = l.seats.map(s => personRow(s.seat, l.room.order.indexOf(s.seat) + 1, l)).join('');
  paintSwatches(list);
}

// ---------- 조작기 화면 ----------
let padScreen: { paint(): void } | null = null;
function drawPad() {
  const l = link; if (!l) return;
  if (shown === 'pad' && padScreen) { padScreen.paint(); return; }
  host.setStop(null);
  host.app.innerHTML = `<main class="arcade-root w-root w-ctl">
    <div class="w-ctl-top">${roomTags()}<span class="w-ctl-gap"></span><button class="ar-key ghost" data-own aria-label="내 화면으로 보기">${icon('screen', 17)}<span class="w-hide-s">내 화면으로 보기</span></button><button class="ar-key ghost" data-leave aria-label="방 나가기">${icon('door', 17)}<span class="w-hide-s">방 나가기</span></button></div>
    <div class="w-ctl-me"><div class="w-ctl-tile" aria-hidden="true"><b class="w-ctl-num"></b></div><p class="w-ctl-name"></p><p class="w-ctl-say" role="status"></p></div>
    <div class="w-ctl-pad"></div>
  </main>`;
  const root = host.app.querySelector<HTMLElement>('.w-ctl')!;
  const input = new PadInput(); input.mount(root.querySelector<HTMLElement>('.w-ctl-pad')!);
  root.querySelector<HTMLButtonElement>('[data-leave]')!.onclick = leaveRoom;
  root.querySelector<HTMLButtonElement>('[data-own]')!.onclick = () => { link?.setView('play'); refresh(); };
  const send = padSender();
  let raf = 0;
  const frame = (now: number) => { raf = requestAnimationFrame(frame); const p = input.read(); if (link?.open && !link.isHost) send(p, now); };
  raf = requestAnimationFrame(frame);
  const paint = () => {
    const k = link; if (!k) return;
    const sw = swatchFor(k.me), n = k.room.order.indexOf(k.me) + 1;
    root.querySelector<HTMLElement>('.w-ctl-tile')!.style.background = sw.hex;
    root.querySelector('.w-ctl-num')!.textContent = n ? String(n) : '';
    root.querySelector('.w-ctl-name')!.textContent = n ? `나는 ${sw.name} 도름이 ${n}번` : `나는 ${sw.name} 도름이`;
    const p = k.room.stage >= 0 ? findPack(k.room.pack) : null, st = p?.stages[k.room.stage];
    root.querySelector('.w-ctl-say')!.textContent = st ? `${p!.name} ${String(k.room.stage + 1).padStart(2, '0')} ${st.name}. 큰 화면을 보며 움직여요.` : '방장이 스테이지를 고르고 있어요.';
    updateStrip();
  };
  padScreen = { paint };
  paint();
  shown = 'pad';
  host.setStop(() => { cancelAnimationFrame(raf); input.dispose(); padScreen = null; if (shown === 'pad') shown = ''; });
}

/** 손님의 조작 보내기: 바뀌면 바로(초당 서른 번까지), 안 바뀌어도 가끔 다시 보낸다. 짧게 누른 확인도 빠지지 않게 모아 둔다. */
function padSender() {
  let at = 0, key = '', held = false;
  return (p: Pad, now: number) => {
    held ||= !!p.a;
    if (now - at < 33) return;
    const out: Pad = { m: p.m, j: p.j, a: held, jn: p.jn };
    const k = `${out.m}${out.j ? 1 : 0}${held ? 1 : 0}${out.jn}`;
    if (k !== key || now - at >= 250) { link?.sendPad(out); key = k; at = now; }
    held = false;
  };
}

// ---------- 게임 화면 ----------
type Game = { key: string; stop(): void; sync(): void; onPad(seat: number, pad: Pad): void; onSnap(wire: Wire): void; reorder(before: number[], after: number[]): void };
const netStats = { snapBytes: 0, snaps: 0, stepMs: 0, steps: 0, frameMs: 0, frames: 0, got: 0, since: 0 };

function openGame(p: Pack, si: number) {
  const l = link; if (!l) return;
  const key = `${l.room.run}|${p.id}|${si}`;
  if (game?.key === key) { game.sync(); return; }
  game?.stop();
  host.setStop(null);
  const stage = p.stageData[si];
  const world: World = createWorld(stage, l.room.order.map(seat => ({ color: colorFor(seat) })), l.room.seed);
  const pads = new Map<number, { pad: Pad; at: number }>();
  let track: Track = newTrack();
  let cam: Camera | undefined, raf = 0, last = performance.now(), acc = 0, ticks = 0, sent = 0, alive = true;
  let hintUntil = last + 6000, ended = false, mathText = '', wasHost = l.isHost, hudKey = '', hostSeat = l.host;

  host.app.innerHTML = `<main class="arcade-root w-root w-play">
    <div class="w-stagebox"><canvas class="px w-canvas" width="${VIEW_W}" height="${VIEW_H}" aria-label="게임 화면"></canvas>
      <div class="lab-hud w-hud"><div class="w-hud-l">${roomTags()}<span class="grow ar-kicker w-hudtitle"><span class="w-hide-s">${esc(p.name)} </span>${String(si + 1).padStart(2, '0')} ${esc(p.stages[si].name)}</span></div><div class="w-hud-r"></div></div>
      <p class="w-hint" role="status"></p>
      <p class="w-math" aria-live="polite" hidden></p>
      <div class="w-end" hidden></div>
    </div></main>`;
  const app = host.app, canvas = app.querySelector<HTMLCanvasElement>('canvas')!, c = canvas.getContext('2d')!;
  const box = app.querySelector<HTMLElement>('.w-stagebox')!, hintEl = app.querySelector<HTMLElement>('.w-hint')!, mathEl = app.querySelector<HTMLElement>('.w-math')!, endEl = app.querySelector<HTMLElement>('.w-end')!, tools = app.querySelector<HTMLElement>('.w-hud-r')!;
  const input = new PadInput(); input.mount(box);
  hintEl.textContent = stage.hint;
  const send = padSender();
  const meIdx = () => (link ? link.room.order.indexOf(link.me) : -1);
  const blur = (e: Event) => (e.currentTarget as HTMLElement).blur();   // 단추에 초점이 남으면 엔터·스페이스가 그 단추를 다시 누른다

  /** 위쪽 줄의 단추: 방장과 손님이 다르고, 방장이 바뀌면 다시 그린다. */
  const hud = () => {
    const k = link; if (!k) return;
    const now = `${k.isHost}|${k.room.big}|${joinIn}|${ended}`;
    updateStrip();
    box.classList.toggle('w-nopad', meIdx() < 0);
    if (now === hudKey) return; hudKey = now;
    tools.innerHTML = k.isHost
      ? `${k.room.big ? `<button class="ar-key ghost" data-joinin aria-pressed="${joinIn}" aria-label="이 화면에서도 도름이 움직이기">${icon('up', 17)}<span class="w-hide-s">나도 뛰기</span></button>` : ''}<button class="ar-key ghost" data-retry aria-label="처음부터 다시 하기">${icon('redo', 17)}<span class="w-hide-s">다시 하기</span></button><button class="ar-key ghost" data-invite aria-label="친구 부르기">${icon('plus', 17)}<span class="w-hide-s">친구 부르기</span></button><button class="ar-key ghost" data-pick aria-label="스테이지 고르러 나가기">${icon('door', 17)}<span class="w-hide-s">나가기</span></button>`
      : `${k.room.big ? `<button class="ar-key ghost" data-padonly aria-label="조작기로 쓰기">${icon('pad', 17)}<span class="w-hide-s">조작기로 쓰기</span></button>` : ''}<button class="ar-key ghost" data-leave aria-label="방 나가기">${icon('door', 17)}<span class="w-hide-s">방 나가기</span></button>`;
    tools.querySelector<HTMLButtonElement>('[data-joinin]')?.addEventListener('click', e => { joinIn = !joinIn; blur(e); reconcile(); hud(); });
    tools.querySelector<HTMLButtonElement>('[data-retry]')?.addEventListener('click', () => start(p, si));
    tools.querySelector<HTMLButtonElement>('[data-invite]')?.addEventListener('click', e => { blur(e); inviteDialog(false); });
    tools.querySelector<HTMLButtonElement>('[data-pick]')?.addEventListener('click', () => host.go(`g/${p.id}`));
    tools.querySelector<HTMLButtonElement>('[data-padonly]')?.addEventListener('click', () => { link?.setView('pad'); refresh(); });
    tools.querySelector<HTMLButtonElement>('[data-leave]')?.addEventListener('click', leaveRoom);
  };

  const finish = () => {
    ended = true; hud();
    const k = link; if (!k) return;
    const sec = Math.round(world.t), time = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    const next = si + 1 < p.stages.length, n = world.players.length;
    endEl.hidden = false;
    endEl.innerHTML = `<div class="ar-cabinet lab-modal" role="dialog" aria-label="스테이지 끝"><div class="ar-bezel"><div class="ar-brand"><span class="ar-badge">CLEAR</span> 스테이지 끝</div></div><div class="ar-screen"><div class="ar-screen-inner">
      <div class="ar-title">다 함께 성공했어요</div><p class="ar-sub">${n}명이 모두 문으로 들어갔어요. 걸린 시간 <span class="ar-mono w-time">${time}</span></p>
      ${k.isHost
        ? `<div class="lab-actions">${next ? `<button class="ar-key mustard" data-next>${icon('right', 17)}다음 스테이지</button>` : `<button class="ar-key mustard" data-again>${icon('redo', 17)}한 번 더</button>`}${next ? `<button class="ar-key ghost" data-again>${icon('redo', 17)}한 번 더</button>` : ''}<button class="ar-key ghost" data-list>스테이지 고르기</button></div>`
        : '<p class="ar-sub w-end-wait" role="status">방장이 다음 스테이지를 고르고 있어요.</p>'}
    </div></div></div>`;
    endEl.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', () => start(p, si + 1));
    endEl.querySelector<HTMLButtonElement>('[data-again]')?.addEventListener('click', () => start(p, si));
    endEl.querySelector<HTMLButtonElement>('[data-list]')?.addEventListener('click', () => host.go(`g/${p.id}`));
    endEl.querySelector<HTMLButtonElement>('button')?.focus();
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const k = link; if (!k) return;
    const t0 = performance.now(), dt = Math.min((now - last) / 1000, 0.1); last = now;
    const myPad = input.read();
    if (k.isHost !== wasHost) {
      wasHost = k.isHost;
      // 방장이 됐다: 마지막 요약에서 이어서 굴린다. 그 요약에 남아 있는 나간 사람의 도름이는 지금 차례에 맞춰 뺀다
      if (k.isHost) {
        if (track.b && applyWire(world, track.b)) mine.reorder(wireSeats(track.b), k.room.order);
        sent = Math.max(sent, track.b?.n ?? 0);          // 요약의 차례 번호는 앞 방장의 것에 이어서 센다(손님이 '지난 요약'으로 버리지 않게)
        reconcile(); acc = 0;
      }
      track = newTrack(); pads.clear();
      if (ended) { ended = false; finishIfWon(); }
      hud();
    }
    if (k.isHost) {
      acc = Math.min(acc + dt, 0.1);
      while (acc >= 1 / 60) {
        const order = k.room.order, s0 = performance.now();
        step(world, order.map(seat => { if (seat === k.me) return myPad; const g = pads.get(seat); return g && now - g.at < 1500 ? g.pad : NO_PAD; }), 1 / 60);
        acc -= 1 / 60; ticks++;
        if (ticks % (world.won ? 30 : SNAP_EVERY) === 0) { netStats.snapBytes = k.sendSnap(toWire(world, order, k.room.run, ++sent)); netStats.snaps++; }
        netStats.stepMs += performance.now() - s0; netStats.steps++;
      }
    } else {
      send(myPad, now);
      blend(world, track, now, dt);
    }
    const me = meIdx();
    cam = cameraFor(world, world.won || (k.isHost && k.room.big) || me < 0 ? null : me, cam);
    render(c, world, cam, now, me >= 0 ? me : null);
    if (now > hintUntil && hintEl.textContent) hintEl.textContent = '';
    const math = hintEl.textContent || world.won ? '' : nearText(world, me >= 0 ? me : null);
    if (math !== mathText) {
      mathText = math; mathEl.hidden = !math;
      mathEl.replaceChildren(...(math ? math.split('\n') : []).map(t => { const s = document.createElement('span'); s.textContent = t; return s; }));
    }
    finishIfWon();
    netStats.frameMs += performance.now() - t0; netStats.frames++;
  };
  const finishIfWon = () => { if (world.won && !ended) finish(); };

  const mine: Game = {
    key,
    stop() {
      if (!alive) return; alive = false;
      cancelAnimationFrame(raf); input.dispose();
      if (game === mine) game = null;
      if (shown === 'game') shown = '';
    },
    sync() {
      // 방장이 바뀌었으면 손님은 앞 방장의 요약 차례를 잊는다(새 방장의 첫 요약부터 받는다)
      if (link && link.host !== hostSeat) { hostSeat = link.host; if (!link.isHost) track = newTrack(); }
      hud();
    },
    onPad(seat, pad) { pads.set(seat, { pad, at: performance.now() }); },
    onSnap(wire) { if (link && !link.isHost && pushWire(track, wire, link.room.run, performance.now())) netStats.got++; },
    reorder(before, after) {
      for (let i = before.length - 1; i >= 0; i--) if (!after.includes(before[i])) removePlayer(world, i);
      if (world.players.length !== after.length || world.players.some((q, i) => q.color !== colorFor(after[i]))) setPlayerCount(world, after.slice(0, MAX_SEATS).map(colorFor));
    },
  };
  game = mine; shown = 'game';
  hud();
  raf = requestAnimationFrame(frame);
  host.setStop(mine.stop);
  // 시험 도구가 상태를 읽을 수 있게(개발 중에만).
  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>;
    w.__world = () => world;
    netStats.since = performance.now(); netStats.snaps = netStats.steps = netStats.frames = netStats.got = 0; netStats.stepMs = netStats.frameMs = 0;
    w.__net = () => ({ code: link?.code, me: link?.me, host: link?.host, isHost: link?.isHost, room: link?.room, seats: link?.seats, myIndex: meIdx(), ...netStats, seconds: (performance.now() - netStats.since) / 1000 });
  }
}

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__room = () => (link ? { code: link.code, me: link.me, host: link.host, isHost: link.isHost, open: link.open, room: link.room, seats: link.seats, shown } : null);

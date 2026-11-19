/**
 * 조작: 자판과 화면 단추를 한 값으로 모은다.
 * 움직이기 ← → (A D) · 뛰기 스페이스 ↑ W Z · 확인 엔터 E X (열린 문에 들어가기)
 *
 * 키를 여러 개 겹쳐 눌러도 조작이 빠지지 않게 하는 약속:
 * - 뛰기는 '누르고 있나'가 아니라 키가 눌린 사건마다 센다(jn). 뛰기 키를 누른 채 다른 뛰기 키를 눌러도 새 누름이다.
 * - 좌우를 함께 누르면 멈추지 않고 나중에 누른 쪽으로 간다(방향을 바꾸며 손가락이 겹칠 때).
 * - 자판에 따라 방향키 셋(← → ↑) 같은 조합은 기계가 세 번째 키를 못 읽는다(소프트웨어로 못 고친다).
 *   그래서 뛰기를 방향키 밖(스페이스 · Z · W)에도 두고, 화면 안내는 스페이스를 앞세운다. Shift 는 윈도우 고정 키 창을 띄워서 쓰지 않는다.
 */
import { icon } from './icons';
import type { Pad } from './sim';

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']), RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW', 'KeyZ']);
const OK_KEYS = new Set(['Enter', 'NumpadEnter', 'KeyE', 'KeyX']);

export class PadInput {
  private keys = new Set<string>();
  private fresh = new Set<string>();   // 프레임 사이에 눌렀다 뗀 짧은 누름도 한 번은 읽히게
  private touch = { l: false, r: false, j: false, a: false };
  private jn = 0;                       // 뛰기를 새로 누른 횟수
  private lastDir: -1 | 1 = 1;          // 좌우 가운데 나중에 누른 쪽
  private el: HTMLElement | null = null;

  constructor() {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.hidden);
  }

  private typing(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  private down = (e: KeyboardEvent) => {
    if (this.typing(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;   // 브라우저 단축키(⌘←, Alt+← 등)는 가로채지 않고 조작으로도 읽지 않는다
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter'].includes(e.code)) e.preventDefault();
    // 누르고 있어 되풀이되는 사건은 새 누름이 아니다. 다만 뗀 사건을 놓친 키(창을 벗어났다 온 경우)는 다시 누르면 새 누름으로 친다.
    const isNew = !e.repeat;
    this.keys.add(e.code);
    if (!isNew) return;
    this.fresh.add(e.code);
    if (JUMP_KEYS.has(e.code)) this.jn++;
    if (LEFT_KEYS.has(e.code)) this.lastDir = -1; else if (RIGHT_KEYS.has(e.code)) this.lastDir = 1;
  };
  private up = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    // 맥에서는 ⌘ 를 누른 동안 뗀 키의 사건이 오지 않는다. ⌘ 를 떼면 남은 키를 모두 뗀 것으로 본다.
    if (e.code === 'MetaLeft' || e.code === 'MetaRight') this.keys.clear();
  };
  private clear = () => { this.keys.clear(); this.fresh.clear(); this.touch = { l: false, r: false, j: false, a: false }; };
  private hidden = () => { if (document.hidden) this.clear(); };

  /** 화면 단추를 host 안에 만든다(터치 기기에서만 보이게 CSS 가 정한다). */
  mount(host: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'w-pad';
    el.innerHTML = `<div class="pad-l"><button class="ar-key" data-k="l" aria-label="왼쪽으로">${icon('left', 26)}</button><button class="ar-key" data-k="r" aria-label="오른쪽으로">${icon('right', 26)}</button></div><div class="pad-r"><button class="ar-key act" data-k="a" aria-label="확인">${icon('check', 26)}</button><button class="ar-key mustard jump" data-k="j" aria-label="뛰기">${icon('up', 30)}</button></div>`;
    for (const b of el.querySelectorAll<HTMLButtonElement>('button')) {
      const k = b.dataset.k as 'l' | 'r' | 'j' | 'a';
      const set = (v: boolean) => (e: Event) => {
        e.preventDefault();
        if (v && !this.touch[k]) { if (k === 'j') this.jn++; else if (k === 'l') this.lastDir = -1; else if (k === 'r') this.lastDir = 1; }
        this.touch[k] = v; b.classList.toggle('held', v);
      };
      b.addEventListener('pointerdown', e => { b.setPointerCapture(e.pointerId); set(true)(e); });
      b.addEventListener('pointerup', set(false));
      b.addEventListener('pointercancel', set(false));
      b.addEventListener('contextmenu', e => e.preventDefault());
    }
    host.appendChild(el); this.el = el;
  }

  read(): Pad {
    const k = new Set([...this.keys, ...this.fresh]); this.fresh.clear();
    const any = (set: Set<string>) => { for (const c of set) if (k.has(c)) return true; return false; };
    const l = any(LEFT_KEYS) || this.touch.l, r = any(RIGHT_KEYS) || this.touch.r;
    return {
      m: l && r ? this.lastDir : l ? -1 : r ? 1 : 0,
      j: any(JUMP_KEYS) || this.touch.j,
      jn: this.jn,
      a: any(OK_KEYS) || this.touch.a,
    };
  }

  dispose() {
    window.removeEventListener('keydown', this.down); window.removeEventListener('keyup', this.up); window.removeEventListener('blur', this.clear);
    document.removeEventListener('visibilitychange', this.hidden);
    this.el?.remove();
  }
}

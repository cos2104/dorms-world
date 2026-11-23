/**
 * 스위치: 가까이에서 확인을 누를 때마다 켜고 끈다. 켜진 동안 그 물건 종류의 opens 다리가 켜진다.
 * 그림이 두 장이면 꺼짐은 첫 장, 켜짐은 둘째 장. 새 움직임을 만들 때 본보기로 본다.
 */
import type { Behavior } from '../behavior';

const toggle: Behavior = {
  about: '확인으로 켜고 끈다(켜진 동안 다리가 켜진다)',
  use: ctx => { ctx.vars[0] = ctx.vars[0] ? 0 : 1; return true; },
  useText: ctx => (ctx.vars[0] ? '확인: 끄기' : '확인: 켜기'),
  frame: ctx => (ctx.vars[0] ? 1 : 0),
};
export default toggle;

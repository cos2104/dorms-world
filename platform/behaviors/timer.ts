/**
 * 시간 단추: 밟으면 켜지고, 아무도 밟지 않아도 몇 초 동안 켜진 채로 있다가 꺼진다.
 * 그 사이에 다른 친구가 건너가야 하는 '잠깐 열리는 다리'를 만든다. 남은 시간은 vars[1](초).
 */
import type { Behavior } from '../behavior';

const HOLD = 4;
const timer: Behavior = {
  about: '닿으면 켜지고 4초 뒤 꺼진다',
  tick: (ctx, dt, touching) => {
    if (touching.length) ctx.vars[1] = HOLD;
    else ctx.vars[1] = Math.max(0, ctx.vars[1] - dt);
    ctx.vars[0] = ctx.vars[1] > 0 ? 1 : 0;
  },
  frame: ctx => (ctx.vars[0] ? 1 : 0),
};
export default timer;

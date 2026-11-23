/**
 * 찍는 방·손잡이 방에서 넣은 주문의 모양. 방 서버(room-rules)도 쓰므로 무거운 식 처리(expr)를 들이지 않는다.
 * 식이 맞는지는 방장이 readFormula 로 다시 본다.
 */
export const ORDER_LATEX_MAX = 160;
export type Order = { k: 'f'; fac: number; latex: string } | { k: 'h'; fac: number; x0: number; y0: number; a: number; b: number };

/** 남이 보낸 주문의 모양을 검사한다(방 서버와 방장이 함께 쓴다). 어긋나면 null. */
export function cleanOrder(x: unknown): Order | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const fac = o.fac;
  if (typeof fac !== 'number' || !Number.isInteger(fac) || fac < 0 || fac > 7) return null;
  if (o.k === 'f') return typeof o.latex === 'string' && o.latex.length <= ORDER_LATEX_MAX ? { k: 'f', fac, latex: o.latex } : null;
  if (o.k === 'h') {
    const v = [o.x0, o.y0, o.a, o.b];
    if (!v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000)) return null;
    return { k: 'h', fac, x0: o.x0 as number, y0: o.y0 as number, a: o.a as number, b: o.b as number };
  }
  return null;
}

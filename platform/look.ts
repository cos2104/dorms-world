/**
 * 화풍 한 곳. 2026-11-19 형이 고른 시안 6번("형 도름이 + 힉스필드") 값이다.
 * 도름이는 형의 스프라이트 시트를 그대로 쓰고 몸 색만 갈아입힌다. 움직임 값도 형의 리액트 코드 그대로.
 */
export const VIEW_W = 960, VIEW_H = 540;

export const PALETTE = {
  sky: '#EEF5FF', skyLow: '#D9E8FF', grass: '#A8E6C8', soil: '#F3E6CC',
  outline: '#3978CE', navy: '#14285F', key: '#F5C542', door: '#9A5B44', button: '#E0524F', crate: '#F2B49A', paper: '#F4F7FF',
} as const;

/** 시트에서 자른 자리: [x, y, 너비, 높이] */
export const ATLAS: Record<string, [number, number, number, number]> = {
  left_0: [0, 1, 22, 40], left_1: [24, 1, 22, 40], left_2: [48, 1, 22, 40],
  front_0: [72, 1, 26, 40], front_1: [100, 1, 25, 40], front_2: [127, 1, 27, 40],
  right_0: [156, 1, 22, 40], right_1: [180, 1, 22, 40], right_2: [204, 1, 22, 40],
  back_0: [228, 0, 23, 41], back_1: [253, 0, 23, 41], back_2: [278, 0, 23, 41],
};

/** 시트의 몸 색 네 단계. 이 색들만 플레이어 색으로 바꾼다(남색 소용돌이·눈·볼은 그대로). */
export const BODY_SHADES: [string, number][] = [['f4f7ff', 1], ['d6e2f7', 0.9], ['8fb3e8', 0.78], ['3978ce', 0.55]];

export const MOTION = { turnFront: 0.18, walkBobMs: 120, idleBreathMs: 1800 } as const;

export const SPRITES = ['bg', 'tile', 'soil', 'key', 'door', 'door_open', 'button', 'crate', 'plank'] as const;
export type SpriteName = (typeof SPRITES)[number];

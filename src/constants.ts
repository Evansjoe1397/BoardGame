import type { PlayerId, DamageType, AttackType } from './types';

export const BOARD_WIDTH: number = 10;
export const BOARD_LENGTH: number = 18;
export const WIDTH_LABELS: string[] = 'ABCDEFGHIJ'.split('');
export const TURN_DRAW_COUNT: number = 5;
export const MAX_ENERGY: number = 30;
export const STARTING_SUPPLY: number = 300;
export const BASE_MAX_HIT_POINTS: number = 50;
export const TILE_SIZE: number = 2.6;
export const UNIT_MODEL_SCALE: number = 2;
export const BUILDING_UPGRADE_SUPPLY_COST: number = 100;
export const DAMAGE_TYPES = {
  ATTACK: 'ATTACK',
  SYSTEM: 'SYSTEM'
} as const satisfies Record<string, DamageType>;
export const ATTACK_TYPES = {
  NORMAL: 'NORMAL',
  EMP: 'EMP'
} as const satisfies Record<string, AttackType>;
export const SUPPLY_HARVEST_SQUARES: ReadonlySet<string> = new Set(['A9', 'A10', 'J9', 'J10']);
export const PURPLE_SQUARES: ReadonlySet<string> = new Set(['E9', 'E10', 'F9', 'F10']);
export const SUPPLY_HARVEST_REWARD: number = 20;
export const COMPANY_NAMES: readonly string[] = [
  'Coca Cola',
  'Mitsubishi',
  'Toyota',
  'Samsung',
  'Sony',
  'Siemens',
  'Boeing',
  'Intel',
  'Nokia',
  'Shell',
  'PepsiCo',
  'Nestle'
] as const;

export const BASE_SQUARES: Record<PlayerId, ReadonlySet<string>> = {
  A: new Set(['E1', 'F1', 'E2', 'F2']),
  B: new Set(['E17', 'F17', 'E18', 'F18'])
};
export const BASE_ARTILLERY_FRONT_SQUARES: Record<PlayerId, ReadonlySet<string>> = {
  A: new Set(['E2', 'F2']),
  B: new Set(['E17', 'F17'])
};

export const BASE_COLORS: Record<PlayerId, number> = {
  A: 0x2f72ff,
  B: 0xd73a49
};

export const UNIT_COLORS: Record<PlayerId, number> = {
  A: 0x7aa4ff,
  B: 0xff7e86
};

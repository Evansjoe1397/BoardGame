import type { UnitTemplate, UnitTypeId } from '../types';

export const UNIT_LIBRARY = {
  PAWN_DRONE_UNIT: {
    unitName: 'Pawn Drone',
    maxHitPoints: 8,
    attackDamage: 4,
    attackRange: 3,
    moveRange: 3
  },
  TANK_DRONE_UNIT: {
    unitName: 'Tank Drone',
    maxHitPoints: 20,
    attackDamage: 3,
    attackRange: 1,
    moveRange: 2
  },
  SUPPORT_DRONE_UNIT: {
    unitName: 'Support Drone',
    maxHitPoints: 10,
    attackDamage: 2,
    attackRange: 2,
    moveRange: 4
  },
  GHOSTBLADE_UNIT: {
    unitName: 'Ghostblade',
    maxHitPoints: 14,
    attackDamage: 8,
    attackRange: 1,
    moveRange: 4
  },
  ARTILLERY_UNIT: {
    unitName: 'Artillery',
    maxHitPoints: 13,
    attackDamage: 7,
    attackRange: 6,
    moveRange: 1
  },
  SPECIALIST_UNIT: {
    unitName: 'Specialist',
    maxHitPoints: 7,
    attackDamage: 2,
    attackRange: 4,
    moveRange: 3
  }
} as const satisfies Record<UnitTypeId, UnitTemplate>;

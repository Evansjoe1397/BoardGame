import type { StatusDefinition, StatusId, BuildingType } from '../types';

export const DRONE_STATUS_LIBRARY: Record<StatusId, StatusDefinition> = {
  TOUGH: {
    id: 'TOUGH',
    statusName: 'Tough',
    iconGlyph: '&#128737;&#65039;&#10084;&#65039;',
    iconSymbol: '\u{1F6E1}\uFE0F',
    description: 'Adds 3 HP',
    effects: {
      maxHitPointsBonus: 3
    }
  },
  GROUNDED: {
    id: 'GROUNDED',
    statusName: 'Grounded',
    iconGlyph: '&#129521;',
    iconSymbol: '\u{1F9F1}',
    description: 'Receive -1 DMG per attack while Planted',
    effects: {
      plantedDamageReduction: 1
    }
  },
  BULWARK: {
    id: 'BULWARK',
    statusName: 'Bulwark',
    iconGlyph: '&#128737;&#65039;',
    iconSymbol: '\u{1F6E1}\uFE0F',
    description: 'Core Magnet offers 100% frontal resistance at 3 Squares.',
    effects: {
      bulwarkCoreMagnet: true
    }
  },
  BEACON: {
    id: 'BEACON',
    statusName: 'Beacon',
    iconGlyph: '&#128678;',
    iconSymbol: '\u{1F6A6}',
    description: 'No CD for Core Magnet. Can use or Cancel at any time.',
    effects: {
      beaconCoreMagnet: true
    }
  },
  ATAKK: {
    id: 'ATAKK',
    statusName: 'Atakk',
    iconGlyph: '&#128299;',
    iconSymbol: '\u{1F52B}',
    description: 'Gains +2 MOV when at full HP',
    effects: {
      moveBonusAtFullHp: 2
    }
  },
  FACE_EATER: {
    id: 'FACE_EATER',
    statusName: 'Face-Eater',
    iconGlyph: '&#128121;',
    iconSymbol: '\u{1F479}',
    description: '+4 Attack. Tank Drone attacks have 2-turn cooldown',
    effects: {
      attackDamageBonus: 4
    }
  },
  TRUE_P: {
    id: 'TRUE_P',
    statusName: 'True P',
    iconGlyph: '&#128165;',
    iconSymbol: '\u{1F4A5}',
    description: 'Explode for 5 DMG on death',
    effects: {
      onDeathExplosionDamage: 5,
      onDeathExplosionRadiusSquares: 6,
      onDeathHitsAdjacentDrones: true,
      onDeathHitsEnemyBase: true,
      onDeathHitsOwnBase: false
    }
  },
  JOLTING: {
    id: 'JOLTING',
    statusName: 'Jolting',
    iconGlyph: '&#9889;',
    iconSymbol: '\u26A1',
    description: 'Tactical Dash CD is 1 Turn',
    effects: {
      tacticalDashCooldownTurns: 1
    }
  },
  SHOTGUNS: {
    id: 'SHOTGUNS',
    statusName: 'Shotguns?',
    iconGlyph: '&#129492;&#128684;',
    iconSymbol: '\u{1F9D4}',
    description: '+2ATT, but -1 Range',
    effects: {
      attackDamageBonus: 2,
      attackRangeDelta: -1
    }
  },
  ENERGIZE: {
    id: 'ENERGIZE',
    statusName: 'Energize',
    iconGlyph: '&#128268;',
    iconSymbol: '\u26A1',
    description: 'Deal 1 System DMG per attack. Any bonus DMG deal as System DMG',
    effects: {
      systemDamagePerAttack: 1,
      convertAttackBonusesToSystemDamage: true
    }
  },
  KNIGHT: {
    id: 'KNIGHT',
    statusName: 'Knight',
    iconGlyph: '&#129689;',
    iconSymbol: '\u{1FA96}',
    description: 'Double any Shield gained',
    effects: {
      doubleShieldGained: true
    }
  },
  STEADY: {
    id: 'STEADY',
    statusName: 'Steady',
    iconGlyph: '&#127919;',
    iconSymbol: '\u{1F3AF}',
    description: "Gain 1 Range, if didn't move this turn",
    effects: {
      rangeBonusIfDidNotMove: 1
    }
  },
  PROVIDER: {
    id: 'PROVIDER',
    statusName: 'Provider',
    iconGlyph: '&#9935;',
    iconSymbol: '\u26CF',
    description: 'Add +3 Supply per Harvest',
    effects: {
      flatSupplyBonusOnDroneGain: 3
    }
  },
  ENGINEER: {
    id: 'ENGINEER',
    statusName: 'Engineer',
    iconGlyph: '&#128679;',
    iconSymbol: '\u{1F477}',
    description: "Repair permanently increases Target's ATT by 1",
    effects: {
      repairAddsPermanentAttackToTarget: 1
    }
  },
  SMART: {
    id: 'SMART',
    statusName: 'Smart',
    iconGlyph: '&#128161;',
    iconSymbol: '\u{1F4A1}',
    description: 'No Energy cost for Repair',
    effects: {
      repairEnergyCostOverride: 0
    }
  },
  OPERATOR: {
    id: 'OPERATOR',
    statusName: 'Operator',
    iconGlyph: '&#128269;',
    iconSymbol: '\u{1F50D}',
    description: '+2 to Range, but -2 Movement',
    effects: {
      attackRangeDelta: 2,
      moveRangeBonus: -2
    }
  },
  SPD: {
    id: 'SPD',
    statusName: 'Spd',
    iconGlyph: '&#128760;',
    iconSymbol: '\u{1F6DE}\uFE0F',
    description: 'Add +1 MOV',
    effects: {
      moveRangeBonus: 1
    }
  },
  MECHA: {
    id: 'MECHA',
    statusName: 'Mecha',
    iconGlyph: '&#128295;',
    iconSymbol: '\u{1F527}',
    description: '+2 Hit Points on any Repair for Target and this Drone',
    effects: {
      repairBonusToTarget: 2,
      repairBonusToSelf: 2
    }
  },
  SNIPER: {
    id: 'SNIPER',
    statusName: 'Sniper',
    iconGlyph: '&#128299;',
    iconSymbol: '\u{1F52B}',
    description: 'Add +6 ATT, but EMP CD is +3 turns',
    effects: {
      attackDamageBonus: 6,
      specialistEmpCooldownBonus: 3
    }
  },
  SCHOLAR: {
    id: 'SCHOLAR',
    statusName: 'Scholar',
    iconGlyph: '&#128214;',
    iconSymbol: '\u{1F4D6}',
    description: 'Copy Repair from Support Drone, including all Upgrades',
    effects: {
      grantsSpecialistRepair: true
    }
  },
  SALVO: {
    id: 'SALVO',
    statusName: 'Salvo',
    iconGlyph: '&#128163;&#128163;',
    iconSymbol: '\u{1F4A3}',
    description: "Can use two EMP per turn, but can't get Shield",
    effects: {
      specialistEmpExtraUsePerTurn: 1,
      cannotGainShield: true
    }
  },
  VIRUS: {
    id: 'VIRUS',
    statusName: 'Virus',
    iconGlyph: '&#128027;&#65038;',
    iconSymbol: '\u{1F41B}\uFE0E',
    description: "On hit, deduct target's ATT for next turn, equal to Specialist's ATT",
    effects: {
      specialistVirusOnHit: true
    }
  },
  RAGE: {
    id: 'RAGE',
    statusName: 'Rage',
    iconGlyph: '&#128545;',
    iconSymbol: '\u{1F621}',
    description: 'Can Attack after moving, if not at full health',
    effects: {
      ghostbladeCanAttackAfterMoveWhenDamaged: true
    }
  },
  SHELL: {
    id: 'SHELL',
    statusName: 'Shell',
    iconGlyph: '&#128034;',
    iconSymbol: '\u{1F422}\uFE0E',
    description: 'Resist 75% Damage dealt at any first attack during the turn.',
    effects: {
      shellFirstHitAttackResistance: 0.75
    }
  },
  TANGO: {
    id: 'TANGO',
    statusName: 'Tango',
    iconGlyph: '&#9876;&#65039;',
    iconSymbol: '\u2694\uFE0F',
    description: 'Attack first enemy Drone to move in range',
    effects: {
      ghostbladeReactiveAttackOnEnemyMove: true
    }
  },
  GAUSS: {
    id: 'GAUSS',
    statusName: 'Gauss',
    iconGlyph: '&#9473;',
    iconSymbol: '\u2501',
    description: 'Shoot a straight beam at 5 squares',
    effects: {
      artilleryGaussLineAttack: true
    }
  },
  DRONES: {
    id: 'DRONES',
    statusName: 'Drones',
    iconGlyph: '&#128641;',
    iconSymbol: '\u{1F681}',
    description: 'Recon Drones increase Artillery range by 1, but -2DMG per Square',
    effects: {
      attackRangeDelta: 1,
      attackDamageBonus: -2
    }
  },
  BALLISTIC: {
    id: 'BALLISTIC',
    statusName: 'Ballistic',
    iconGlyph: '&#128640;',
    iconSymbol: '\u{1F680}',
    description: 'Deals 16 Base DMG at 1 Square or 10 DMG to Drone',
    effects: {
      artilleryBallisticAttackMode: true
    }
  }
};

export const BUILDING_PERK_DRAFT_POOL: Record<string, StatusId[]> = {
  ARMORY: ['FACE_EATER', 'TOUGH', 'GROUNDED', 'BULWARK', 'BEACON', 'ATAKK'],
  REPLICATOR: ['TRUE_P', 'JOLTING', 'SHOTGUNS', 'ENERGIZE', 'KNIGHT', 'STEADY'],
  WORKSHOP: ['OPERATOR', 'SPD', 'MECHA', 'PROVIDER', 'ENGINEER', 'SMART'],
  DATACENTER: ['SNIPER', 'SCHOLAR', 'SALVO', 'VIRUS'],
  GEAR_STATION: ['RAGE', 'SHELL', 'TANGO'],
  ASSEMBLY_LINE: ['GAUSS', 'DRONES', 'BALLISTIC']
};

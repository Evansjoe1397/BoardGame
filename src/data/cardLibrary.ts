import type { CardTemplate, BuildCardTemplate, CardId, BuildingType } from '../types';

export const BUILD_CARD_LIBRARY = {
  ARMORY: {
    id: 'ARMORY',
    cardName: 'The Armory',
    supplyCost: 100,
    buildingType: 'ARMORY'
  },
  REPLICATOR: {
    id: 'REPLICATOR',
    cardName: 'The Replicator',
    supplyCost: 100,
    buildingType: 'REPLICATOR'
  },
  WORKSHOP: {
    id: 'WORKSHOP',
    cardName: 'The Workshop',
    supplyCost: 100,
    buildingType: 'WORKSHOP'
  },
  DATACENTER: {
    id: 'DATACENTER',
    cardName: 'Datacenter',
    supplyCost: 65,
    buildingType: 'DATACENTER'
  },
  GEAR_STATION: {
    id: 'GEAR_STATION',
    cardName: 'Gear Station',
    supplyCost: 65,
    buildingType: 'GEAR_STATION'
  },
  ASSEMBLY_LINE: {
    id: 'ASSEMBLY_LINE',
    cardName: 'Assembly Line',
    supplyCost: 65,
    buildingType: 'ASSEMBLY_LINE'
  },
  FOUNDATION: {
    id: 'FOUNDATION',
    cardName: 'Foundation',
    supplyCost: 20,
    buildingType: 'FOUNDATION'
  }
} as const satisfies Record<BuildingType, BuildCardTemplate>;

export const CARD_LIBRARY = {
  HARVEST_DATA: {
    id: 'HARVEST_DATA',
    cardName: 'Harvest Data',
    cardType: 'perk_absorb',
    cardCategory: 'Ability',
    energyCost: 5
  },
  SYSTEM_SHOCK: {
    id: 'SYSTEM_SHOCK',
    cardName: 'System Shock',
    cardType: 'perk_system_shock',
    cardCategory: 'Perk',
    energyCost: 5
  },
  SHIELDING: {
    id: 'SHIELDING',
    cardName: 'Shielding',
    cardType: 'perk_shielding',
    cardCategory: 'Perk',
    energyCost: 10
  },
  SHIMMERING_CLOAK: {
    id: 'SHIMMERING_CLOAK',
    cardName: 'Shimmering Cloak',
    cardType: 'perk_shimmering_cloak',
    cardCategory: 'Perk',
    energyCost: 5
  },
  CREATE_GHOSTBLADE: {
    id: 'CREATE_GHOSTBLADE',
    cardName: 'Ghostblade',
    cardType: 'unit_summon',
    cardCategory: 'Drone',
    energyCost: 25,
    summonUnitId: 'GHOSTBLADE_UNIT'
  },
  PAWN_DRONE: {
    id: 'PAWN_DRONE',
    cardName: 'Pawn Drone',
    cardType: 'unit_summon',
    cardCategory: 'Drone',
    energyCost: 10,
    summonUnitId: 'PAWN_DRONE_UNIT'
  },
  TANK_DRONE: {
    id: 'TANK_DRONE',
    cardName: 'Tank Drone',
    cardType: 'unit_summon',
    cardCategory: 'Drone',
    energyCost: 15,
    summonUnitId: 'TANK_DRONE_UNIT'
  },
  SUPPORT_DRONE: {
    id: 'SUPPORT_DRONE',
    cardName: 'Support Drone',
    cardType: 'unit_summon',
    cardCategory: 'Drone',
    energyCost: 15,
    summonUnitId: 'SUPPORT_DRONE_UNIT'
  },
  ARTILLERY: {
    id: 'ARTILLERY',
    cardName: 'Artillery',
    cardType: 'unit_summon',
    cardCategory: 'Drone',
    energyCost: 25,
    summonUnitId: 'ARTILLERY_UNIT'
  },
  SPECIALIST: {
    id: 'SPECIALIST',
    cardName: 'Specialist',
    cardType: 'unit_summon',
    cardCategory: 'Drone',
    energyCost: 20,
    summonUnitId: 'SPECIALIST_UNIT'
  }
} as const satisfies Record<CardId, CardTemplate>;

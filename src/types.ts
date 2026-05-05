import type * as THREE from 'three';

// ---------------------------------------------------------------------------
// Enums & Literal Unions
// ---------------------------------------------------------------------------

export type PlayerId = 'A' | 'B';

export type UnitTypeId =
  | 'PAWN_DRONE_UNIT'
  | 'TANK_DRONE_UNIT'
  | 'SUPPORT_DRONE_UNIT'
  | 'GHOSTBLADE_UNIT'
  | 'ARTILLERY_UNIT'
  | 'SPECIALIST_UNIT';

export type BuildingType =
  | 'ARMORY'
  | 'REPLICATOR'
  | 'WORKSHOP'
  | 'DATACENTER'
  | 'GEAR_STATION'
  | 'ASSEMBLY_LINE'
  | 'FOUNDATION';

export type CardId =
  | 'HARVEST_DATA'
  | 'SYSTEM_SHOCK'
  | 'SHIELDING'
  | 'SHIMMERING_CLOAK'
  | 'CREATE_GHOSTBLADE'
  | 'PAWN_DRONE'
  | 'TANK_DRONE'
  | 'SUPPORT_DRONE'
  | 'ARTILLERY'
  | 'SPECIALIST';

export type StatusId =
  | 'TOUGH' | 'GROUNDED' | 'BULWARK' | 'BEACON' | 'ATAKK' | 'FACE_EATER'
  | 'TRUE_P' | 'JOLTING' | 'SHOTGUNS' | 'ENERGIZE' | 'KNIGHT' | 'STEADY'
  | 'PROVIDER' | 'ENGINEER' | 'SMART' | 'OPERATOR' | 'SPD' | 'MECHA'
  | 'SNIPER' | 'SCHOLAR' | 'SALVO' | 'VIRUS'
  | 'RAGE' | 'SHELL' | 'TANGO'
  | 'GAUSS' | 'DRONES' | 'BALLISTIC';

export type CardType =
  | 'unit_summon'
  | 'perk_absorb'
  | 'perk_system_shock'
  | 'perk_shielding'
  | 'perk_shimmering_cloak';

export type CardCategory = 'Drone' | 'Ability' | 'Perk';

export type DamageType = 'ATTACK' | 'SYSTEM';
export type AttackType = 'NORMAL' | 'EMP';

export type ProcessEchoSlot = 'X' | '1' | '2' | '3';

export type GameMode =
  | 'idle'
  | 'unit_selected'
  | 'attack_targeting'
  | 'repair_targeting'
  | 'system_shock_targeting'
  | 'system_shock_card'
  | 'system_shock_targeting_echo'
  | 'shielding_targeting'
  | 'shielding_card'
  | 'shielding_equip_instant'
  | 'shielding_equip_echo'
  | 'shimmering_targeting'
  | 'shimmering_card'
  | 'shimmering_targeting_instant'
  | 'shimmering_targeting_echo'
  | 'ghostblade_teleport_targeting'
  | 'artillery_attack_targeting'
  | 'specialist_emp_targeting'
  | 'core_magnet_bulwark_targeting'
  | 'building_placement'
  | 'overload_targeting'
  | 'foundation_targeting'
  | 'foundation_confirm'
  | 'building_upgrade_status_pick'
  | 'harvest_absorb'
  | 'play_card'
  | 'armory_status_pick'
  | 'replicator_status_pick'
  | 'workshop_status_pick'
  | 'datacenter_status_pick'
  | 'gear_station_status_pick'
  | 'assembly_line_status_pick'
  | 'place_building';

// ---------------------------------------------------------------------------
// Data Library Types
// ---------------------------------------------------------------------------

export interface CardTemplate {
  readonly id: CardId;
  readonly cardName: string;
  readonly cardType: CardType;
  readonly cardCategory: CardCategory;
  readonly energyCost: number;
  readonly summonUnitId?: UnitTypeId;
}

export interface BuildCardTemplate {
  readonly id: BuildingType;
  readonly cardName: string;
  readonly supplyCost: number;
  readonly buildingType: BuildingType;
}

export interface UnitTemplate {
  readonly unitName: string;
  readonly maxHitPoints: number;
  readonly attackDamage: number;
  readonly attackRange: number;
  readonly moveRange: number;
}

export interface StatusEffects {
  readonly maxHitPointsBonus?: number;
  readonly attackDamageBonus?: number;
  readonly attackRangeDelta?: number;
  readonly moveRangeBonus?: number;
  readonly plantedDamageReduction?: number;
  readonly bulwarkCoreMagnet?: boolean;
  readonly beaconCoreMagnet?: boolean;
  readonly moveBonusAtFullHp?: number;
  readonly onDeathExplosionDamage?: number;
  readonly onDeathExplosionRadiusSquares?: number;
  readonly onDeathHitsAdjacentDrones?: boolean;
  readonly onDeathHitsEnemyBase?: boolean;
  readonly onDeathHitsOwnBase?: boolean;
  readonly tacticalDashCooldownTurns?: number;
  readonly systemDamagePerAttack?: number;
  readonly convertAttackBonusesToSystemDamage?: boolean;
  readonly doubleShieldGained?: boolean;
  readonly rangeBonusIfDidNotMove?: number;
  readonly flatSupplyBonusOnDroneGain?: number;
  readonly repairAddsPermanentAttackToTarget?: number;
  readonly repairEnergyCostOverride?: number;
  readonly repairBonusToTarget?: number;
  readonly repairBonusToSelf?: number;
  readonly specialistEmpCooldownBonus?: number;
  readonly grantsSpecialistRepair?: boolean;
  readonly specialistEmpExtraUsePerTurn?: number;
  readonly cannotGainShield?: boolean;
  readonly specialistVirusOnHit?: boolean;
  readonly ghostbladeCanAttackAfterMoveWhenDamaged?: boolean;
  readonly shellFirstHitAttackResistance?: number;
  readonly ghostbladeReactiveAttackOnEnemyMove?: boolean;
  readonly artilleryGaussLineAttack?: boolean;
  readonly artilleryBallisticAttackMode?: boolean;
}

export interface StatusDefinition {
  readonly id: StatusId;
  readonly statusName: string;
  readonly iconGlyph: string;
  readonly iconSymbol: string;
  readonly description: string;
  readonly effects: StatusEffects;
}

// ---------------------------------------------------------------------------
// Game Object Types
// ---------------------------------------------------------------------------

export interface Card {
  cardId: CardId;
  producedAt: string;
  producedByBuildingId?: string;
  grantedStatusIds?: StatusId[];
  adjacencyBonuses?: AdjacencyBonuses;
}

export interface AdjacencyBonuses {
  attackDamageBonus?: number;
  maxHitPointsBonus?: number;
  moveRangeBonus?: number;
  attackRangeBonus?: number;
  shieldOnSummon?: number;
}

export interface StatusInstance {
  statusId: StatusId;
  statusName: string;
  iconGlyph: string;
  iconSymbol: string;
}

export interface Building {
  id: string;
  owner: PlayerId;
  type: BuildingType;
  squareKey: string;
  displayName: string;
  companyName: string;
  assignedStatusId: StatusId | null;
  upgradeStatusIds: StatusId[];
  upgraded: boolean;
  createTankDroneCooldown: number;
  createPawnDroneCooldown: number;
  createSupportDroneCooldown: number;
  createSpecialistCooldown: number;
  createGhostbladeCooldown: number;
  createArtilleryCooldown: number;
  obtainUsedThisTurn: boolean;
  overloadUsedThisTurn: boolean;
}

export interface Unit {
  id: string;
  owner: PlayerId;
  unitTypeId: UnitTypeId;
  unitName: string;
  x: number;
  z: number;
  hitPoints: number;
  maxHitPoints: number;
  shieldHitPoints: number;
  attackDamage: number;
  baseAttackDamage: number;
  additionalSystemDamagePerAttack: number;
  attackRange: number;
  moveRange: number;
  movementUsedThisTurn: number;
  overloadBonusMovementThisTurn: number;
  hasMoved: boolean;
  hasAttacked: boolean;
  turnSummoned: boolean;
  canAttackAfterMove: boolean;
  isMeleeLocked: boolean;
  damageType: DamageType;

  // Cooldowns
  tacticalDashCooldown: number;
  tacticalDashActiveThisTurn: boolean;
  coreMagnetCooldown: number;
  coreMagnetTurnsLeft: number;
  repairCooldown: number;
  ghostbladeTeleportCooldown: number;
  artillerySetUpCooldown: number;
  artillerySetUpActive: boolean;
  artillerySetUpUsedThisTurn: boolean;
  specialistEmpCooldown: number;
  specialistEmpUsesThisTurn: number;
  specialistEmpPendingCooldown: boolean;
  tankFaceEaterAttackCooldown: number;
  augmentedAttackBonus: number;
  systemShockAbilityLevel: number;

  // Status
  grantedStatusIds: StatusId[];
  passiveStatuses: StatusInstance[];
  adjacencyStatuses: StatusInstance[];
  empStunnedTurns: number;
  empStunPendingTurns: number;
  virusAttackPenaltyActive: number;
  virusAttackPenaltyPending: number;
  virusDebuffPendingTurns: number;
  virusDebuffActiveTurns: number;
  shellGuardActive: boolean;
  shellGuardUsedThisTurn: boolean;
  tangoGuardActive: boolean;
  tangoArmedThisTurn: boolean;
  systemShockFollowUpReady: boolean;

  // Core Magnet
  coreMagnetLastHealTurnTag: string | null;
  coreMagnetBulwarkCenterSquareKey: string | null;

  // Card bonuses (from adjacency)
  summonShieldAmount?: number;
}

export interface ShimmeringCloak {
  owner: PlayerId;
  squares: string[];
  turnsLeft: number;
}

export interface ProcessEcho {
  X: Card | null;
  1: Card | null;
  2: Card | null;
  3: Card | null;
}

export interface Player {
  id: PlayerId;
  baseHitPoints: number;
  baseMaxHitPoints: number;
  baseDestroyed: boolean;
  maxEnergy: number;
  energy: number;
  supply: number;
  deck: Card[];
  hand: Card[];
  discard: Card[];
  processEcho: ProcessEcho;
  processEchoPlayedThisTurn: boolean;
  buildings: Building[];
  openingHandDrawn: boolean;
  buildingsPlayedThisTurn: number;
  turnCounter: number;
}

export interface GameState {
  currentPlayerId: PlayerId;
  winner: PlayerId | null;
  mode: GameMode;
  hoverSquareKey: string | null;
  selectedCardHandIndex: number | null;
  selectedUnitId: string | null;

  // Targeting state
  coreMagnetPreviewUnitId: string | null;
  coreMagnetBulwarkTargetSquareKey: string | null;
  repairTargetingCasterId: string | null;
  overloadTargetingBuildingId: string | null;
  systemShockCasterId: string | null;
  ghostbladeTeleportCasterId: string | null;
  specialistEmpCasterId: string | null;

  // Pending card plays
  pendingSystemShockLevel: number | null;
  pendingSystemShockSourceSlot: ProcessEchoSlot | null;
  pendingShieldingLevel: number | null;
  pendingShieldingSourceSlot: ProcessEchoSlot | null;
  pendingShimmeringLevel: number | null;
  pendingShimmeringSourceSlot: ProcessEchoSlot | null;
  pendingShimmeringSquares: string[];

  // Pending building placement
  placingBuildingType: BuildingType | null;
  pendingArmorySquareKey: string | null;
  pendingArmoryStatusId: StatusId | null;
  pendingArmoryDraftStatusIds: StatusId[];
  pendingReplicatorSquareKey: string | null;
  pendingReplicatorStatusId: StatusId | null;
  pendingWorkshopSquareKey: string | null;
  pendingWorkshopStatusId: StatusId | null;
  pendingDatacenterSquareKey: string | null;
  pendingDatacenterStatusId: StatusId | null;
  pendingGearStationSquareKey: string | null;
  pendingGearStationStatusId: StatusId | null;
  pendingAssemblyLineSquareKey: string | null;
  pendingAssemblyLineStatusId: StatusId | null;

  // Pending upgrade
  pendingUpgradeBuildingId: string | null;
  pendingUpgradeStatusId: StatusId | null;
  pendingUpgradeStatusOptions: StatusId[];
  pendingFoundationTargetBuildingId: string | null;

  // Game objects
  players: Record<PlayerId, Player>;
  units: Unit[];
  shimmeringCloaks: ShimmeringCloak[];
}

// ---------------------------------------------------------------------------
// Three.js Visual Types
// ---------------------------------------------------------------------------

export interface WalkPart {
  mesh: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  amplitude: number;
  offset: number;
}

export interface RepairArmInternal {
  node: THREE.Object3D;
  baseX: number;
  raiseX: number;
}

export interface SetUpPose {
  legNodes: THREE.Object3D[];
  legRestY: number;
  legDeployY: number;
  barrelRestAngle: number;
  barrelDeployAngle: number;
}

export interface TangoPose {
  bladeNode: THREE.Object3D;
  restAngle: number;
  armedAngle: number;
}

export interface UnitVisual {
  root: THREE.Group;
  clickableMesh: THREE.Mesh;
  bodyMaterial: THREE.MeshStandardMaterial;
  rifleMaterial?: THREE.MeshStandardMaterial;
  walkParts: WalkPart[];
  baseY: number;

  // Optional parts per unit type
  muzzle?: THREE.Object3D;
  wheel?: THREE.Mesh;
  wheelRadiusWorld?: number;
  repairArms?: RepairArmInternal[];
  barrelGroup?: THREE.Group;
  turretGroup?: THREE.Group;
  setUpPose?: SetUpPose;
  tangoPose?: TangoPose;
  recoilX?: number;

  // Status visuals
  coreMagnetDome?: THREE.Mesh;
  bulwarkShield?: THREE.Mesh;
  shellGuardRing?: THREE.Mesh;
  statusIcon?: THREE.Mesh;

  // Health bars
  healthBarsGroup?: THREE.Group;
  healthBarHp?: THREE.Sprite;
  healthBarShield?: THREE.Sprite;
  healthBarsState?: { hp: number | null; maxHp: number | null; shield: number | null };

  // Status badges
  statusBadgesGroup?: THREE.Group;
  statusBadgeGroup?: THREE.Group;
}

export interface BuildingVisual {
  root: THREE.Group;
  owner: PlayerId;
  clickableMesh?: THREE.Mesh;
  bodyMaterial?: THREE.MeshStandardMaterial;
  statusIcons?: THREE.Sprite[];
}


# Game Logic Documentation

## 1. Overview

This is a **turn-based tactical drone combat card game** designed for **2-player local PvP**. Each player commands a fleet of drones, constructs buildings on their base, and plays cards to summon units, cast abilities, and upgrade their forces.

**Objective:** Destroy the opponent's base by reducing its hit points to 0.

Each player starts with a base, a starter deck of 10 cards, 300 Supply, and 30 Energy. Players alternate turns deploying drones, constructing buildings, and maneuvering units across a grid-based board.

---

## 2. Board Layout

- **Grid size:** 10 columns x 18 rows (columns labeled A-J, rows 1-18)
- **Tile size:** 2.6 world units per square

### Base Positions
| Player | Base Squares |
|--------|-------------|
| Player A | E1, F1, E2, F2 |
| Player B | E17, F17, E18, F18 |

### Artillery-Vulnerable Base Squares
Only certain base squares can be targeted by Artillery/Ballistic:
| Player | Front Squares |
|--------|--------------|
| Player A | E2, F2 |
| Player B | E17, F17 |

### Special Squares

| Square(s) | Type | Effect |
|-----------|------|--------|
| A9, A10, J9, J10 | Supply Harvest (Gold) | Award 20 Supply per friendly unit standing on them at end of turn |
| E9, E10, F9, F10 | Purple Squares | Central contested zone |

---

## 3. Turn Structure

When a player's turn begins (`startTurn`), the following occurs in order:

1. **Turn counter increments** for the active player.
2. **Process Echo played-this-turn flag** resets to `false`.
3. **Shimmering Cloak tick-down:** All Shimmering Cloaks owned by this player have their `turnsLeft` decremented by 1. Cloaks reaching 0 are removed.
4. **Energy restored** to the player's max energy (30 base + 5 per Datacenter building).
5. **Buildings played this turn** counter resets to 0.
6. **Building cooldowns tick down** by 1 for each building (Tank Drone, Pawn Drone, Support Drone, Specialist, Ghostblade, Artillery creation cooldowns). Building `obtainUsedThisTurn` and `overloadUsedThisTurn` flags reset.
7. **Card draw:**
   - **First turn:** Draws an opening hand of 5 cards.
   - **Subsequent turns:** Draws 5 cards from deck.
   - If the deck is empty when drawing, the discard pile is shuffled back into the deck.
8. **Unit state resets** for all units owned by the active player:
   - Virus debuff transitions from pending to active.
   - EMP stun transitions from pending to active.
   - Shell Guard reactivates if the Ghostblade has Shell status and it was consumed.
   - Tango Guard deactivates (it activates at end of turn instead).
   - `hasMoved`, `hasAttacked` reset to `false`.
   - `movementUsedThisTurn` resets to 0.
   - `tacticalDashActiveThisTurn` resets to `false`.
   - All ability cooldowns (Core Magnet, Tactical Dash, Repair, Ghostblade Teleport, Artillery Set Up, Specialist EMP, Face-Eater attack) tick down by 1.
   - `specialistEmpUsesThisTurn` resets to 0.
   - `artillerySetUpUsedThisTurn` resets to `false`.
   - `systemShockFollowUpReady` resets to `false`.
   - `overloadBonusMovementThisTurn` resets to 0.

When a player ends their turn (`endTurn`):

1. **Process Echo advances** (see Section 5).
2. **End-of-turn unit processing** for all units owned by the active player:
   - Tango Guard **activates** on Ghostblades with Tango status.
   - EMP stun ticks down by 1.
   - Virus debuff active turns tick down by 1; when reaching 0, the attack penalty clears.
   - Salvo Specialist EMP pending cooldown is applied if needed.
3. **Supply harvest** occurs (see Section 4).
4. **Hand is discarded** -- all remaining cards in hand move to the discard pile.
5. Turn passes to the other player.

---

## 4. Resource System

### Energy
- **Base maximum:** 30
- **Bonus:** +5 max Energy per Datacenter building owned
- **Restored:** Fully at the start of each turn
- **Usage:** Spent to play cards from hand, use abilities (Repair, Teleport, EMP, Overload, Obtain, Draw)

### Supply
- **Starting amount:** 300
- **Usage:** Spent to construct buildings and produce drone cards from buildings
- **Income sources:**
  - **Harvest squares:** 20 Supply per friendly unit on a gold square (A9, A10, J9, J10) at end of turn
  - **Obtain (Datacenter ability):** Gain 5 Supply (or 8 if Workshop is adjacent to the Datacenter) for 5 Energy
  - **Destroying enemy drones:** Gain 50% of the destroyed unit's Energy cost as Supply
  - **Harvest Data card:** Absorb a Drone card from hand for its Energy cost as Supply
  - **Foundation refund:** 50% of destroyed building's Supply cost is refunded
- **Supply bonuses on drones:**
  - **+Supply adjacency status (Workshop adjacency):** +50% bonus Supply on any supply gain by this drone
  - **Provider perk:** +3 flat Supply bonus per gain event

---

## 5. Card System

### Starter Deck (10 cards)
Each player begins with:
| Card | Quantity |
|------|----------|
| Pawn Drone | 2 |
| Support Drone | 2 |
| Tank Drone | 2 |
| Harvest Data | 1 |
| Shielding | 1 |
| System Shock | 1 |
| Shimmering Cloak | 1 |

### Card Library

#### Drone Summon Cards
| Card Name | Energy Cost | Summons |
|-----------|------------|---------|
| Pawn Drone | 10 | Pawn Drone |
| Tank Drone | 15 | Tank Drone |
| Support Drone | 15 | Support Drone |
| Specialist | 20 | Specialist |
| Ghostblade | 25 | Ghostblade |
| Artillery | 25 | Artillery |

#### Ability / Perk Cards
| Card Name | Energy Cost | Category | Effect |
|-----------|------------|----------|--------|
| Harvest Data | 5 | Ability | Absorb a Drone card from hand; gain its Energy cost as Supply |
| System Shock | 5 | Perk | Deal System damage to an enemy drone (level-dependent); grants follow-up action at higher levels |
| Shielding | 10 | Perk | Grant Shield to a friendly drone (amount and stacking depend on level) |
| Shimmering Cloak | 5 | Perk | Make selected squares untargetable (duration depends on level) |

### Process Echo

Process Echo is a 4-slot system (X, 1, 2, 3) that allows cards to gain power over time.

**Slot advancement (occurs at end of turn, before discard):**
- Slot 3 content is discarded (if occupied)
- Slot 2 moves to Slot 3
- Slot 1 moves to Slot 2
- Slot X moves to Slot 1

When a card is **played from a Process Echo slot**, its level equals the slot number. After playing, cards below the played slot shift up to fill the gap, and the played card returns to slot X.

**Level effects by card:**

| Card | Level 1 | Level 2 | Level 3 |
|------|---------|---------|---------|
| System Shock | 5 System DMG + follow-up move/attack | 8 System DMG + follow-up move/attack | 8 System DMG + follow-up + refund 10 Energy if target killed |
| Shielding | 2 Shield (no stack) | 5 Shield (no stack) | 5 Shield (stacks with existing shield) |
| Shimmering Cloak | 1 turn duration | 2 turns duration | 2 turns duration |

Only one Process Echo card may be played per turn (`processEchoPlayedThisTurn` flag).

### Deck Cycling
- When drawing and the deck is empty, the discard pile is shuffled and becomes the new deck.
- At end of turn, all cards remaining in hand are discarded.

---

## 6. Unit Types

### Pawn Drone
| Stat | Value |
|------|-------|
| HP | 8 |
| ATK | 4 |
| Range | 3 |
| Move | 3 |
| Energy Cost | 10 |

**Ability -- Tactical Dash:**
- Grants +1 Movement for the current turn.
- **Cooldown:** 3 turns (or 1 turn with Jolting perk).
- Can attack after moving (standard behavior).

---

### Tank Drone
| Stat | Value |
|------|-------|
| HP | 20 |
| ATK | 3 |
| Range | 1 (melee locked) |
| Move | 2 |
| Energy Cost | 15 |

**Ability -- Core Magnet:**
- Activates a protective field covering the 3x3 area around the Tank Drone.
- **Heals 5 HP** on activation.
- **Duration:** 2 turns.
- **Cooldown:** 3 turns.
- While active, the Tank Drone is "Planted" (cannot move or attack).
- Enemy shots passing through the 3x3 coverage area are **redirected** to the Tank Drone.
- With **Bulwark** perk: Instead of 3x3, the Tank selects one adjacent square as direction. Coverage becomes a 3-square frontal wall. Shots are **blocked entirely** (100% resistance) instead of redirected.
- With **Beacon** perk: No cooldown, lasts 1 turn, can be toggled on/off freely. Heal still applies (once per turn).

---

### Support Drone
| Stat | Value |
|------|-------|
| HP | 10 |
| ATK | 2 |
| Range | 2 |
| Move | 4 |
| Energy Cost | 15 |

**Ability -- Repair:**
- Heals a friendly drone within attack range for **50% of its max HP** (rounded up).
- **Energy cost:** 5 (or 0 with Smart perk).
- **Cooldown:** 2 turns.
- After repairing, the Support Drone's movement is consumed for the turn.
- With **Mecha** perk: Additionally heals +2 HP to both target and caster.
- With **Engineer** perk: Target permanently gains +1 ATK.

---

### Ghostblade
| Stat | Value |
|------|-------|
| HP | 14 |
| ATK | 8 |
| Range | 1 (melee locked) |
| Move | 4 |
| Energy Cost | 25 |

**Cannot attack after moving** (by default). This is unique among all drones.

**Ability -- Teleport:**
- Costs **10 Energy**.
- Teleports to any empty board square (not enemy base, not occupied, not containing a building).
- Deals ATK damage to all adjacent enemies within 1 square of the landing position (AoE).
- Counts as having moved.
- **Cooldown:** 5 turns.

---

### Artillery
| Stat | Value |
|------|-------|
| HP | 13 |
| ATK | 7 |
| Range | 6 |
| Move | 1 |
| Energy Cost | 25 |

**Ability -- Artillery Set Up:**
- Channels into a stationary firing stance. While active, the Artillery can attack at full range.
- **Cannot move while Set Up is active.** Cannot attack without being Set Up.
- Can be toggled off (once per turn usage limit).
- **Cooldown:** 3 turns.
- Artillery attacks target a **2x2 area**. All enemy units in the area take damage.
- Can also target base front squares.
- With **Gauss** perk: Fires a straight-line beam up to 5 squares (or 6 with Drones perk) in any cardinal or diagonal direction, hitting all units and bases along the line.
- With **Ballistic** perk: Targets a single unit or base square. Deals 16 DMG to base, 10 DMG to drones (plus any bonus damage above base ATK).

---

### Specialist
| Stat | Value |
|------|-------|
| HP | 7 |
| ATK | 2 |
| Range | 4 |
| Move | 3 |
| Energy Cost | 20 |

**Ability -- EMP:**
- Costs **5 Energy**.
- Targets a **2x2 area** within the Specialist's attack range.
- On all units in the area:
  - **Removes Shield** (shield amount is dealt as HP damage after Shell Guard check).
  - **Removes Shimmering Cloak** from the square.
  - If the target has an active channeling ability (Core Magnet or Artillery Set Up), the channel is **broken** and the target is **stunned for 1 turn** (cannot move or attack -- "Dazzled").
- **Cooldown:** 2 turns base (+ 3 turns with Sniper perk = 5 turns total).
- With **Salvo** perk: Can use EMP **twice per turn**. Cooldown starts after second use. However, the Specialist **cannot gain Shield**.
- With **Virus** perk: Normal attacks apply Virus debuff -- reduces the target's ATK on its next turn by the Specialist's current ATK value.
- With **Scholar** perk: Gains the Repair ability (same as Support Drone, inheriting Workshop upgrade perks like Mecha, Engineer, Smart).

---

## 7. Building System

Buildings are placed on the owning player's **base squares**. Each base has 4 squares (E1/F1/E2/F2 for Player A; E17/F17/E18/F18 for Player B). A square can hold either a building or a unit, not both.

### Building Types

#### The Armory
| Property | Value |
|----------|-------|
| Supply Cost | 100 |
| Produces | Tank Drone cards (15 Supply, 1-turn cooldown) |
| On Build | Select 1 status from draft pool to assign to produced Tank Drones |
| Upgrade Cost | 65 Supply |
| Upgrade | Pick additional perk from Armory pool |
| Adjacency Bonus | +1 HP to drone cards produced by adjacent buildings |

**Perk Pool:** Face-Eater, Tough, Grounded, Bulwark, Beacon, Atakk

---

#### The Replicator
| Property | Value |
|----------|-------|
| Supply Cost | 100 |
| Produces | Pawn Drone cards (10 Supply, 1-turn cooldown) |
| On Build | Select 1 status from draft pool to assign to produced Pawn Drones |
| Upgrade Cost | 65 Supply |
| Upgrade | Pick additional perk from Replicator pool |
| Adjacency Bonus | +1 ATK to drone cards produced by adjacent buildings |

**Perk Pool:** True P, Jolting, Shotguns?, Energize, Knight, Steady

---

#### The Workshop
| Property | Value |
|----------|-------|
| Supply Cost | 100 |
| Produces | Support Drone cards (15 Supply, 1-turn cooldown) |
| On Build | Select 1 status from draft pool to assign to produced Support Drones |
| Upgrade Cost | 65 Supply |
| Upgrade | Pick additional perk from Workshop pool |
| Adjacency Bonus | +50% Supply yield for drones produced by adjacent buildings |

**Perk Pool:** Operator, Spd, Mecha, Provider, Engineer, Smart

---

#### Datacenter
| Property | Value |
|----------|-------|
| Supply Cost | 65 |
| Passive | +5 Max Energy per Datacenter |
| Ability: Obtain | Spend 5 Energy to gain 5 Supply (8 if a Workshop is adjacent) -- once per turn |
| Produces | Specialist cards (20 Supply, 1-turn cooldown) -- **requires upgrade** |
| On Build | Select 1 status from draft pool |
| Upgrade Cost | 100 Supply |
| Upgrade | Unlocks Specialist production |
| Adjacency Bonus | None |

**Note:** Specialists produced by an upgraded Datacenter also inherit any relevant Workshop repair perks (Mecha, Engineer, Smart) from Workshop buildings owned by the same player, if the Specialist has the Scholar status.

**Perk Pool:** Sniper, Scholar, Salvo, Virus

---

#### Gear Station
| Property | Value |
|----------|-------|
| Supply Cost | 65 |
| Ability: Overload | Spend 5 Energy to grant a friendly drone its base move range as bonus movement this turn -- once per turn |
| Produces | Ghostblade cards (25 Supply, 1-turn cooldown) -- **requires upgrade** |
| On Build | Select 1 status from draft pool |
| Upgrade Cost | 100 Supply |
| Upgrade | Unlocks Ghostblade production |
| Adjacency Bonus | +1 MOV to drone cards produced by adjacent buildings |

**Perk Pool:** Rage, Shell, Tango

---

#### Assembly Line
| Property | Value |
|----------|-------|
| Supply Cost | 65 |
| Ability: Draw | Spend 2 Energy to draw 1 card from deck |
| Produces | Artillery cards (25 Supply, 1-turn cooldown) -- **requires upgrade** |
| On Build | Select 1 status from draft pool |
| Upgrade Cost | 100 Supply |
| Upgrade | Unlocks Artillery production |
| Adjacency Bonus | -3 Energy cost on drone cards produced by adjacent buildings |

**Perk Pool:** Gauss, Drones, Ballistic

---

#### Foundation
| Property | Value |
|----------|-------|
| Supply Cost | 20 |
| Effect | Destroy one of your own buildings |
| Refund | 50% of the destroyed building's Supply cost |
| Base HP Bonus | +5 max base HP and +5 current base HP |

Foundation cannot be upgraded and has no adjacency bonus.

---

### Adjacency Bonus System

When two buildings are **side-adjacent** (sharing an edge, not diagonal), the producing building's drone cards receive bonuses from adjacent buildings:

| Adjacent Building Type | Bonus to Produced Cards |
|----------------------|------------------------|
| Armory | +1 HP |
| Replicator | +1 ATK |
| Workshop | +50% Supply yield on gains |
| Gear Station | +1 MOV |
| Assembly Line | -3 Energy cost |

Adjacency bonuses are recalculated when buildings are placed or destroyed and apply retroactively to existing cards in the deck, hand, and discard pile that were produced by the affected building.

### Building Upgrade System

- **Upgrade cost:** 65 Supply for Armory, Replicator, and Workshop; 100 Supply for Datacenter, Gear Station, and Assembly Line.
- For Armory/Replicator/Workshop: Upgrading presents the full pool of available perks (excluding already-granted ones) and the player picks one additional perk. The new perk is retroactively applied to all existing cards produced by that building.
- For Datacenter/Gear Station/Assembly Line: Upgrading unlocks the ability to produce the advanced drone type (Specialist, Ghostblade, Artillery respectively).

---

## 8. Combat System

### Attack Flow

1. **Range check:** Attacker must be within their current attack range of the target.
2. **Core Magnet interception check** (skipped for System damage and certain AoE attacks):
   - If an enemy Tank Drone has Core Magnet active and its coverage squares intersect the shot path:
     - **Without Bulwark:** Shot is **redirected** to the Tank Drone.
     - **With Bulwark:** Shot is **blocked entirely** (0 damage to anyone).
3. **Damage calculation:**
   - Base damage = attacker's current ATK (reduced by Virus debuff if active).
   - **Grounded check:** If the target is a Planted Tank Drone with Grounded status, -1 damage.
4. **Shell Guard check:** If the target is a Ghostblade with Shell status and Shell Guard is active (first hit this turn), damage is reduced by 75% (rounded up to at least 25% of original). Shell Guard is consumed.
5. **Shield absorption:** If the target has Shield and the attack is not System damage, Shield absorbs damage first. Remaining damage passes through to HP.
6. **HP reduction:** Final damage is subtracted from target's HP.
7. **Energize bonus:** If the attacker is a Pawn Drone with Energize status, bonus System damage is dealt as a separate step after the main attack (does not interact with Shield).
8. **Virus application:** If the attacker is a Specialist with Virus status, the target receives a Virus debuff reducing its ATK on its next turn equal to the Specialist's current ATK.
9. **Death check:** If HP falls to 0 or below, the unit is destroyed. The attacker's owner gains Supply equal to 50% of the destroyed unit's Energy cost.

### Damage Types

| Type | Behavior |
|------|----------|
| ATTACK | Normal damage. Affected by Shield, Core Magnet interception, Grounded reduction, Shell Guard. |
| SYSTEM | Bypasses Core Magnet interception, bypasses Shield. Does **not** affect bases (0 damage to base). Affected by Shell Guard (consumes it but does not reduce System damage). |

### Attack Types

| Type | Behavior |
|------|----------|
| NORMAL | Standard attack behavior. |
| EMP | Does not deal direct HP damage. Instead: removes Shield (dealt as HP damage after Shell Guard check), clears Shimmering Cloak, stuns channeling units for 1 turn. |

### Shield Mechanics

- Shield is a separate HP pool that absorbs ATTACK damage before HP.
- **Gaining Shield:**
  - Shielding card: Level 1 = 2 Shield, Level 2 = 5 Shield, Level 3 = 5 Shield (stacking).
  - At Levels 1 and 2, Shield is set to the higher of current Shield or new Shield (does not stack).
  - At Level 3, Shield stacks additively.
- **Knight status:** Doubles any Shield gained.
- **Salvo status:** Prevents all Shield gain entirely.
- **Shield removal:** EMP removes all Shield, dealing the removed amount as HP damage.

### Core Magnet Interception

- Only active on Tank Drones with `coreMagnetTurnsLeft > 0`.
- **Standard Core Magnet:** Covers a 3x3 area centered on the Tank Drone. The shot path (Bresenham line from attacker to target) is checked against covered squares. If any covered square is on the path, the shot is **redirected** to the Tank Drone.
- **Bulwark Core Magnet:** The Tank Drone selects one adjacent (cardinal) square as center. Coverage becomes that center square plus the two squares perpendicular to the Tank-to-center direction (a 3-square frontal wall). Shots hitting this wall are **blocked entirely** (no damage to anyone).
- **Breaking Core Magnet:** If the Tank Drone is EMP'd, the channel breaks and cooldown restarts at 3. If broken by other means, cooldown extends by 2. With Beacon, cooldown always resets to 0.

### Bulwark Mode

- Bulwark is a status granted to Tank Drones by the Armory.
- When a Bulwark Tank Drone activates Core Magnet, it must choose one of 4 adjacent (cardinal) squares as the shield center.
- The shield wall covers 3 squares: the chosen center + the two squares to its sides (perpendicular to the facing direction).
- Any shot intersecting these 3 squares is completely blocked (100% frontal resistance).

### Virus Debuff

- Applied by Specialist with Virus status on normal attack hit.
- Penalty amount = Specialist's current ATK at time of attack.
- The debuff is "pending" for 1 turn, then "active" for 1 turn on the target's next turn.
- While active, the target's ATK is reduced by the penalty amount (minimum 0).

### EMP Mechanics

- Costs 5 Energy.
- Targets a 2x2 area.
- Effects on all units in the area:
  - Removes all Shield. Removed Shield amount is dealt as HP damage (after Shell Guard check).
  - Removes Shimmering Cloak from the unit's square.
  - If the target has an active channeling ability (Core Magnet or Artillery Set Up), the channel is broken and the unit is **stunned for 1 turn** ("Dazzled" -- cannot move or attack).
- EMP base cooldown: 2 turns (+ 3 with Sniper perk).
- With Salvo: Can be used twice per turn. Cooldown starts after second use (or deferred to end of turn if only used once).

---

## 9. Status Effects (Perks)

### Armory Perks (Tank Drone)

| Status | Effect |
|--------|--------|
| **Tough** | +3 max HP |
| **Grounded** | Receive -1 DMG per attack while Planted (Core Magnet active) |
| **Bulwark** | Core Magnet offers 100% frontal resistance at 3 squares (choose direction on activation) |
| **Beacon** | No cooldown for Core Magnet. Can toggle on/off freely. Lasts 1 turn per activation. Heal once per turn. |
| **Atakk** | +2 MOV when at full HP |
| **Face-Eater** | +4 ATK. Tank Drone attacks have a 2-turn cooldown |

---

### Replicator Perks (Pawn Drone)

| Status | Effect |
|--------|--------|
| **True P** | Explode for 5 DMG on death. Radius: 6 squares. Hits adjacent drones and enemy base (not own base). |
| **Jolting** | Tactical Dash cooldown reduced to 1 turn (from 3) |
| **Shotguns?** | +2 ATK, -1 Range |
| **Energize** | Deal 1 System DMG per attack as a bonus. Any ATK bonuses above base are converted to additional System DMG. |
| **Knight** | Double any Shield gained |
| **Steady** | +1 Range if the unit did not move this turn |

---

### Workshop Perks (Support Drone)

| Status | Effect |
|--------|--------|
| **Operator** | +2 Range, -2 Movement |
| **Spd** | +1 MOV |
| **Mecha** | +2 HP on any Repair for both target and caster |
| **Provider** | +3 flat Supply per supply gain event |
| **Engineer** | Repair permanently increases target's ATK by 1 |
| **Smart** | No Energy cost for Repair (reduced from 5 to 0) |

---

### Datacenter Perks (Specialist)

| Status | Effect |
|--------|--------|
| **Sniper** | +6 ATK, but EMP cooldown is +3 turns (total 5 turns) |
| **Scholar** | Copies the Repair ability from Support Drone, including all Workshop upgrade perks (Mecha, Engineer, Smart) |
| **Salvo** | Can use EMP twice per turn, but cannot gain Shield |
| **Virus** | On hit, reduces target's ATK for its next turn by the Specialist's current ATK |

---

### Gear Station Perks (Ghostblade)

| Status | Effect |
|--------|--------|
| **Rage** | Can attack after moving if not at full health |
| **Shell** | Resist 75% of incoming ATTACK damage on the first hit each turn. Reactivates at start of each turn. Consumed when hit (even by System damage, though System damage is not reduced). |
| **Tango** | Reactively attacks the first enemy drone to move into range. Arms at end of owner's turn; triggers once per turn cycle. |

---

### Assembly Line Perks (Artillery)

| Status | Effect |
|--------|--------|
| **Gauss** | Fire a straight-line beam up to 5 squares in any cardinal or diagonal direction. Hits all units and base frontal squares along the line. |
| **Drones** | Increase Artillery range by 1 (Gauss beam extends to 6 squares), but -2 ATK |
| **Ballistic** | Single-target attack mode. Deals 16 DMG to base (must target front squares at 1 square range) or 10 DMG to a drone, plus any bonus ATK above base. Bypasses AoE targeting. |

---

## 10. Special Mechanics

### Shimmering Cloak
- Cast via the Shimmering Cloak card (5 Energy).
- Targets specific board squares. Units on cloaked squares become **untargetable** by the opposing player.
- **Duration:** 1 turn at Level 1; 2 turns at Level 2 and 3.
- **Tick-down:** Cloaks tick down by 1 at the **start** of the owning player's turn. If `turnsLeft` reaches 0, the cloak is removed.
- **Cleared by:** EMP removes Shimmering Cloak from the targeted square.
- A single EMP removes the cloak from one square only; remaining squares of the same cloak persist.

### Gauss Beam
- Requires the Gauss perk on Artillery.
- Fires a straight line in any of 8 directions (4 cardinal + 4 diagonal).
- Beam length: **5 squares** (or **6 squares** with Drones perk).
- Damages all enemy units along the beam for the Artillery's current ATK each.
- Also damages any base if the beam passes through that base's artillery-vulnerable front squares.
- Skips Core Magnet interception (applied per-unit with `skipCoreMagnetRedirect: true`).

### Ballistic
- Requires the Ballistic perk on Artillery.
- Single-target attack mode (replaces normal 2x2 AoE targeting).
- **Against drones:** Deals base 10 DMG + any ATK bonus above base ATK.
- **Against base:** Deals base 16 DMG + any ATK bonus above base ATK. Can only target the base's front (artillery-vulnerable) squares.
- Skips Core Magnet interception.

### Tango
- Ghostblade-specific reactive attack perk.
- **Arms at end of the Ghostblade's owner's turn.**
- When an enemy drone moves into the Ghostblade's attack range, the Ghostblade performs an automatic attack against the moving unit.
- Triggers only once per turn cycle (consumed on first trigger).
- Closest eligible reactor is selected if multiple Tango Ghostblades could react.

### Shell Guard
- Ghostblade-specific defensive perk.
- **Reactivates at the start of each of the Ghostblade's owner's turns.**
- On the first hit received during a turn (any damage type):
  - If the incoming damage is ATTACK type: reduces damage by **75%** (remaining damage is ceil of 25%).
  - If the incoming damage is SYSTEM type: Shell Guard is consumed but damage is **not reduced**.
- Only triggers once per turn -- subsequent hits in the same turn deal full damage.

### System Shock
- Played as a card (5 Energy from hand) or from Process Echo (level = slot number).
- **Level 1:** Deals 5 System damage. The first friendly drone to have attacked the target gets a follow-up action (one extra move or one extra attack).
- **Level 2:** Deals 8 System damage + follow-up action.
- **Level 3:** Deals 8 System damage + follow-up action. If the target is killed, the casting player regains 10 Energy.
- System damage bypasses Shield and Core Magnet but does not damage bases.
- Shell Guard is consumed but does not reduce System damage.

### Harvest Data
- Costs 5 Energy from hand.
- Select a Drone card from your hand to absorb.
- The absorbed card is removed from hand and the player gains Supply equal to its Energy cost.
- Only Drone-category cards can be absorbed.

### Overload (Gear Station)
- Costs 5 Energy.
- Once per turn per Gear Station.
- Select a friendly drone that has not finished both moving and attacking, is not stunned, and is not Planted (unless Beacon).
- The target gains bonus movement equal to its **base move range** (move range without the overload bonus).

### Obtain (Datacenter)
- Costs 5 Energy.
- Once per turn per Datacenter.
- Gains 5 Supply (or 8 Supply if a Workshop building is side-adjacent to the Datacenter).

### Draw (Assembly Line)
- Costs 2 Energy.
- Draws 1 card from deck (shuffles discard into deck if needed).

### Foundation
- Costs 20 Supply.
- Destroys one of your own buildings.
- Refunds 50% of the destroyed building's original Supply cost.
- Increases your base's max HP by 5 and current HP by 5.
- Recalculates adjacency bonuses and max Energy after destruction.

---

## 11. Win Conditions

- Each player's base starts with **50 HP** (can be increased by Foundation -- +5 max HP and +5 current HP per use).
- **Victory:** Reduce the opponent's base HP to 0.
- When a base is destroyed:
  - All base meshes are removed from the board.
  - All buildings owned by that player are destroyed.
  - Adjacency bonuses and max Energy are recalculated.
  - The destroying player is declared the **winner** (`state.winner` is set).
  - The game stops processing further turns.

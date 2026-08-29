/**
 * All gameplay tuning lives here so the feel can be iterated without touching systems.
 * Units: metres, seconds, radians (unless a name says otherwise).
 */
export const CFG = {
  match: {
    teamSize: 5,          // 5v5 — player occupies one BLUE slot
    scoreLimit: 20,
    timeLimit: 12 * 60,   // long enough that the kill limit usually decides it
    respawnDelay: 5,
    arenaRadius: 9000,    // soft border; outside it you take damage
    outOfBoundsGrace: 8,
    outOfBoundsDps: 12,
  },

  flight: {
    speedMin: 95,
    speedCruise: 210,
    speedMax: 320,
    speedBurner: 430,
    accel: 0.55,          // how fast speed chases the throttle target (per second, exponential)
    brake: 0.9,
    // Throttle is not a player axis: it sits at cruise, drops on the brake, and
    // goes to full only while the afterburner is lit.
    cruiseThrottle: 0.85,
    brakeThrottle: 0.12,
    throttleResponse: 2.6,  // exponential rate the engine follows the commanded setting
    burnerBurn: 0.25,       // fuel per second lit -> about 4 s of burner
    burnerRegen: 0.18,      // refills empty-to-full in ~5.5 s once released
    gravityPull: 11,      // extra m/s^2 gained when pointing straight down
    pitchRate: 1.30,      // rad/s at full authority
    rollRate: 3.05,
    yawRate: 0.42,
    inputSmoothing: 9,    // how quickly control surfaces follow the stick
    stallSpeed: 120,      // below this, control authority falls off hard
    ceiling: 5200,
  },

  /** Flight-assist model: bank-to-turn with auto-levelling (the default feel). */
  assist: {
    maxBank: 78 * Math.PI / 180,  // bank held at full roll input
    bankGain: 2.6,                // how hard the aircraft chases the commanded bank
    maxTurn: 1.05,                // rad/s of heading change at 90 deg of bank
    levelGain: 1.9,               // nose-to-horizon recovery when pitch is released
    levelStrength: 0.85,          // how much of the pitch authority auto-levelling may use
    pitchDeadzone: 0.06,          // stick travel below this counts as "hands off"
  },

  hull: {
    hp: 100,
    radius: 8,            // collision sphere
    crashClearance: 6,    // metres above terrain that still counts as a crash
  },

  gun: {
    rpm: 1400,
    damage: 5.5,
    speed: 1150,
    spread: 0.0045,       // radians
    range: 1600,
    // no ammo count — the barrels cooking off is the only thing that stops you firing
    heatPerShot: 0.024,   // ~9 s of continuous fire before the barrels cook
    heatCool: 0.45,       // per second
    heatResume: 0.35,     // must cool below this before firing again
    hitRadius: 9,
  },

  missile: {
    count: 6,
    reload: 6.0,
    damage: 55,
    speed: 300,
    maxSpeed: 780,
    accel: 320,
    turnRate: 2.5,        // rad/s seeker authority
    life: 12,
    proximity: 16,
    lockAngle: 22 * Math.PI / 180,
    lockRange: 4500,
    lockTime: 1.5,
    blastRadius: 45,
  },

  /** Scoreboard points. Damage also scores, so support work is visible. */
  scoring: {
    kill: 250,
    assist: 100,
    perDamage: 2,
    assistWindow: 8,      // seconds a hit still counts towards an assist
  },

  flare: {
    count: 32,            // carried per sortie
    salvo: 4,             // dispensed per press
    cooldown: 0.75,
    life: 4.5,
    fallSpeed: 26,
    /** chance a given missile is spoofed by a salvo it can see */
    decoyChance: 0.5,
    decoyRange: 1400,     // the missile has to be close enough to bite
    decoyCone: 55 * Math.PI / 180,
  },

  /** Neutral rearm zones both teams share — flying through tops you back up. */
  resupply: {
    count: 4,
    ringRadius: 200,      // the visible marker
    radius: 280,          // the volume that actually resupplies
    altitude: 950,
    orbitRadius: 5200,    // how far from the arena centre they sit
    missileInterval: 1.1, // seconds per missile restored
    flareInterval: 0.9,   // seconds per flare salvo restored
    hullPerSec: 14,
    burnerPerSec: 0.55,
    heatCoolBonus: 0.7,
  },

  audio: {
    masterVolume: 0.7,
    /** world sounds fade to nothing beyond this */
    falloff: 2600,
    /** cannon rounds fire far too fast to give every one its own sound */
    gunSoundInterval: 0.07,
  },

  ai: {
    reactionSpread: 0.35,   // per-pilot random skill spread
    gunRange: 1100,
    gunCone: 9 * Math.PI / 180,
    missileCone: 14 * Math.PI / 180,
    engageRange: 3200,
    breakRange: 260,
    minAltitude: 320,
    maxAltitude: 4200,
    preferredAltitude: 1700,   // fights gravitate here rather than to the ceiling
    evadeTime: 3.0,
    resupplyHp: 45,       // break off for a rearm zone below this
    resupplyRange: 6000,  // ...but only if one is reachable
    flareReaction: 0.45,  // seconds after a launch warning before AI pops flares
  },

  camera: {
    fov: 62,
    fovBurner: 74,
    near: 1,
    far: 45000,
    chaseBack: 26,
    chaseUp: 7.5,
    stiffness: 6.5,
    lookAhead: 90,
  },

  world: {
    size: 24000,
    segments: 220,
    fogNear: 3000,
    fogFar: 22000,
  },
} as const;

export const GAME_NAME = 'HAF FIGHTERS';

/** The one airframe everyone flies, shown in the scoreboard's aircraft column. */
export const AIRFRAME = 'FA-9';

export const MAP_NAME = 'CORAL RANGE — DAWN';
export const MODE_NAME = 'TEAM DEATHMATCH';

export type TeamId = 'BLUE' | 'RED';

export const TEAM = {
  BLUE: { id: 'BLUE' as TeamId, color: 0x4aa8ff, css: '#5ab6ff', spawn: { x: -2700, z: 2200, heading: -0.68 } },
  RED: { id: 'RED' as TeamId, color: 0xff5c4a, css: '#ff7a66', spawn: { x: 2700, z: -2200, heading: Math.PI - 0.68 } },
} as const;

export const other = (t: TeamId): TeamId => (t === 'BLUE' ? 'RED' : 'BLUE');

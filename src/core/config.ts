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
    /** the gunsight stops solving past this — beyond it the shot is fantasy */
    pipperRange: 1500,
    /** predicted miss under this many metres lights the pipper as a firing cue */
    pipperHotMiss: 14,
    heatPerShot: 0.024,   // ~9 s of continuous fire before the barrels cook
    heatCool: 0.45,       // per second
    heatResume: 0.35,     // must cool below this before firing again
    hitRadius: 9,
  },

  /** Shared missile behaviour; the per-type numbers live in WEAPONS below. */
  missile: {
    blastFalloffFloor: 0.25,
    /** HUD pip strip width, so labels can sit clear of it */
    pipWidth: 84,
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

  /**
   * Neutral rearm rings both teams share. Fly through the hoop for an instant full
   * restock; the ring then goes cold for a few seconds, so two jets cannot milk the
   * same ring back to back and a contested ring is worth timing.
   */
  resupply: {
    count: 4,
    ringRadius: 170,      // the hoop you actually have to fly through
    tube: 7,
    altitude: 950,
    orbitRadius: 5200,    // how far from the arena centre they sit
    cooldown: 5,
  },

  audio: {
    masterVolume: 0.7,
    /** world sounds fade to nothing beyond this */
    falloff: 2600,
    /** cannon rounds fire far too fast to give every one its own sound */
    gunSoundInterval: 0.07,
  },

  ai: {
    gunRange: 1100,
    /** outer sanity bound; the real gate is the miss distance below */
    gunCone: 15 * Math.PI / 180,
    /**
     * How far off the solution may be *at the target*, in metres, for the AI to
     * pull the trigger. Gating on an angle cannot work for gunnery: 9 degrees is
     * a 125 m miss at 800 m against a 9 m target, so a cone loose enough to fire
     * through is far too loose to hit through. Distance makes the gate tighten
     * automatically with range.
     */
    gunMissTolerance: 45,
    missileCone: 14 * Math.PI / 180,
    radarMissileCone: 26 * Math.PI / 180,
    radarMinRange: 1800,   // beyond this the AI reaches for the radar missile
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
  },
} as const;

export const GAME_NAME = 'HAF FIGHTERS';

/** The one airframe everyone flies, shown in the scoreboard's aircraft column. */
export const AIRFRAME = 'FA-9';

export const MODE_NAME = 'TEAM DEATHMATCH';

export type TeamId = 'BLUE' | 'RED';

export const TEAM = {
  BLUE: { id: 'BLUE' as TeamId, color: 0x4aa8ff, css: '#5ab6ff', spawn: { x: -2700, z: 2200, heading: -0.68 } },
  RED: { id: 'RED' as TeamId, color: 0xff5c4a, css: '#ff7a66', spawn: { x: 2700, z: -2200, heading: Math.PI - 0.68 } },
} as const;

export type DifficultyId = 'ROOKIE' | 'REGULAR' | 'ACE';

export interface DifficultySpec {
  id: DifficultyId;
  label: string;
  blurb: string;
  /** pilot skill spread — trigger discipline and reaction timing */
  skillBase: number;
  skillStep: number;
  skillJitter: number;
  skillMin: number;
  skillMax: number;
  /**
   * How strongly bandits prefer the player as a target, in target-score metres.
   *
   * Difficulty is built from levers that make bandits dangerous *to the player*
   * rather than from pilot "skill". Skill turned out to trade offence for defence —
   * evading, flaring and breaking off all take a pilot out of the attack — and with
   * a five second respawn the scoring rewards aggression, so more skilful bandits
   * measurably scored *worse*. These three levers are purely offensive and measured
   * monotonic against the player.
   */
  playerBias: number;
  /** multiplier on missile lock time — lower locks quicker */
  lockScale: number;
  /** multiplier on missile reload */
  reloadScale: number;
  /** multiplier on how long they take to reach for the flare button */
  flareReaction: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultySpec> = {
  ROOKIE: {
    id: 'ROOKIE', label: 'ROOKIE', blurb: 'Slow to lock, and rarely singles you out',
    skillBase: 0.12, skillStep: 0.07, skillJitter: 0.08, skillMin: 0.05, skillMax: 0.45,
    playerBias: 0, lockScale: 1.6, reloadScale: 1.6, flareReaction: 2.1,
  },
  REGULAR: {
    id: 'REGULAR', label: 'REGULAR', blurb: 'A fair fight — what everything was balanced against',
    skillBase: 0.34, skillStep: 0.09, skillJitter: 0.10, skillMin: 0.20, skillMax: 0.85,
    playerBias: 350, lockScale: 1, reloadScale: 1, flareReaction: 1,
  },
  ACE: {
    id: 'ACE', label: 'ACE', blurb: 'Locks fast, reloads fast, and comes looking for you',
    skillBase: 0.60, skillStep: 0.09, skillJitter: 0.08, skillMin: 0.50, skillMax: 1,
    playerBias: 1100, lockScale: 0.62, reloadScale: 0.6, flareReaction: 0.55,
  },
};

export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['ROOKIE', 'REGULAR', 'ACE'];

export type WeaponId = 'IR' | 'RADAR';

export interface WeaponSpec {
  id: WeaponId;
  label: string;
  /** short tag for the HUD */
  tag: string;
  count: number;
  reload: number;
  damage: number;
  speed: number;
  maxSpeed: number;
  accel: number;
  /** seeker authority, rad/s — this is what decides whether it can follow a hard turn */
  turnRate: number;
  life: number;
  proximity: number;
  blastRadius: number;
  lockAngle: number;
  lockRange: number;
  lockTime: number;
  /** whether flares can spoof it — flares are an infrared countermeasure */
  flareVulnerable: boolean;
  /**
   * Whether launching breaks the lock. When it does, the rate of fire is set by how
   * fast you can re-acquire rather than by a long reload, which rewards keeping the
   * target on the nose instead of waiting out a timer.
   */
  dropsLockOnFire: boolean;
}

/**
 * Two missiles with an honest trade rather than one strictly better than the other:
 * the heat-seeker is agile and quick to lock but flares beat it, while the radar
 * missile reaches much further, locks over a wide cone and ignores flares — but its
 * seeker is sluggish, so a hard break turn inside its turn radius defeats it.
 */
export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  IR: {
    id: 'IR', label: 'AIM-9 HEAT', tag: 'IR',
    // short reload: re-acquiring the lock is what actually paces these
    count: 6, reload: 0.7,
    damage: 55, speed: 300, maxSpeed: 780, accel: 320, turnRate: 2.5,
    life: 12, proximity: 16, blastRadius: 45,
    lockAngle: 22 * Math.PI / 180, lockRange: 4500, lockTime: 1.5,
    flareVulnerable: true, dropsLockOnFire: true,
  },
  RADAR: {
    id: 'RADAR', label: 'AIM-120 RADAR', tag: 'RDR',
    count: 4, reload: 8.5,
    damage: 62, speed: 340, maxSpeed: 1020, accel: 430, turnRate: 1.35,
    life: 17, proximity: 20, blastRadius: 55,
    lockAngle: 38 * Math.PI / 180, lockRange: 9000, lockTime: 2.6,
    // the radar round goes active on its own, so the launcher keeps its lock
    flareVulnerable: false, dropsLockOnFire: false,
  },
};

export const WEAPON_ORDER: readonly WeaponId[] = ['IR', 'RADAR'];

export const other = (t: TeamId): TeamId => (t === 'BLUE' ? 'RED' : 'BLUE');

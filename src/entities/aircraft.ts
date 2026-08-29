import * as THREE from 'three';
import { CFG, TeamId, TEAM, WeaponId, WeaponSpec, WEAPONS, WEAPON_ORDER } from '../core/config';
import { clamp, clamp01, damp, lerp, rand } from '../core/mathx';
import { buildJet, JetVisual } from './jetMesh';

export interface Controls {
  pitch: number;    // +1 nose up
  roll: number;     // +1 roll right
  yaw: number;      // +1 yaw right
  throttle: number; // 0..1 power setting
  /** request the afterburner — granted only while there is fuel left */
  burner: boolean;
  gun: boolean;
  missile: boolean;
  flares: boolean;
  chaff: boolean;
}

export type SystemId = 'engine' | 'controls' | 'fuel';

export const newControls = (): Controls => ({
  pitch: 0, roll: 0, yaw: 0, throttle: 0.7, burner: false,
  gun: false, missile: false, flares: false, chaff: false,
});

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _omega = new THREE.Vector3();
const _hit = new THREE.Vector3();

export class Aircraft {
  readonly team: TeamId;
  name: string;
  readonly isPlayer: boolean;
  readonly visual: JetVisual;
  readonly object: THREE.Group;

  pos = new THREE.Vector3();
  quat = new THREE.Quaternion();
  speed: number = CFG.flight.speedCruise;

  controls: Controls = newControls();
  /** smoothed control-surface positions — what the flight model actually uses */
  surf = { pitch: 0, roll: 0, yaw: 0 };
  /**
   * Flight assist: roll input commands a bank *angle*, banking generates a
   * coordinated turn, and releasing the stick returns the jet to level flight.
   * Off, roll/pitch are direct rate commands. AI pilots fly without it.
   */
  assist = false;
  /** body angular rates actually applied last frame — used for G and drag */
  rates = { p: 0, q: 0, r: 0 };

  hp: number = CFG.hull.hp;
  /** 1 = intact, 0 = destroyed. Degrades alongside hull, never instead of it. */
  systems: Record<SystemId, number> = { engine: 1, controls: 1, fuel: 1 };
  alive = true;
  respawnTimer = 0;

  gunCooldown = 0;
  gunHeat = 0;
  /** true once the cannon has cooked off; blocks fire until heat drops below heatResume */
  gunOverheated = false;

  /** rounds remaining per missile type */
  ammo: Record<WeaponId, number> = { IR: WEAPONS.IR.count, RADAR: WEAPONS.RADAR.count };
  weapon: WeaponId = 'IR';
  missileCooldown = 0;

  flares: number = CFG.flare.count;
  flareCooldown = 0;
  chaff: number = CFG.chaff.count;
  chaffCooldown = 0;

  /** 0..1 afterburner fuel; drains while lit, refills once the request is released */
  burnerFuel = 1;
  /** whether the burner is actually lit this frame */
  burnerActive = false;

  /** current soft target and lock progress (player + AI share this pipeline) */
  lockTarget: Aircraft | null = null;
  lockProgress = 0;
  locked = false;

  /** difficulty scalars, set by the AI pilot; the player always flies at 1 */
  lockScale = 1;
  reloadScale = 1;

  /** raised by the missile system while a live missile is tracking this aircraft */
  threat = 0;
  threatRange = Infinity;
  /** what kind of seeker is chasing you, so you can pick the right countermeasure */
  threatKind: WeaponId | null = null;

  kills = 0;
  deaths = 0;
  assists = 0;
  score = 0;
  damageDealt = 0;
  /** who has damaged this aircraft recently, for assist credit */
  damagedBy = new Map<Aircraft, number>();
  lastHitBy: Aircraft | null = null;
  lastHitAt = 0;
  oobTimer = 0;
  gforce = 1;

  private _fwd = new THREE.Vector3();
  private _right = new THREE.Vector3();
  private _up = new THREE.Vector3();
  private burnerFlicker = 0;

  constructor(team: TeamId, name: string, isPlayer = false) {
    this.team = team;
    this.name = name;
    this.isPlayer = isPlayer;
    this.visual = buildJet(TEAM[team].color);
    this.object = this.visual.group;
  }

  forward(out = this._fwd): THREE.Vector3 { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  right(out = this._right): THREE.Vector3 { return out.set(1, 0, 0).applyQuaternion(this.quat); }
  up(out = this._up): THREE.Vector3 { return out.set(0, 1, 0).applyQuaternion(this.quat); }

  velocity(out: THREE.Vector3): THREE.Vector3 { return this.forward(out).multiplyScalar(this.speed); }

  /**
   * Where this aircraft will be in `t` seconds, assuming it holds its current turn.
   *
   * A straight-line extrapolation is not good enough for gunnery: a jet turning at
   * 1 rad/s departs its straight-line prediction by roughly 45 m over a half-second
   * of bullet flight, and the hit radius is 9 m. Rotating the velocity through half
   * the arc approximates the chord of the turn and lands far closer.
   */
  predictPosition(t: number, out: THREE.Vector3): THREE.Vector3 {
    // body rates -> world angular velocity, matching how update() applies them:
    // +X pitches up, -Z rolls right, -Y yaws right
    _omega.set(this.rates.q, -this.rates.r, -this.rates.p).applyQuaternion(this.quat);
    out.copy(this.forward()).multiplyScalar(this.speed);
    const arc = _omega.length() * t * 0.5;
    if (arc > 1e-4) out.applyAxisAngle(_omega.normalize(), arc);
    return out.multiplyScalar(t).add(this.pos);
  }

  /**
   * Signed bank angle over the full -pi..pi range (+ = right wing down).
   * atan2 rather than asin so inverted attitudes are distinguishable and
   * auto-levelling rolls out the short way instead of getting stuck at 90 deg.
   */
  get bank(): number { return Math.atan2(-this.right().y, this.up().y); }

  /** flight-path angle: + climbing, - descending */
  get pitchAngle(): number { return Math.asin(clamp(this.forward().y, -1, 1)); }

  get burner(): boolean { return this.burnerActive; }

  /** condition of the worst-damaged system, for smoke and HUD emphasis */
  get worstSystem(): number {
    return Math.min(this.systems.engine, this.systems.controls, this.systems.fuel);
  }

  /** the selected missile's numbers — lock cone, range, reload and so on */
  get weaponSpec(): WeaponSpec { return WEAPONS[this.weapon]; }
  get missiles(): number { return this.ammo[this.weapon]; }

  /** Cycle to the next type that still has rounds; falls back to the next in order. */
  cycleWeapon(): WeaponId {
    const i = WEAPON_ORDER.indexOf(this.weapon);
    for (let n = 1; n <= WEAPON_ORDER.length; n++) {
      const next = WEAPON_ORDER[(i + n) % WEAPON_ORDER.length];
      if (this.ammo[next] > 0) { this.setWeapon(next); return next; }
    }
    this.setWeapon(WEAPON_ORDER[(i + 1) % WEAPON_ORDER.length]);
    return this.weapon;
  }

  /** Drop the current lock — used after a launch that breaks it. */
  breakLock() {
    this.lockProgress = 0;
    this.locked = false;
  }

  setWeapon(w: WeaponId) {
    if (this.weapon === w) return;
    this.weapon = w;
    // the seekers have different cones and dwell times, so a swap restarts the lock
    this.lockTarget = null;
    this.lockProgress = 0;
    this.locked = false;
  }

  /** Control effectiveness falls off when slow (mushy), very fast (stiff) or shot up. */
  private authority(): number {
    const s = this.speed;
    const low = clamp01((s - CFG.flight.speedMin * 0.6) / (CFG.flight.stallSpeed - CFG.flight.speedMin * 0.6));
    const high = 1 - 0.3 * clamp01((s - CFG.flight.speedMax) / (CFG.flight.speedBurner - CFG.flight.speedMax));
    const S = CFG.systems;
    const damaged = S.minAuthority + (1 - S.minAuthority) * this.systems.controls;
    return clamp(0.25 + 0.75 * low, 0.25, 1) * high * damaged;
  }

  /** Thrust available, cut by engine damage. */
  private thrustFactor(): number {
    const S = CFG.systems;
    return S.minThrust + (1 - S.minThrust) * this.systems.engine;
  }

  /** Which system a hit at this world point damages, or null for structure only. */
  private systemAt(at: THREE.Vector3 | undefined): SystemId | null {
    if (Math.random() < CFG.systems.missChance) return null;
    if (!at) return (['engine', 'controls', 'fuel'] as const)[Math.floor(Math.random() * 3)];
    // into the airframe's own frame: -z is the nose, +z the tail, x the span
    _hit.copy(at).sub(this.pos).applyQuaternion(_q.copy(this.quat).invert());
    if (_hit.z > 1.5) return 'engine';               // aft third
    if (Math.abs(_hit.x) > 3.2) return 'controls';   // out on the surfaces
    if (_hit.z > -3.5) return 'fuel';                // mid fuselage tankage
    return null;                                     // nose: structure only
  }

  private targetSpeed(): number {
    const F = CFG.flight;
    const base = this.burnerActive
      ? F.speedBurner
      : lerp(F.speedMin, F.speedMax, clamp01(this.controls.throttle));
    // a wrecked engine cannot hold the speed the throttle is asking for
    return F.speedMin * 0.7 + (base - F.speedMin * 0.7) * this.thrustFactor();
  }

  /**
   * Afterburner fuel. Holding the burner drains it and gives nothing once empty;
   * releasing it starts the refill. Deliberately no refill while the request is
   * held, otherwise an empty burner relights for a fraction of a second at a time
   * and stutters.
   */
  private updateBurner(dt: number) {
    const F = CFG.flight;
    // a badly damaged engine cannot light the burner at all
    const wants = this.controls.burner && this.alive && this.systems.engine > 0.35;
    this.burnerActive = wants && this.burnerFuel > 0;

    // a punctured tank bleeds reserve whether or not the burner is lit
    const leak = (1 - this.systems.fuel) * CFG.systems.fuelLeakRate;
    if (leak > 0) this.burnerFuel = Math.max(0, this.burnerFuel - leak * dt);

    if (this.burnerActive) {
      this.burnerFuel = Math.max(0, this.burnerFuel - F.burnerBurn * dt);
      if (this.burnerFuel <= 0) this.burnerActive = false;
    } else if (!wants) {
      this.burnerFuel = clamp01(this.burnerFuel + F.burnerRegen * dt);
    }
  }

  update(dt: number) {
    const F = CFG.flight;

    if (!this.alive) {
      this.respawnTimer -= dt;
      this.burnerActive = false;
      this.burnerFuel = clamp01(this.burnerFuel + CFG.flight.burnerRegen * dt);
      return;
    }

    this.updateBurner(dt);

    // stick smoothing
    const c = this.controls;
    this.surf.pitch = damp(this.surf.pitch, clamp(c.pitch, -1, 1), F.inputSmoothing, dt);
    this.surf.roll = damp(this.surf.roll, clamp(c.roll, -1, 1), F.inputSmoothing, dt);
    this.surf.yaw = damp(this.surf.yaw, clamp(c.yaw, -1, 1), F.inputSmoothing * 0.6, dt);

    const auth = this.authority();
    const { p, q, r } = this.assist ? this.assistRates(auth) : this.directRates(auth);
    this.rates.p = p; this.rates.q = q; this.rates.r = r;

    // attitude — body-axis rotations. +X pitches up, -Z rolls right, -Y yaws right.
    _q.setFromAxisAngle(AX, q * dt);
    this.quat.multiply(_q);
    _q.setFromAxisAngle(AZ, -p * dt);
    this.quat.multiply(_q);
    _q.setFromAxisAngle(AY, -r * dt);
    this.quat.multiply(_q);
    this.quat.normalize();

    const fwd = this.forward();

    // speed: chase the throttle setting, then add gravity along the flight path
    const target = this.targetSpeed();
    const k = target > this.speed ? F.accel : F.brake;
    this.speed = damp(this.speed, target, k, dt);
    this.speed -= F.gravityPull * fwd.y * dt;
    // induced drag from hard manoeuvring, measured off the actual pull
    const pull = Math.abs(this.rates.q) / F.pitchRate;
    this.speed -= (pull * 26 + Math.abs(this.surf.roll) * 5) * dt;
    this.speed = clamp(this.speed, F.speedMin * 0.55, F.speedBurner * 1.2);

    this.pos.addScaledVector(fwd, this.speed * dt);

    // soft ceiling
    if (this.pos.y > F.ceiling) {
      this.pos.y = F.ceiling;
      this.speed -= 20 * dt;
    }

    // Turn rates here are arcade, not aerodynamic — deriving G physically from them
    // reads as ~30 g. Show it as a load gauge instead: 1 g relaxed, ~9 g at the limit.
    this.gforce = 1 + 8 * clamp01(Math.hypot(this.rates.q, this.rates.r) / F.pitchRate);

    // cooldowns
    this.gunCooldown -= dt;
    this.missileCooldown -= dt;
    this.flareCooldown -= dt;
    this.chaffCooldown -= dt;
    this.gunHeat = Math.max(0, this.gunHeat - CFG.gun.heatCool * dt);
    if (this.gunOverheated && this.gunHeat <= CFG.gun.heatResume) this.gunOverheated = false;
    this.threat = Math.max(0, this.threat - dt);

    this.syncVisual(dt);
  }

  /** Raw rate control: stick position maps straight onto body angular rates. */
  private directRates(auth: number) {
    const F = CFG.flight;
    return {
      p: this.surf.roll * F.rollRate * auth,
      q: this.surf.pitch * F.pitchRate * auth,
      r: this.surf.yaw * F.yawRate * auth,
    };
  }

  /**
   * Bank-to-turn with auto-levelling.
   *
   * Roll input commands a bank angle rather than a roll rate, so releasing it
   * rolls back to wings-level on its own. Bank then drives a turn about the
   * vertical, decomposed into the body pitch/yaw rates a coordinated turn needs
   * (q = w sin(bank), r = w cos(bank)) — which is what keeps the nose tracking
   * round the horizon instead of the jet knife-edging and falling out of the sky.
   */
  private assistRates(auth: number) {
    const F = CFG.flight;
    const A = CFG.assist;
    const bank = this.bank;

    // roll: proportional attitude hold, which auto-levels at zero input
    const targetBank = this.surf.roll * A.maxBank;
    const rollCmd = clamp((targetBank - bank) * A.bankGain, -1, 1);
    const p = rollCmd * F.rollRate * auth;

    // the turn fades out when pointing near-vertical, where "bank" is meaningless
    const vertical = 1 - clamp01((Math.abs(this.forward().y) - 0.9) / 0.09);
    const omega = A.maxTurn * Math.sin(bank) * auth * vertical;

    let q = omega * Math.sin(bank) + this.surf.pitch * F.pitchRate * auth;
    let r = omega * Math.cos(bank);

    // hands off the pitch axis: bring the nose back to the horizon
    if (Math.abs(this.surf.pitch) < A.pitchDeadzone) {
      const correction = clamp(-this.pitchAngle * A.levelGain, -1, 1);
      q += correction * F.pitchRate * auth * A.levelStrength * vertical;
    }

    // cap total turn authority at the manual limit so assist is never an advantage
    const cap = F.pitchRate * auth;
    const mag = Math.hypot(q, r);
    if (mag > cap) { const k = cap / mag; q *= k; r *= k; }

    return { p, q, r: r + this.surf.yaw * F.yawRate * auth };
  }

  private syncVisual(dt: number) {
    this.object.position.copy(this.pos);
    this.object.quaternion.copy(this.quat);

    this.burnerFlicker = damp(this.burnerFlicker, rand(0.85, 1.15), 20, dt);
    const t = clamp01((this.controls.throttle - 0.5) / 0.5);
    const len = (0.12 + t * 1.6 + (this.burner ? 1.9 : 0)) * this.burnerFlicker;
    for (const b of this.visual.burners) {
      b.scale.set(0.7 + t * 0.5, 0.7 + t * 0.5, Math.max(0.01, len));
      (b.material as THREE.Material).opacity = 0.25 + 0.6 * t + (this.burner ? 0.2 : 0);
    }
  }

  /** Top everything back up — what flying through a rearm ring gives you. */
  restock() {
    this.hp = CFG.hull.hp;
    this.systems.engine = this.systems.controls = this.systems.fuel = 1;
    this.ammo.IR = WEAPONS.IR.count;
    this.ammo.RADAR = WEAPONS.RADAR.count;
    this.flares = CFG.flare.count;
    this.burnerFuel = 1;
    this.gunHeat = 0;
    this.gunOverheated = false;
  }

  /** @returns true if this hit was lethal */
  damage(amount: number, from: Aircraft | null, now: number, at?: THREE.Vector3): boolean {
    if (!this.alive) return false;
    const applied = Math.min(amount, this.hp);
    this.hp -= amount;

    // systems degrade alongside the hull, never instead of it
    const sys = this.systemAt(at);
    if (sys) {
      this.systems[sys] = clamp01(this.systems[sys] - (applied * CFG.systems.scale) / CFG.hull.hp);
    }
    if (from && from !== this) {
      this.lastHitBy = from;
      this.lastHitAt = now;
      this.damagedBy.set(from, now);
      from.damageDealt += applied;
      from.score += Math.round(applied * CFG.scoring.perDamage);
    }
    if (this.hp <= 0) { this.hp = 0; return true; }
    return false;
  }

  die() {
    this.alive = false;
    this.deaths++;
    this.respawnTimer = CFG.match.respawnDelay;
    this.object.visible = false;
    this.controls.gun = false;
    this.controls.missile = false;
    this.controls.flares = false;
    this.controls.chaff = false;
    this.controls.burner = false;
    this.burnerActive = false;
    this.lockTarget = null;
    this.lockProgress = 0;
    this.locked = false;
  }

  respawn(slot: number) {
    const s = TEAM[this.team].spawn;
    const lane = (slot - 2) * 420;
    this.pos.set(s.x + lane, 1500 + rand(-140, 240), s.z + lane * 0.35);
    this.quat.setFromEuler(new THREE.Euler(0, s.heading, 0, 'YXZ'));
    this.speed = CFG.flight.speedCruise + 40;
    this.hp = CFG.hull.hp;
    this.alive = true;
    this.ammo.IR = WEAPONS.IR.count;
    this.ammo.RADAR = WEAPONS.RADAR.count;
    this.weapon = 'IR';
    this.flares = CFG.flare.count;
    this.flareCooldown = 0;
    this.chaff = CFG.chaff.count;
    this.chaffCooldown = 0;
    this.burnerFuel = 1;
    this.burnerActive = false;
    this.systems.engine = this.systems.controls = this.systems.fuel = 1;
    this.damagedBy.clear();
    this.gunHeat = 0;
    this.gunOverheated = false;
    this.missileCooldown = 1.5;
    this.threat = 0;
    this.lastHitBy = null;
    this.oobTimer = 0;
    this.surf.pitch = this.surf.roll = this.surf.yaw = 0;
    this.rates.p = this.rates.q = this.rates.r = 0;
    this.controls = newControls();
    this.controls.throttle = CFG.flight.cruiseThrottle;
    this.object.visible = true;
    this.syncVisual(0.016);
  }
}

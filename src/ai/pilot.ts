import * as THREE from 'three';
import { CFG, DifficultySpec, DIFFICULTIES, WEAPONS } from '../core/config';
import { Aircraft } from '../entities/aircraft';
import { Terrain } from '../world/terrain';
import { WaypointSystem } from '../world/waypoints';
import { clamp, rand } from '../core/mathx';

type State = 'PURSUE' | 'ATTACK' | 'EVADE' | 'EXTEND' | 'RECOVER' | 'DESCEND' | 'REARM';

const _l = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _to = new THREE.Vector3();
const _lead = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class Pilot {
  readonly jet: Aircraft;
  /** 0 = rookie, 1 = ace — scales trigger discipline, reaction and manoeuvring */
  skill: number;
  private diff: DifficultySpec = DIFFICULTIES.REGULAR;


  target: Aircraft | null = null;
  state: State = 'PURSUE';
  private stateTimer = 0;
  private retargetTimer = 0;
  private evadeSign = 1;
  private flareTimer = 0;
  private jitterPhase = rand(0, 100);
  private trigger = 0;

  constructor(jet: Aircraft, diff: DifficultySpec, slot: number) {
    this.jet = jet;
    this.skill = 0;
    this.configure(diff, slot);
  }

  /**
   * Set the pilot up for a difficulty. Slot spreads skill across the squadron so a
   * team is a mix rather than five identical pilots.
   */
  configure(diff: DifficultySpec, slot: number) {
    this.diff = diff;
    this.skill = clamp(
      diff.skillBase + slot * diff.skillStep + rand(-diff.skillJitter, diff.skillJitter),
      diff.skillMin, diff.skillMax,
    );
    this.jet.lockScale = diff.lockScale;
    this.jet.reloadScale = diff.reloadScale;
    this.reset();
  }

  /** Fresh match, fresh pilot state. */
  reset() {
    this.target = null;
    this.state = 'PURSUE';
    this.stateTimer = 0;
    this.retargetTimer = rand(0, 1.5);
    this.jitterPhase = rand(0, 100);
    this.trigger = 0;
    this.flareTimer = 0;
  }

  update(
    dt: number, time: number, all: readonly Aircraft[], roster: readonly Pilot[],
    terrain: Terrain, waypoints: WaypointSystem,
  ) {
    const jet = this.jet;
    if (!jet.alive) { this.target = null; return; }

    const c = jet.controls;
    c.gun = false;
    c.missile = false;
    c.flares = false;
    c.burner = false;

    this.retargetTimer -= dt;
    this.stateTimer -= dt;

    if (!this.target || !this.target.alive || this.retargetTimer <= 0) {
      this.pickTarget(all, roster);
      this.retargetTimer = rand(1.6, 3.4);
    }

    // --- state selection ---
    const agl = jet.pos.y - Math.max(0, this.groundAhead(jet, terrain));
    const sinkRate = jet.forward(_tmp).y * jet.speed;

    if (agl < CFG.ai.minAltitude && sinkRate < 20) {
      this.state = 'RECOVER';
      this.stateTimer = 1.2;
    } else if (jet.pos.y > CFG.ai.maxAltitude && sinkRate > -20) {
      this.state = 'DESCEND';
      this.stateTimer = 1.2;
    } else if (jet.threat > 0 && this.state !== 'EVADE' && Math.random() < 0.6 + this.skill * 0.4) {
      this.state = 'EVADE';
      // A better pilot breaks the lock and gets back to the fight *sooner*, not
      // later. Scaling this the other way made aces spend the match defending and
      // score worse than rookies — the opposite of a difficulty setting.
      this.stateTimer = CFG.ai.evadeTime * (1.35 - this.skill * 0.55);
      this.evadeSign = Math.random() < 0.5 ? -1 : 1;
      // better pilots reach for the flare button sooner
      this.flareTimer = CFG.ai.flareReaction * this.diff.flareReaction * (1.6 - this.skill);
    } else if (this.state === 'REARM') {
      // a ring restocks in one pass, so this ends the moment it works
      const done = jet.hp >= CFG.hull.hp && jet.ammo.IR >= WEAPONS.IR.count;
      if (done || this.stateTimer <= 0) this.state = 'PURSUE';
    } else if (this.stateTimer <= 0 && (this.state === 'EVADE' || this.state === 'EXTEND'
        || this.state === 'RECOVER' || this.state === 'DESCEND')) {
      this.state = 'PURSUE';
    }

    // shot dry or shot up? go and rearm, provided a zone is close enough to bother
    if (this.state === 'PURSUE' || this.state === 'ATTACK') {
      const hurt = jet.hp < CFG.ai.resupplyHp || jet.worstSystem < 0.45;
      const dry = jet.missiles === 0;
      if (hurt || dry) {
        const target = waypoints.nearestReady(jet.pos);
        if (target && target.dist < CFG.ai.resupplyRange) {
          this.state = 'REARM';
          this.stateTimer = 22;
        }
      }
    }

    const tgt = this.target;
    const dist = tgt ? jet.pos.distanceTo(tgt.pos) : Infinity;

    if (this.state === 'PURSUE' || this.state === 'ATTACK') {
      if (!tgt) this.state = 'PURSUE';
      else if (dist < CFG.ai.breakRange) {
        this.state = 'EXTEND';
        this.stateTimer = rand(1.6, 2.8);
      } else {
        this.state = dist < CFG.ai.engageRange ? 'ATTACK' : 'PURSUE';
      }
    }

    // --- act ---
    switch (this.state) {
      case 'RECOVER': {
        // pull the nose up and roll level — terrain always wins over the fight
        c.throttle = 1;
        c.burner = true;
        c.roll = clamp(-jet.bank * 2.2, -1, 1);
        c.pitch = clamp(0.55 + (CFG.ai.minAltitude - agl) / CFG.ai.minAltitude, 0.4, 1);
        c.yaw = 0;
        break;
      }

      case 'REARM': {
        const target = waypoints.nearestReady(jet.pos);
        if (!target) { this.state = 'PURSUE'; break; }
        const { wp, dist } = target;
        c.throttle = 1;
        c.burner = dist > 1800;
        // Fly straight at the centre of the hoop: whatever the approach angle, the
        // crossing point then lands inside the ring.
        _dir.copy(wp.pos).sub(jet.pos);
        // the rings sit lower than the central massif, so a straight run at one can
        // otherwise fly through a mountain — the usual altitude guard still applies,
        // but not once we are committed to the gate
        if (dist > 900) this.limitAltitude(_dir, jet, terrain);
        this.steer(_dir.normalize(), 1);
        break;
      }

      case 'DESCEND': {
        // roll upright and unload, otherwise a climbing fight ends at the ceiling
        c.throttle = 0.8;
        c.roll = clamp(-jet.bank * 2.2, -1, 1);
        c.pitch = clamp(-0.35 - (jet.pos.y - CFG.ai.maxAltitude) / 600, -1, -0.2);
        c.yaw = 0;
        break;
      }

      case 'EVADE': {
        c.throttle = 1;
        c.burner = true;
        this.flareTimer -= dt;
        // Pick the countermeasure matching the seeker actually chasing them — flares
        // do nothing against a radar round and chaff nothing against a heat-seeker —
        // and only once it is close enough to be spoofed at all, or a jet burns its
        // whole load on a shot that was never going to reach it.
        if (this.flareTimer <= 0 && jet.threat > 0) {
          if (jet.threatKind === 'RADAR') {
            if (jet.chaff >= CFG.chaff.salvo && jet.threatRange < CFG.chaff.decoyRange) {
              c.chaff = true;
            }
          } else if (jet.flares >= CFG.flare.salvo && jet.threatRange < CFG.flare.decoyRange) {
            c.flares = true;
          }
        }
        // hard break turn away from the missile, descending slightly to bleed the seeker
        _dir.copy(jet.right(_tmp)).multiplyScalar(this.evadeSign).addScaledVector(jet.forward(_l), 0.35);
        _dir.y -= 0.25;
        this.steer(_dir.normalize(), 1);
        c.roll = clamp(c.roll + this.evadeSign * 0.55, -1, 1);
        break;
      }

      case 'EXTEND': {
        c.throttle = 1;
        c.burner = true;
        if (tgt) {
          _dir.copy(jet.pos).sub(tgt.pos).normalize();
          _dir.y += 0.12;
          this.steer(_dir.normalize(), 0.8);
        }
        break;
      }

      case 'PURSUE': {
        c.throttle = 1;
        c.burner = true;
        // Beyond-visual-range shot while closing: the radar missile is the only one
        // with the legs for it, and taking these makes flares feel less like a
        // universal answer from the receiving end.
        if (tgt && jet.ammo.RADAR > 0 && dist < WEAPONS.RADAR.lockRange && dist > CFG.ai.radarMinRange) {
          const off = jet.forward(_tmp).angleTo(_to.copy(tgt.pos).sub(jet.pos).normalize());
          if (off < CFG.ai.radarMissileCone) {
            jet.setWeapon('RADAR');
            c.missile = true;
          }
        }
        if (tgt) {
          _to.copy(tgt.pos).sub(jet.pos);
          const tHit = _to.length() / Math.max(1, jet.speed);
          _lead.copy(tgt.forward(_tmp)).multiplyScalar(tgt.speed * Math.min(tHit, 6) * 0.5);
          _dir.copy(_to).add(_lead);
        } else {
          // no targets: orbit the map centre
          _dir.set(-jet.pos.x, 1800 - jet.pos.y, -jet.pos.z);
        }
        this.limitAltitude(_dir, jet, terrain);
        this.steer(_dir.normalize(), 0.9);
        break;
      }

      case 'ATTACK': {
        if (!tgt) break;
        _to.copy(tgt.pos).sub(jet.pos);
        // gun solution against a turning target, not a straight-flying one
        const closing = CFG.gun.speed + jet.speed * 0.35;
        const tHit = dist / closing;
        tgt.predictPosition(tHit, _lead);
        _aim.copy(_lead).sub(jet.pos).normalize();  // where the rounds have to go
        _dir.copy(_lead).sub(jet.pos);
        this.limitAltitude(_dir, jet, terrain);
        this.steer(_dir.normalize(), 1);

        c.throttle = dist > 1200 ? 1 : 0.72;
        c.burner = dist > 1600;   // close the gap on the burner, then settle to fight

        const fwd = jet.forward(_tmp);
        // The trigger is gated on the angle to the *lead point*, not to the target.
        // Gating on the target means firing only when the nose is off the solution
        // by the whole lead angle — about 12 degrees at typical range, well outside
        // the gun cone — so the cannon effectively never fired while aimed correctly.
        const gunAngle = fwd.angleTo(_aim);
        const angleOff = fwd.angleTo(_to.normalize());

        // guns: short bursts, better discipline at higher skill
        this.trigger -= dt;
        // how far the burst would miss by at the target, in metres
        const missBy = Math.tan(Math.min(gunAngle, 1.3)) * dist;
        const tolerance = CFG.ai.gunMissTolerance * (1.6 - this.skill);
        if (dist < CFG.ai.gunRange && gunAngle < CFG.ai.gunCone
            && missBy < tolerance && !jet.gunOverheated) {
          if (this.trigger <= 0) this.trigger = rand(0.35, 0.9) * (1.4 - this.skill);
          c.gun = this.trigger > 0.12;
        }

        // Pick the missile that suits the range before asking to shoot: radar for
        // the long shot, heat-seeker in the knife fight. The Game still gates the
        // launch on a completed lock.
        const wantRadar = dist > CFG.ai.radarMinRange && jet.ammo.RADAR > 0;
        if (wantRadar) jet.setWeapon('RADAR');
        else if (jet.ammo.IR > 0) jet.setWeapon('IR');

        const spec = jet.weaponSpec;
        const cone = spec.id === 'RADAR' ? CFG.ai.radarMissileCone : CFG.ai.missileCone;
        if (dist > 600 && dist < spec.lockRange && angleOff < cone && jet.missiles > 0) {
          c.missile = true;
        }
        break;
      }
    }

    // a little organic imprecision so formations do not look like clones
    const j = Math.sin(time * 0.9 + this.jitterPhase) * (0.09 * (1.2 - this.skill));
    c.roll = clamp(c.roll + j, -1, 1);
  }

  /**
   * Highest ground the jet is about to be over, not merely what is under it now.
   * Sampling only underneath is fine over rolling islands but useless against
   * anything steep — by the time a 50-degree flank is beneath you it is too late.
   */
  private groundAhead(jet: Aircraft, terrain: Terrain): number {
    const f = jet.forward(_tmp);
    let g = terrain.height(jet.pos.x, jet.pos.z);
    for (const d of [700, 1500]) {
      const h = terrain.height(jet.pos.x + f.x * d, jet.pos.z + f.z * d);
      if (h > g) g = h;
    }
    return g;
  }

  /** Bias the steering vector back into the usable altitude band. */
  /**
   * Bias a steering direction toward the altitude band.
   *
   * Every term here is a flight-path *slope* applied against the horizontal
   * component, not a number of metres added to dir.y. That matters because dir
   * is an unnormalised world delta whose length is the range to the target: the
   * old metre-based terms therefore got weaker the further away the fight was,
   * and the pull toward the band worked out to roughly two degrees at normal
   * engagement range. Measured over four minutes, bandits sat above 2550 m for
   * 76% of the match and against the 4200 m ceiling for 34% of it, which is why
   * they never fought anywhere near the terrain.
   */
  private limitAltitude(dir: THREE.Vector3, jet: Aircraft, terrain: Terrain) {
    const ground = Math.max(0, this.groundAhead(jet, terrain));
    const agl = jet.pos.y - ground;
    const horiz = Math.hypot(dir.x, dir.z);
    let slope = 0;

    // floor and ceiling are safety, so they apply at full strength
    const floor = CFG.ai.minAltitude * 1.8;
    if (agl < floor) slope += clamp((floor - agl) / CFG.ai.minAltitude, 0, 1) * 0.8;
    if (jet.pos.y > CFG.ai.maxAltitude) {
      slope -= clamp((jet.pos.y - CFG.ai.maxAltitude) / 400, 0, 1) * 0.8;
    }

    // Pull back toward the band the fight is supposed to happen in. Eased off at
    // knife-fight range so it cannot spoil a tracking solution.
    const engaged = clamp(horiz / 900, 0, 1);
    const err = CFG.ai.preferredAltitude - jet.pos.y;
    slope += clamp(err / CFG.ai.bandSoftness, -1, 1) * CFG.ai.bandPull * engaged;

    dir.y += horiz * clamp(slope, -1.2, 1.2);

    // stay inside the arena
    const r = Math.hypot(jet.pos.x, jet.pos.z);
    if (r > CFG.match.arenaRadius * 0.85) {
      dir.x -= jet.pos.x * 0.35;
      dir.z -= jet.pos.z * 0.35;
    }
  }

  /** Bank-to-turn steering: roll to put the lift vector on the target, then pull. */
  private steer(dirWorld: THREE.Vector3, aggression: number) {
    const jet = this.jet;
    const c = jet.controls;

    _l.copy(dirWorld).applyQuaternion(_q.copy(jet.quat).invert());
    const yawErr = Math.atan2(_l.x, -_l.z);
    const pitchErr = Math.asin(clamp(_l.y, -1, 1));
    const bank = jet.bank;

    // bank is full-range, so roll out the short way rather than the long way round
    const desiredBank = clamp(yawErr * 2.2, -1.3, 1.3);
    let bankErr = desiredBank - bank;
    if (bankErr > Math.PI) bankErr -= Math.PI * 2;
    if (bankErr < -Math.PI) bankErr += Math.PI * 2;
    c.roll = clamp(bankErr * 1.9 * aggression, -1, 1);

    /*
     * Extra pull while banked, which is what turns a bank into a turn. Pulling at
     * bank angle b splits sin(b) into the turn and cos(b) into climb, and the old
     * form kept that climb: the term was unconditionally positive, so every
     * turning fight was also a gentle zoom. Measured over four minutes it left
     * mean commanded pitch at +0.30 and put bandits above 2550 m for 76% of the
     * match, which is why they never fought near the terrain. Fading the pull out
     * as the wings level removes the part that was only ever buying altitude.
     */
    const pull = Math.abs(Math.sin(bank)) * (1 - Math.abs(Math.cos(bank)));
    const turnPull = pull * Math.min(Math.abs(yawErr), 1.2) * CFG.ai.turnPullGain;
    c.pitch = clamp((pitchErr * 2.4 + turnPull) * aggression, -1, 1);
    c.yaw = clamp(yawErr * 0.3, -0.5, 0.5);
  }

  private pickTarget(all: readonly Aircraft[], roster: readonly Pilot[]) {
    const jet = this.jet;
    let best: Aircraft | null = null;
    let bestScore = Infinity;

    for (const a of all) {
      if (!a.alive || a.team === jet.team) continue;

      const d = jet.pos.distanceTo(a.pos);
      // spread the squadron out instead of everyone dog-piling one bandit
      let taken = 0;
      for (const p of roster) if (p !== this && p.target === a) taken++;

      const angleOff = jet.forward(_tmp).angleTo(_to.copy(a.pos).sub(jet.pos).normalize());
      let score = d + taken * 2600 + angleOff * 900;
      if (a.isPlayer) score -= this.diff.playerBias;   // how hard they come for you
      if (a.hp < 45) score -= 900;                  // finish wounded targets
      if (score < bestScore) { bestScore = score; best = a; }
    }
    this.target = best;
  }
}

import * as THREE from 'three';
import { CFG } from '../core/config';
import { Aircraft } from '../entities/aircraft';
import { Terrain } from '../world/terrain';
import { WaypointSystem } from '../world/waypoints';
import { clamp, rand } from '../core/mathx';

type State = 'PURSUE' | 'ATTACK' | 'EVADE' | 'EXTEND' | 'RECOVER' | 'DESCEND' | 'REARM';

const _l = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _to = new THREE.Vector3();
const _lead = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class Pilot {
  readonly jet: Aircraft;
  /** 0 = rookie, 1 = ace — scales trigger discipline, reaction and manoeuvring */
  skill: number;

  target: Aircraft | null = null;
  state: State = 'PURSUE';
  private stateTimer = 0;
  private retargetTimer = 0;
  private evadeSign = 1;
  private flareTimer = 0;
  private jitterPhase = rand(0, 100);
  private trigger = 0;

  constructor(jet: Aircraft, skill: number) {
    this.jet = jet;
    this.skill = skill;
    this.retargetTimer = rand(0, 1.5);
  }

  /** Fresh match, fresh pilots. */
  reset(skill: number) {
    this.skill = skill;
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
    const agl = jet.pos.y - Math.max(0, terrain.height(jet.pos.x, jet.pos.z));
    const sinkRate = jet.forward(_tmp).y * jet.speed;

    if (agl < CFG.ai.minAltitude && sinkRate < 20) {
      this.state = 'RECOVER';
      this.stateTimer = 1.2;
    } else if (jet.pos.y > CFG.ai.maxAltitude && sinkRate > -20) {
      this.state = 'DESCEND';
      this.stateTimer = 1.2;
    } else if (jet.threat > 0 && this.state !== 'EVADE' && Math.random() < 0.6 + this.skill * 0.4) {
      this.state = 'EVADE';
      this.stateTimer = CFG.ai.evadeTime * (0.7 + this.skill * 0.6);
      this.evadeSign = Math.random() < 0.5 ? -1 : 1;
      // better pilots reach for the flare button sooner
      this.flareTimer = CFG.ai.flareReaction * (1.6 - this.skill);
    } else if (this.state === 'REARM') {
      // stay until topped up, or until the zone stops being worth the trip
      const done = jet.hp > CFG.hull.hp * 0.85 && jet.missiles >= CFG.missile.count - 1;
      if (done || this.stateTimer <= 0) this.state = 'PURSUE';
    } else if (this.stateTimer <= 0 && (this.state === 'EVADE' || this.state === 'EXTEND'
        || this.state === 'RECOVER' || this.state === 'DESCEND')) {
      this.state = 'PURSUE';
    }

    // shot dry or shot up? go and rearm, provided a zone is close enough to bother
    if (this.state === 'PURSUE' || this.state === 'ATTACK') {
      const hurt = jet.hp < CFG.ai.resupplyHp;
      const dry = jet.missiles === 0;
      if (hurt || dry) {
        const { dist } = waypoints.nearest(jet.pos);
        if (dist < CFG.ai.resupplyRange) {
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
        const { wp, dist } = waypoints.nearest(jet.pos);
        c.throttle = 1;
        c.burner = dist > 1800;
        // aim at the zone from outside, then hold a tight orbit once inside it
        if (dist > CFG.resupply.radius * 0.7) {
          _dir.copy(wp.pos).sub(jet.pos);
          // the zones sit lower than the central massif, so a straight run at one
          // can fly through a mountain — the usual altitude guard still applies
          this.limitAltitude(_dir, jet, terrain);
        } else {
          _dir.copy(jet.right(_tmp)).multiplyScalar(0.7)
            .addScaledVector(jet.forward(_l), 1)
            .addScaledVector(_to.copy(wp.pos).sub(jet.pos).normalize(), 0.55);
          c.throttle = 0.6;
          c.burner = false;
        }
        this.steer(_dir.normalize(), 0.9);
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
        // keep dispensing while the threat is live; the cooldown paces the salvos
        // only worth dispensing once the missile is close enough to be spoofed,
        // otherwise a jet burns its whole load on a shot that was never going to hit
        if (this.flareTimer <= 0 && jet.threat > 0 && jet.flares >= CFG.flare.salvo
            && jet.threatRange < CFG.flare.decoyRange) c.flares = true;
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
        // gun lead solution
        const closing = CFG.gun.speed + jet.speed * 0.35;
        const tHit = dist / closing;
        _lead.copy(tgt.forward(_tmp)).multiplyScalar(tgt.speed * tHit);
        _dir.copy(_to).add(_lead);
        this.limitAltitude(_dir, jet, terrain);
        this.steer(_dir.normalize(), 1);

        c.throttle = dist > 1200 ? 1 : 0.72;
        c.burner = dist > 1600;   // close the gap on the burner, then settle to fight

        const angleOff = jet.forward(_tmp).angleTo(_to.normalize());

        // guns: short bursts, better discipline at higher skill
        this.trigger -= dt;
        if (dist < CFG.ai.gunRange && angleOff < CFG.ai.gunCone && !jet.gunOverheated) {
          if (this.trigger <= 0) this.trigger = rand(0.35, 0.9) * (1.4 - this.skill);
          c.gun = this.trigger > 0.12;
        }

        // missiles: the Game gates the actual launch on lock progress
        if (dist > 600 && dist < CFG.missile.lockRange && angleOff < CFG.ai.missileCone && jet.missiles > 0) {
          c.missile = true;
        }
        break;
      }
    }

    // a little organic imprecision so formations do not look like clones
    const j = Math.sin(time * 0.9 + this.jitterPhase) * (0.09 * (1.2 - this.skill));
    c.roll = clamp(c.roll + j, -1, 1);
  }

  /** Bias the steering vector back into the usable altitude band. */
  private limitAltitude(dir: THREE.Vector3, jet: Aircraft, terrain: Terrain) {
    const ground = Math.max(0, terrain.height(jet.pos.x, jet.pos.z));
    const agl = jet.pos.y - ground;
    if (agl < CFG.ai.minAltitude * 1.8) dir.y += (CFG.ai.minAltitude * 1.8 - agl) * 0.4;
    if (jet.pos.y > CFG.ai.maxAltitude) dir.y -= (jet.pos.y - CFG.ai.maxAltitude) * 0.5;

    // Gentle pull back towards the scenic band. Without this, the pull-while-banked
    // term quietly trades speed for height until every fight happens at the ceiling.
    // Bounded against the horizontal component so it never overrides the chase.
    const horiz = Math.hypot(dir.x, dir.z);
    dir.y += clamp((CFG.ai.preferredAltitude - jet.pos.y) * 0.05, -horiz * 0.3, horiz * 0.3);
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

    // extra pull while banked, bounded — unbounded it pins the pitch at full
    // deflection whenever a target sits behind the jet, which just climbs forever
    const turnPull = Math.abs(Math.sin(bank)) * Math.min(Math.abs(yawErr), 1.2) * 1.6;
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
      if (a.isPlayer) score -= 350;                 // bandits lean towards the human, but do not swarm
      if (a.hp < 45) score -= 900;                  // finish wounded targets
      if (score < bestScore) { bestScore = score; best = a; }
    }
    this.target = best;
  }
}

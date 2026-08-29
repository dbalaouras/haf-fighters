import * as THREE from 'three';
import { CFG, TeamId, WeaponSpec, WEAPONS } from '../core/config';
import { Aircraft } from '../entities/aircraft';
import { Terrain } from '../world/terrain';
import { Fx } from './particles';
import { Decoy } from './countermeasures';
import { clamp } from '../core/mathx';

interface Missile {
  alive: boolean;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  life: number;
  owner: Aircraft;
  team: TeamId;
  target: Aircraft | null;
  /** the type this round was launched as — it carries its own performance */
  spec: WeaponSpec;
  /** set when the seeker has been spoofed; the missile chases this instead */
  decoy: Decoy | null;
  /** a seeker gets exactly one chance per countermeasure type, so spam cannot guarantee a save */
  flareTested: boolean;
  chaffTested: boolean;
  mesh: THREE.Mesh;
  trailAccum: number;
}

export interface MissileHit {
  victim: Aircraft;
  shooter: Aircraft;
  damage: number;
  /** detonation point, so damage can be attributed to a part of the airframe */
  at: THREE.Vector3;
}

/** Pooled heat-seekers using lead-pursuit guidance with a limited seeker turn rate. */
export class MissileSystem {
  readonly group = new THREE.Group();
  private pool: Missile[] = [];
  private readonly max = 40;
  private cursor = 0;
  private _v = new THREE.Vector3();
  private _w = new THREE.Vector3();
  private _axis = new THREE.Vector3();
  private _up = new THREE.Vector3(0, 1, 0);

  constructor() {
    // a simple dart reads correctly at the scale missiles are ever seen
    const body = new THREE.ConeGeometry(0.24, 3.2, 6);
    body.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0xdcdcdc, flatShading: true });

    for (let i = 0; i < this.max; i++) {
      const mesh = new THREE.Mesh(body, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({
        alive: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1),
        speed: 0, life: 0, owner: null as unknown as Aircraft, team: 'BLUE',
        target: null, spec: WEAPONS.IR, decoy: null,
        flareTested: false, chaffTested: false, mesh, trailAccum: 0,
      });
    }
  }

  get liveCount(): number { return this.pool.reduce((n, m) => n + (m.alive ? 1 : 0), 0); }

  fire(owner: Aircraft, target: Aircraft | null) {
    const spec = owner.weaponSpec;
    const m = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    m.alive = true;
    m.pos.copy(owner.pos).addScaledVector(owner.right(this._v), owner.missiles % 2 === 0 ? 3.4 : -3.4);
    m.pos.addScaledVector(owner.up(this._v), -0.6);
    m.dir.copy(owner.forward(this._v));
    m.spec = spec;
    m.speed = Math.max(spec.speed, owner.speed + 60);
    m.life = spec.life;
    // radar rounds are visibly bigger and burn brighter
    const scale = spec.id === 'RADAR' ? 1.35 : 1;
    m.mesh.scale.set(scale, scale, scale);
    m.owner = owner;
    m.team = owner.team;
    m.target = target;
    m.decoy = null;
    m.flareTested = false;
    m.chaffTested = false;
    m.trailAccum = 0;
    m.mesh.visible = true;
  }

  /**
   * A salvo has just been dispensed by `deployer`. Every live missile chasing them
   * gets one chance to bite, weighted by whether the decoys are actually in view of
   * the seeker — countermeasures dropped head-on or far away rarely work.
   *
   * Which seeker each type fools is the whole point of carrying both: flares are an
   * infrared decoy and chaff a radar one, so neither is a universal answer.
   */
  onDecoySalvo(salvo: readonly Decoy[], deployer: Aircraft) {
    if (!salvo.length) return;
    const chaff = salvo[0].kind === 'CHAFF';
    const F = chaff ? CFG.chaff : CFG.flare;

    for (const m of this.pool) {
      if (!m.alive || m.decoy || m.target !== deployer) continue;
      if (chaff ? !m.spec.radarVulnerable : !m.spec.flareVulnerable) continue;
      if (chaff ? m.chaffTested : m.flareTested) continue;

      const dist = m.pos.distanceTo(deployer.pos);
      if (dist > F.decoyRange) continue;

      // pick the decoy best placed to pull the seeker off
      let best: Decoy | null = null;
      let bestAngle = F.decoyCone;
      for (const f of salvo) {
        const ang = m.dir.angleTo(this._v.copy(f.pos).sub(m.pos).normalize());
        if (ang < bestAngle) { bestAngle = ang; best = f; }
      }
      if (!best) continue;

      if (chaff) m.chaffTested = true; else m.flareTested = true;
      // Deploying early works best: a missile still well out has time to be pulled
      // off, while one about to arrive is committed. Well-centred salvos help too.
      const earliness = dist / F.decoyRange;
      const centred = 1 - bestAngle / F.decoyCone;
      const chance = F.decoyChance * (0.55 + 0.45 * earliness) * (0.55 + 0.45 * centred);
      if (Math.random() < chance) {
        m.decoy = best;
        m.target = null;
      }
    }
  }

  update(
    dt: number,
    aircraft: readonly Aircraft[],
    terrain: Terrain,
    fx: Fx,
    onHit: (hit: MissileHit) => void,
    onDetonate?: (at: THREE.Vector3) => void,
  ) {
    for (const m of this.pool) {
      if (!m.alive) continue;

      m.life -= dt;
      m.speed = Math.min(m.spec.maxSpeed, m.speed + m.spec.accel * dt);

      // guidance
      const tgt = m.target;
      if (m.decoy) {
        if (m.decoy.alive) {
          const toF = this._v.copy(m.decoy.pos).sub(m.pos);
          if (toF.length() < m.spec.proximity + 6) {
            this.detonate(m, aircraft, fx, onHit, onDetonate);
            continue;
          }
          this.steerTowards(m, toF.normalize(), dt);
        } else {
          m.decoy = null;    // the flare burnt out; the missile is left ballistic
        }
      } else if (tgt && tgt.alive) {
        const toT = this._v.copy(tgt.pos).sub(m.pos);
        const dist = toT.length();
        const tHit = dist / Math.max(1, m.speed);
        // lead the target by most of the time-to-intercept
        const lead = this._w.copy(tgt.forward(this._axis)).multiplyScalar(tgt.speed * tHit * 0.85);
        const desired = toT.add(lead).normalize();

        if (m.dir.angleTo(desired) > 2.0) {
          m.target = null;                       // seeker broke lock — fly ballistic
        } else {
          this.steerTowards(m, desired, dt);
        }

        // keep the threat warning alive on the victim
        tgt.threat = Math.max(tgt.threat, 1.2);
        tgt.threatRange = Math.min(tgt.threatRange, dist);
        tgt.threatKind = m.spec.id;
      }

      const prevPos = this._axis.copy(m.pos);
      m.pos.addScaledVector(m.dir, m.speed * dt);

      m.mesh.position.copy(m.pos);
      m.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), m.dir);

      m.trailAccum += dt;
      if (m.trailAccum > 0.016) {
        m.trailAccum = 0;
        fx.missileTrail(m.pos, this._w.copy(m.dir).multiplyScalar(m.speed));
      }

      // proximity fuze against any aircraft of the opposing team
      let detonated = false;
      for (const a of aircraft) {
        if (!a.alive || a.team === m.team) continue;
        if (a.pos.distanceTo(m.pos) < m.spec.proximity + CFG.hull.radius) {
          this.detonate(m, aircraft, fx, onHit, onDetonate);
          detonated = true;
          break;
        }
      }
      if (detonated) continue;

      if (terrain.collides(m.pos) || m.life <= 0 || prevPos.distanceTo(m.pos) > 5000) {
        this.detonate(m, aircraft, fx, onHit, onDetonate);
      }
    }
  }

  /** Turn the missile towards `desired`, limited by the seeker's turn rate. */
  private steerTowards(m: Missile, desired: THREE.Vector3, dt: number) {
    const ang = m.dir.angleTo(desired);
    if (ang < 1e-4) return;
    const step = Math.min(ang, m.spec.turnRate * dt);
    this._axis.crossVectors(m.dir, desired);
    if (this._axis.lengthSq() < 1e-8) this._axis.copy(this._up);
    this._axis.normalize();
    m.dir.applyAxisAngle(this._axis, step).normalize();
  }

  private detonate(
    m: Missile,
    aircraft: readonly Aircraft[],
    fx: Fx,
    onHit: (hit: MissileHit) => void,
    onDetonate?: (at: THREE.Vector3) => void,
  ) {
    m.alive = false;
    m.mesh.visible = false;
    m.decoy = null;
    fx.explosion(m.pos, 1.15);
    onDetonate?.(m.pos);

    for (const a of aircraft) {
      if (!a.alive || a.team === m.team) continue;
      const d = a.pos.distanceTo(m.pos);
      if (d > m.spec.blastRadius) continue;
      const falloff = clamp(
        1 - (d - m.spec.proximity) / m.spec.blastRadius, CFG.missile.blastFalloffFloor, 1);
      onHit({ victim: a, shooter: m.owner, damage: m.spec.damage * falloff, at: m.pos });
    }
  }

  /** Closest live missile tracking `a`, for HUD threat direction. */
  threatTo(a: Aircraft): THREE.Vector3 | null {
    let best: Missile | null = null;
    let bestD = Infinity;
    for (const m of this.pool) {
      if (!m.alive || m.target !== a) continue;
      const d = m.pos.distanceToSquared(a.pos);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best ? best.pos : null;
  }
}

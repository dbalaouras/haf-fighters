import * as THREE from 'three';
import { CFG, TeamId } from '../core/config';
import { Aircraft } from '../entities/aircraft';
import { Terrain } from '../world/terrain';
import { Fx } from './particles';
import { rand } from '../core/mathx';

interface Bullet {
  alive: boolean;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  owner: Aircraft | null;
  team: TeamId;
}

const TRACER_COL = { BLUE: new THREE.Color(0x9fe4ff), RED: new THREE.Color(0xffc46a) };

/** Pooled cannon rounds drawn as short tracer segments. */
export class BulletSystem {
  readonly object: THREE.LineSegments;
  private readonly max = 700;
  private pool: Bullet[] = [];
  private cursor = 0;
  private positions: Float32Array;
  private colors: Float32Array;
  private geo = new THREE.BufferGeometry();
  private _a = new THREE.Vector3();
  private _b = new THREE.Vector3();

  constructor() {
    this.positions = new Float32Array(this.max * 6);
    this.colors = new Float32Array(this.max * 6);
    for (let i = 0; i < this.max; i++) {
      this.pool.push({
        alive: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(),
        vel: new THREE.Vector3(), life: 0, owner: null, team: 'BLUE',
      });
      for (let k = 0; k < 6; k += 3) this.positions[i * 6 + k + 1] = -1e6;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    this.object = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.object.frustumCulled = false;
  }

  spawn(owner: Aircraft, origin: THREE.Vector3, dir: THREE.Vector3) {
    const b = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    b.alive = true;
    b.pos.copy(origin);
    b.prev.copy(origin);
    b.vel.copy(dir)
      .add(this._a.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(CFG.gun.spread))
      .normalize()
      .multiplyScalar(CFG.gun.speed)
      .addScaledVector(owner.forward(this._b), owner.speed * 0.35);
    b.life = CFG.gun.range / CFG.gun.speed;
    b.owner = owner;
    b.team = owner.team;
  }

  update(
    dt: number,
    aircraft: readonly Aircraft[],
    terrain: Terrain,
    fx: Fx,
    onHit: (victim: Aircraft, shooter: Aircraft, damage: number, at: THREE.Vector3) => void,
  ) {
    const r2 = CFG.gun.hitRadius * CFG.gun.hitRadius;

    for (let i = 0; i < this.max; i++) {
      const b = this.pool[i];
      const o = i * 6;

      if (!b.alive) {
        this.positions[o + 1] = -1e6; this.positions[o + 4] = -1e6;
        continue;
      }

      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;

      let dead = b.life <= 0;

      if (!dead) {
        for (const t of aircraft) {
          if (!t.alive || t.team === b.team || t === b.owner) continue;
          if (this.segDistSq(b.prev, b.pos, t.pos) < r2) {
            fx.hitSpark(this._a.copy(t.pos).lerp(b.pos, 0.4));
            if (b.owner) onHit(t, b.owner, CFG.gun.damage, b.pos);
            dead = true;
            break;
          }
        }
      }

      // no terrain can reach above ~1.6 km, so skip the noise sample up there
      if (!dead && b.pos.y < 1650 && terrain.collides(b.pos)) {
        fx.hitSpark(b.pos);
        dead = true;
      }

      if (dead) {
        b.alive = false;
        this.positions[o + 1] = -1e6; this.positions[o + 4] = -1e6;
        continue;
      }

      // tracer segment: a short streak trailing the round
      const tail = this._a.copy(b.vel).multiplyScalar(-0.035);
      this.positions[o] = b.pos.x; this.positions[o + 1] = b.pos.y; this.positions[o + 2] = b.pos.z;
      this.positions[o + 3] = b.pos.x + tail.x;
      this.positions[o + 4] = b.pos.y + tail.y;
      this.positions[o + 5] = b.pos.z + tail.z;

      const c = TRACER_COL[b.team];
      this.colors[o] = c.r; this.colors[o + 1] = c.g; this.colors[o + 2] = c.b;
      this.colors[o + 3] = c.r * 0.25; this.colors[o + 4] = c.g * 0.25; this.colors[o + 5] = c.b * 0.25;
    }

    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  /** squared distance from point p to segment ab */
  private segDistSq(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
    return dx * dx + dy * dy + dz * dz;
  }
}

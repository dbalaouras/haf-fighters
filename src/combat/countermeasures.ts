import * as THREE from 'three';
import { CFG, TeamId } from '../core/config';
import { Aircraft } from '../entities/aircraft';
import { Fx } from './particles';
import { rand } from '../core/mathx';

export type CmKind = 'FLARE' | 'CHAFF';

export interface Decoy {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  team: TeamId;
  salvo: number;
  kind: CmKind;
}

/**
 * Flares and chaff. Both are points in space that a seeker can be talked into
 * chasing, so they share a pool and the decoy geometry; only the physics, the
 * visuals and which seeker they fool differ. Neither costs a draw call — the
 * particle system draws them.
 */
export class CountermeasureSystem {
  private pool: Decoy[] = [];
  private readonly max = 160;
  private cursor = 0;
  private salvoCounter = 0;
  private _v = new THREE.Vector3();

  constructor() {
    for (let i = 0; i < this.max; i++) {
      this.pool.push({
        alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        life: 0, team: 'BLUE', salvo: -1, kind: 'FLARE',
      });
    }
  }

  get live(): readonly Decoy[] { return this.pool; }

  /** Dispense one salvo behind an aircraft. Returns just what was created. */
  deploy(from: Aircraft, kind: CmKind = 'FLARE'): Decoy[] {
    const spec = kind === 'CHAFF' ? CFG.chaff : CFG.flare;
    const salvo = this.salvoCounter++;
    const out: Decoy[] = [];
    const fwd = from.forward(this._v).clone();
    const right = from.right().clone();
    const up = from.up().clone();

    for (let i = 0; i < spec.salvo; i++) {
      const f = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
      f.alive = true;
      f.life = spec.life;
      f.team = from.team;
      f.salvo = salvo;
      f.kind = kind;
      f.pos.copy(from.pos).addScaledVector(fwd, -6);
      // Both keep most of the jet's momentum and then bleed off, so a salvo trails
      // just behind the flight path where a pursuing seeker will run into it. Chaff
      // spreads wider and sinks far less — it hangs as a cloud rather than falling.
      const spread = kind === 'CHAFF' ? 46 : 20;
      const sink = kind === 'CHAFF' ? rand(-0.5, 0.2) : rand(-1.5, -0.4);
      f.vel.copy(fwd).multiplyScalar(from.speed * 0.6)
        .addScaledVector(right, rand(-1, 1) * spread)
        .addScaledVector(up, sink * 16);
      out.push(f);
    }
    return out;
  }

  update(dt: number, fx: Fx) {
    for (const f of this.pool) {
      if (!f.alive) continue;
      f.life -= dt;
      if (f.life <= 0) { f.alive = false; continue; }

      const spec = f.kind === 'CHAFF' ? CFG.chaff : CFG.flare;
      // chaff sheds speed hard and hangs; a flare keeps going and falls away
      f.vel.multiplyScalar(Math.exp(-(f.kind === 'CHAFF' ? 2.6 : 1.1) * dt));
      f.vel.y -= spec.fallSpeed * dt;
      f.pos.addScaledVector(f.vel, dt);
      const remaining = f.life / spec.life;
      if (f.kind === 'CHAFF') fx.chaffCloud(f.pos, f.vel, remaining);
      else fx.flareBurn(f.pos, f.vel, remaining);
    }
  }

  reset() {
    for (const f of this.pool) f.alive = false;
  }
}

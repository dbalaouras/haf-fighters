import * as THREE from 'three';
import { CFG, TeamId } from '../core/config';
import { Aircraft } from '../entities/aircraft';
import { Fx } from './particles';
import { rand } from '../core/mathx';

export interface Flare {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  team: TeamId;
  salvo: number;
}

/**
 * Decoy flares. They exist purely as points in space that missile seekers can be
 * talked into chasing — the burn itself is drawn by the particle system, so the
 * whole thing costs no draw calls.
 */
export class FlareSystem {
  private pool: Flare[] = [];
  private readonly max = 160;
  private cursor = 0;
  private salvoCounter = 0;
  private _v = new THREE.Vector3();

  constructor() {
    for (let i = 0; i < this.max; i++) {
      this.pool.push({
        alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        life: 0, team: 'BLUE', salvo: -1,
      });
    }
  }

  get live(): readonly Flare[] { return this.pool; }

  /** Dispense one salvo behind an aircraft. Returns just the flares created. */
  deploy(from: Aircraft): Flare[] {
    const salvo = this.salvoCounter++;
    const out: Flare[] = [];
    const fwd = from.forward(this._v).clone();
    const right = from.right().clone();
    const up = from.up().clone();

    for (let i = 0; i < CFG.flare.salvo; i++) {
      const f = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
      f.alive = true;
      f.life = CFG.flare.life;
      f.team = from.team;
      f.salvo = salvo;
      f.pos.copy(from.pos).addScaledVector(fwd, -6);
      // A flare keeps most of the jet's momentum and then bleeds off, so the salvo
      // trails just behind the flight path where a pursuing seeker will run into it.
      f.vel.copy(fwd).multiplyScalar(from.speed * 0.6)
        .addScaledVector(right, rand(-1, 1) * 20)
        .addScaledVector(up, rand(-1.5, -0.4) * 16);
      out.push(f);
    }
    return out;
  }

  update(dt: number, fx: Fx) {
    for (const f of this.pool) {
      if (!f.alive) continue;
      f.life -= dt;
      if (f.life <= 0) { f.alive = false; continue; }

      // drag plus gravity, so a salvo trails behind and sinks away from the jet
      f.vel.multiplyScalar(Math.exp(-1.1 * dt));
      f.vel.y -= CFG.flare.fallSpeed * dt;
      f.pos.addScaledVector(f.vel, dt);
      fx.flareBurn(f.pos, f.vel, f.life / CFG.flare.life);
    }
  }

  reset() {
    for (const f of this.pool) f.alive = false;
  }
}

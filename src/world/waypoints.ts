import * as THREE from 'three';
import { CFG } from '../core/config';
import { Aircraft } from '../entities/aircraft';
import { Terrain } from './terrain';
import { clamp01 } from '../core/mathx';

export interface Waypoint {
  pos: THREE.Vector3;
  /** ring normal — you have to cross this plane inside the hoop */
  axis: THREE.Vector3;
  ring: THREE.Mesh;
  /** seconds until the ring is usable again */
  cooldown: number;
  /** eased 0..1 flash right after a pass */
  flash: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _hit = new THREE.Vector3();

const READY = new THREE.Color(0x7fe3ff);
const COLD = new THREE.Color(0xff8a5c);

/**
 * Rearm rings. Flying through the hoop restores everything at once, then the ring
 * goes cold for `cooldown` seconds.
 *
 * "Through" means what it says: the aircraft has to cross the ring's plane *inside*
 * the hoop between one frame and the next, which is why this tracks previous
 * positions rather than just testing a radius — at 300 m/s a jet moves 5 m a frame
 * and a proximity test would fire from anywhere near the ring.
 */
export class WaypointSystem {
  readonly group = new THREE.Group();
  readonly points: Waypoint[] = [];
  private prev = new Map<Aircraft, THREE.Vector3>();

  constructor(terrain: Terrain) {
    const R = CFG.resupply;
    // The ring is the whole marker. A vertical light column used to stand in for it,
    // back when a single flat torus was invisible edge-on; the three-axis cage solved
    // that on its own and left the column as scaffolding that read as its own object.
    const ringGeo = new THREE.TorusGeometry(R.ringRadius, R.tube, 8, 56);

    for (let i = 0; i < R.count; i++) {
      const a = (i / R.count) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * R.orbitRadius;
      const z = Math.sin(a) * R.orbitRadius;
      const ground = Math.max(0, terrain.height(x, z));
      const y = Math.max(R.altitude, ground + 520);

      // face the hoop along the tangent of the ring of zones, so they chain into
      // a circuit you can fly rather than each needing a separate approach
      const axis = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).normalize();

      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: READY.clone(), transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      ring.position.set(x, y, z);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);

      this.group.add(ring);
      this.points.push({
        pos: new THREE.Vector3(x, y, z), axis, ring, cooldown: 0, flash: 0,
      });
    }
  }

  nearest(pos: THREE.Vector3): { wp: Waypoint; dist: number } {
    let best = this.points[0];
    let bestD = Infinity;
    for (const wp of this.points) {
      const d = wp.pos.distanceTo(pos);
      if (d < bestD) { bestD = d; best = wp; }
    }
    return { wp: best, dist: bestD };
  }

  /** Nearest ring that is actually usable — what the AI should be heading for. */
  nearestReady(pos: THREE.Vector3): { wp: Waypoint; dist: number } | null {
    let best: Waypoint | null = null;
    let bestD = Infinity;
    for (const wp of this.points) {
      if (wp.cooldown > 0) continue;
      const d = wp.pos.distanceTo(pos);
      if (d < bestD) { bestD = d; best = wp; }
    }
    return best ? { wp: best, dist: bestD } : null;
  }

  update(dt: number, aircraft: readonly Aircraft[], onPass: (a: Aircraft, wp: Waypoint) => void) {
    for (const wp of this.points) {
      wp.cooldown = Math.max(0, wp.cooldown - dt);
      wp.flash = Math.max(0, wp.flash - dt * 2.2);
    }

    for (const a of aircraft) {
      if (!a.alive) { this.prev.delete(a); continue; }
      const prev = this.prev.get(a);

      if (prev) {
        for (const wp of this.points) {
          if (wp.cooldown > 0) continue;
          if (this.crossedHoop(prev, a.pos, wp)) {
            wp.cooldown = CFG.resupply.cooldown;
            wp.flash = 1;
            onPass(a, wp);
            break;
          }
        }
      }

      let store = this.prev.get(a);
      if (!store) { store = new THREE.Vector3(); this.prev.set(a, store); }
      store.copy(a.pos);
    }

    this.refreshVisuals();
  }

  /** Did the segment prev->now pass through the ring's opening? */
  private crossedHoop(prev: THREE.Vector3, now: THREE.Vector3, wp: Waypoint): boolean {
    const dPrev = _a.copy(prev).sub(wp.pos).dot(wp.axis);
    const dNow = _b.copy(now).sub(wp.pos).dot(wp.axis);
    if (dPrev === dNow) return false;
    if ((dPrev > 0) === (dNow > 0)) return false;      // never crossed the plane

    // where on the plane it crossed, and whether that is inside the hoop
    const t = dPrev / (dPrev - dNow);
    _hit.copy(prev).lerp(now, t).sub(wp.pos);
    _hit.addScaledVector(wp.axis, -_hit.dot(wp.axis));  // project onto the ring plane
    return _hit.length() <= CFG.resupply.ringRadius;
  }

  private refreshVisuals() {
    for (const wp of this.points) {
      const cooling = wp.cooldown > 0;
      const ready = 1 - clamp01(wp.cooldown / CFG.resupply.cooldown);

      const rm = wp.ring.material as THREE.MeshBasicMaterial;
      rm.color.copy(COLD).lerp(READY, ready);
      rm.opacity = (cooling ? 0.18 + 0.4 * ready : 0.75) + wp.flash * 0.5;

      // a quick pop on the frame it is used, so a pass reads as an event
      const s = 1 + wp.flash * 0.12;
      wp.ring.scale.set(s, s, s);
    }
  }

  reset() {
    this.prev.clear();
    for (const wp of this.points) { wp.cooldown = 0; wp.flash = 0; }
    this.refreshVisuals();
  }
}

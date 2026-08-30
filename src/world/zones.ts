import * as THREE from 'three';
import { TeamId, TEAM, ZONES } from '../core/config';
import { Aircraft } from '../entities/aircraft';
import { MapSpec } from './maps';
import { Terrain } from './terrain';
import { clamp01 } from '../core/mathx';

export interface Zone {
  label: 'A' | 'B' | 'C';
  pos: THREE.Vector3;
  axis: THREE.Vector3;
  owner: TeamId | null;
  /** seconds before this ring can change hands again */
  lockout: number;
  /** eased 0..1 flash right after a capture */
  flash: number;
  ring: THREE.Mesh;
  post: THREE.Mesh;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _hit = new THREE.Vector3();

const NEUTRAL = new THREE.Color(0xc8d2e0);

/**
 * The three capture zones of Air Superiority.
 *
 * Capture is the same gesture as a rearm ring, and deliberately the same code:
 * you have to cross the hoop's plane *inside* the ring between one frame and the
 * next. A proximity test would fire from anywhere nearby, which at 300 m/s means
 * a zone flips without the pilot ever aiming at it.
 */
export class ZoneSystem {
  readonly group = new THREE.Group();
  readonly zones: Zone[] = [];
  private prev = new Map<Aircraft, THREE.Vector3>();

  constructor(spec: MapSpec, terrain: Terrain) {
    const places = spec.zones ?? defaultZones();
    const ringGeo = new THREE.TorusGeometry(ZONES.ringRadius, ZONES.tube, 8, 48);
    // a second hoop across the first, so the zone still reads edge-on
    const crossGeo = new THREE.TorusGeometry(ZONES.ringRadius, ZONES.tube * 0.7, 6, 48);

    (['A', 'B', 'C'] as const).forEach((label, i) => {
      const p = places[i];
      const ground = Math.max(0, terrain.height(p.x, p.z));
      const y = Math.max(ZONES.altitude, ground + ZONES.clearance);
      // face each hoop at the middle of the map, so the approach is down the
      // line you would fly anyway rather than across it
      const axis = new THREE.Vector3(-p.x, 0, -p.z);
      if (axis.lengthSq() < 1) axis.set(0, 0, 1);
      axis.normalize();

      const mat = new THREE.MeshBasicMaterial({
        color: NEUTRAL.clone(), transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.position.set(p.x, y, p.z);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);

      const post = new THREE.Mesh(crossGeo, mat);
      post.position.copy(ring.position);
      post.quaternion.copy(ring.quaternion);
      post.rotateY(Math.PI / 2);

      this.group.add(ring, post);
      this.zones.push({
        label, pos: new THREE.Vector3(p.x, y, p.z), axis,
        owner: p.owner ?? null, lockout: 0, flash: 0, ring, post,
      });
    });
    this.paint();
  }

  /** How many zones a team holds. */
  held(team: TeamId): number {
    let n = 0;
    for (const z of this.zones) if (z.owner === team) n++;
    return n;
  }

  /** The nearest zone this team does not already own, for the AI to go and take. */
  nearestTarget(team: TeamId, from: THREE.Vector3): Zone | null {
    let best: Zone | null = null;
    let bestD = Infinity;
    for (const z of this.zones) {
      if (z.owner === team || z.lockout > 0) continue;
      const d = from.distanceToSquared(z.pos);
      if (d < bestD) { bestD = d; best = z; }
    }
    return best;
  }

  update(dt: number, aircraft: readonly Aircraft[], onCapture: (a: Aircraft, z: Zone) => void) {
    for (const z of this.zones) {
      z.lockout = Math.max(0, z.lockout - dt);
      z.flash = Math.max(0, z.flash - dt * 1.6);
    }

    for (const a of aircraft) {
      let prev = this.prev.get(a);
      if (!prev) { this.prev.set(a, prev = a.pos.clone()); continue; }
      if (a.alive) {
        for (const z of this.zones) {
          if (z.lockout > 0 || z.owner === a.team) continue;
          if (!crossed(prev, a.pos, z)) continue;
          z.owner = a.team;
          z.lockout = ZONES.lockout;
          z.flash = 1;
          onCapture(a, z);
        }
      }
      prev.copy(a.pos);
    }
    this.paint();
  }

  private paint() {
    for (const z of this.zones) {
      const base = z.owner ? new THREE.Color(TEAM[z.owner].color) : NEUTRAL;
      const mat = z.ring.material as THREE.MeshBasicMaterial;
      mat.color.copy(base).multiplyScalar(1 + z.flash * 1.6);
      mat.opacity = 0.6 + clamp01(z.flash) * 0.4;
    }
  }

  reset() {
    const places = defaultOwners();
    this.zones.forEach((z, i) => {
      z.owner = places[i];
      z.lockout = 0;
      z.flash = 0;
    });
    this.prev.clear();
    this.paint();
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
  }
}

/** Crossed the hoop's plane, inside the ring, between two frames. */
function crossed(prev: THREE.Vector3, now: THREE.Vector3, z: Zone): boolean {
  const before = _a.copy(prev).sub(z.pos).dot(z.axis);
  const after = _b.copy(now).sub(z.pos).dot(z.axis);
  if (before === after || (before > 0) === (after > 0)) return false;
  const t = before / (before - after);
  _hit.lerpVectors(prev, now, t);
  return _hit.distanceTo(z.pos) <= ZONES.ringRadius;
}

/** A near each team's spawn, C near the other's, B neutral in the middle. */
function defaultZones() {
  return [
    { x: TEAM.BLUE.spawn.x * 1.5, z: TEAM.BLUE.spawn.z * 1.5, owner: 'BLUE' as TeamId | null },
    { x: 0, z: 0, owner: null as TeamId | null },
    { x: TEAM.RED.spawn.x * 1.5, z: TEAM.RED.spawn.z * 1.5, owner: 'RED' as TeamId | null },
  ];
}

function defaultOwners(): Array<TeamId | null> {
  return ['BLUE', null, 'RED'];
}

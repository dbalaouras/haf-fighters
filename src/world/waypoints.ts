import * as THREE from 'three';
import { CFG } from '../core/config';
import { Aircraft } from '../entities/aircraft';
import { Terrain } from './terrain';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp01 } from '../core/mathx';

export interface Waypoint {
  pos: THREE.Vector3;
  ring: THREE.Mesh;
  beacon: THREE.Mesh;
  /** eased 0..1, how much traffic the zone currently has — drives the glow */
  activity: number;
}

interface Progress { missile: number; flare: number }

/**
 * Neutral rearm zones. Fly into one and it tops up missiles, flares, burner fuel
 * and hull. They are contested by design: both teams share them, and loitering in
 * a fixed, well-lit volume is exactly as risky as it sounds.
 */
export class WaypointSystem {
  readonly group = new THREE.Group();
  readonly points: Waypoint[] = [];
  private progress = new Map<Aircraft, Progress>();
  private spin = 0;

  constructor(terrain: Terrain) {
    const R = CFG.resupply;

    // Three rings on orthogonal axes, merged into one geometry. A single flat ring
    // is edge-on and invisible from a jet's shallow approach; a cage reads from any
    // angle and still costs one draw call.
    const rings: THREE.BufferGeometry[] = [];
    const flat = new THREE.TorusGeometry(R.ringRadius, 5, 6, 44);
    flat.rotateX(Math.PI / 2);
    rings.push(flat.toNonIndexed());
    const upright = new THREE.TorusGeometry(R.ringRadius * 0.94, 4, 6, 44);
    rings.push(upright.toNonIndexed());
    const upright2 = upright.clone();
    upright2.rotateY(Math.PI / 2);
    rings.push(upright2.toNonIndexed());
    const ringGeo = mergeGeometries(rings, false)!;

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x7fe3ff, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    // a tall soft column so the zone is findable from across the map
    const beaconGeo = new THREE.CylinderGeometry(20, 52, 2600, 12, 1, true);
    beaconGeo.translate(0, 1300, 0);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x5fd0ff, transparent: true, opacity: 0.24,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });

    for (let i = 0; i < R.count; i++) {
      const a = (i / R.count) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * R.orbitRadius;
      const z = Math.sin(a) * R.orbitRadius;
      // keep the zone clear of any terrain underneath it
      const ground = Math.max(0, terrain.height(x, z));
      const y = Math.max(R.altitude, ground + 520);

      const ring = new THREE.Mesh(ringGeo, ringMat.clone());
      ring.position.set(x, y, z);
      const beacon = new THREE.Mesh(beaconGeo, beaconMat.clone());
      beacon.position.set(x, y, z);

      this.group.add(ring, beacon);
      this.points.push({ pos: new THREE.Vector3(x, y, z), ring, beacon, activity: 0 });
    }
  }

  /** Nearest zone to a position, and how far away it is. */
  nearest(pos: THREE.Vector3): { wp: Waypoint; dist: number } {
    let best = this.points[0];
    let bestD = Infinity;
    for (const wp of this.points) {
      const d = wp.pos.distanceTo(pos);
      if (d < bestD) { bestD = d; best = wp; }
    }
    return { wp: best, dist: bestD };
  }

  /** True while this aircraft is inside a zone (drives the HUD readout). */
  isInside(a: Aircraft): boolean {
    return this.nearest(a.pos).dist <= CFG.resupply.radius;
  }

  update(dt: number, aircraft: readonly Aircraft[]) {
    const R = CFG.resupply;
    this.spin += dt * 0.25;

    for (const wp of this.points) {
      wp.ring.rotation.y = this.spin;
      wp.ring.rotation.x = Math.sin(this.spin * 0.6) * 0.25;
      wp.activity = Math.max(0, wp.activity - dt * 1.4);
    }

    for (const a of aircraft) {
      if (!a.alive) { this.progress.delete(a); continue; }

      const { wp, dist } = this.nearest(a.pos);
      if (dist > R.radius) { this.progress.delete(a); continue; }

      wp.activity = 1;

      let p = this.progress.get(a);
      if (!p) { p = { missile: 0, flare: 0 }; this.progress.set(a, p); }

      // stronger effect the closer to the centre, so a lazy pass gives less
      const strength = 0.45 + 0.55 * clamp01(1 - dist / R.radius);

      a.hp = Math.min(CFG.hull.hp, a.hp + R.hullPerSec * strength * dt);
      a.burnerFuel = clamp01(a.burnerFuel + R.burnerPerSec * strength * dt);
      a.gunHeat = Math.max(0, a.gunHeat - R.heatCoolBonus * strength * dt);

      p.missile += strength * dt;
      if (p.missile >= R.missileInterval && a.missiles < CFG.missile.count) {
        p.missile = 0;
        a.missiles++;
      }
      p.flare += strength * dt;
      if (p.flare >= R.flareInterval && a.flares < CFG.flare.count) {
        p.flare = 0;
        a.flares = Math.min(CFG.flare.count, a.flares + CFG.flare.salvo);
      }
    }

    // glow with use
    for (const wp of this.points) {
      const mat = wp.ring.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.5 + 0.4 * wp.activity;
      const bm = wp.beacon.material as THREE.MeshBasicMaterial;
      bm.opacity = 0.2 + 0.2 * wp.activity;
    }
  }

  reset() {
    this.progress.clear();
    for (const wp of this.points) wp.activity = 0;
  }
}

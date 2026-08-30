import * as THREE from 'three';
import { armTip, HARBOUR, inland, MapSpec } from './maps';
import { rand } from '../core/mathx';

/**
 * The working half of Piraeus Dawn: gantry cranes along the quay, container
 * stacks behind them, hulls at their berths, and a lighthouse on the mole.
 *
 * The cranes are the point. Their booms sit at 60-120 m with clear air beneath,
 * which is a shape no other map offers — the volcano is something to go round
 * and the bridge is a single arch, but a crane line is a row of gates.
 */

interface Solid {
  x: number; z: number;
  halfX: number; halfZ: number;
  top: number;
}

const STEEL = 0x6a6f78;
const RUST = 0x8a5c46;

export class Harbour {
  readonly group = new THREE.Group();
  private solids: Solid[] = [];
  private grid = new Map<number, Solid[]>();
  private readonly cell = 400;
  private beacon: THREE.PointLight;

  constructor(spec: MapSpec) {
    const steel = new THREE.MeshLambertMaterial({ color: STEEL, flatShading: true });
    const rust = new THREE.MeshLambertMaterial({ color: RUST, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a3f47, flatShading: true });

    this.group.add(this.buildCranes(spec, steel));
    this.group.add(this.buildContainers(spec));
    this.group.add(this.buildShips(spec, dark, rust));

    const light = this.buildLighthouse(steel);
    this.group.add(light.group);
    this.beacon = light.beacon;

    for (const s of this.solids) {
      const k = this.key(s.x, s.z);
      let bucket = this.grid.get(k);
      if (!bucket) this.grid.set(k, bucket = []);
      bucket.push(s);
    }
  }

  private key(x: number, z: number): number {
    return Math.floor(x / this.cell) * 100000 + Math.floor(z / this.cell);
  }

  /** Points along the quay, spaced out, each with the shore's local direction. */
  private quayLine(step: number): Array<{ x: number; z: number; ang: number }> {
    const out: Array<{ x: number; z: number; ang: number }> = [];
    for (let x = -8200; x <= 8200; x += step) {
      const z = HARBOUR.shore(x);
      const dz = HARBOUR.shore(x + 40) - HARBOUR.shore(x - 40);
      out.push({ x, z, ang: Math.atan2(dz, 80) });
    }
    return out;
  }

  /**
   * A portal crane: two legs, a sill beam, and a boom cantilevered out over the
   * water. Built as one merged geometry per crane and added to the solid list so
   * flying through the gap is a real thing you can get wrong.
   */
  private buildCranes(spec: MapSpec, mat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const b = new THREE.BoxGeometry(w, h, d);
      b.translate(x, y, z);
      return b;
    };

    for (const p of this.quayLine(560)) {
      if (Math.random() < 0.25) continue;                    // gaps in the line
      const legH = rand(58, 104);
      const gauge = 66;                                      // between the legs
      const reach = rand(120, 165);                          // boom out over water
      const ground = spec.baseHeight(p.x, p.z + 150);
      const parts: THREE.BufferGeometry[] = [];

      for (const s of [-1, 1]) {
        parts.push(box(6, legH, 6, s * gauge / 2, legH / 2, -26));       // waterside legs
        parts.push(box(6, legH, 6, s * gauge / 2, legH / 2, 30));        // landside legs
        parts.push(box(5, 5, 60, s * gauge / 2, legH * 0.5, 2));         // leg bracing
        parts.push(box(5, 5, 60, s * gauge / 2, legH * 0.82, 2));
      }
      parts.push(box(gauge + 14, 8, 10, 0, legH, -26));                  // portal beams
      parts.push(box(gauge + 14, 8, 10, 0, legH, 30));
      // the boom: long, thin, and cantilevered out over the basin
      parts.push(box(9, 6, reach, 0, legH + 14, -reach / 2 - 20));
      parts.push(box(9, 6, 60, 0, legH + 14, 40));                       // back reach
      parts.push(box(13, 16, 20, 0, legH + 23, 44));                     // machinery house
      // the A-frame the stays hang from, and the stays themselves
      parts.push(box(6, 40, 6, 0, legH + 34, 4));
      parts.push(box(4, 4, reach * 0.7, 0, legH + 42, -reach * 0.35 - 20));

      const merged = mergeAll(parts);
      merged.rotateY(p.ang);
      merged.translate(p.x, ground, p.z + 120);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.frustumCulled = false;
      g.add(mesh);

      // the whole footprint counts as solid up to the boom
      this.solids.push({
        x: p.x, z: p.z + 120,
        halfX: gauge / 2 + 20, halfZ: reach / 2 + 40,
        top: ground + legH + 40,
      });
    }
    return g;
  }

  /** Container stacks: colour comes from instance tinting, not a texture. */
  private buildContainers(spec: MapSpec): THREE.InstancedMesh {
    const rows: Array<{ x: number; y: number; z: number; h: number }> = [];
    for (const p of this.quayLine(90)) {
      for (let lane = 0; lane < 3; lane++) {
        if (Math.random() < 0.45) continue;
        const back = 230 + lane * 78;
        const x = p.x + rand(-24, 24), z = p.z + back;
        if (inland(x, z) > HARBOUR.quayDepth) continue;
        const h = Math.round(rand(1, 4)) * 9;
        rows.push({ x, y: spec.baseHeight(x, z), z, h });
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // no vertexColors here: setColorAt drives instanceColor, and asking for
    // vertex colours as well sends the shader looking for a geometry attribute
    // a BoxGeometry does not have, which renders every container black
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, rows.length);
    mesh.frustumCulled = false;
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    const palette = [0xa8452f, 0x2f5f8a, 0x7a7f52, 0x8a7a2f, 0x4a4f58];
    rows.forEach((r, i) => {
      d.position.set(r.x, r.y + r.h / 2, r.z);
      d.scale.set(rand(26, 34), r.h, rand(11, 13));
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      c.setHex(palette[(Math.random() * palette.length) | 0]).multiplyScalar(rand(0.7, 1.05));
      mesh.setColorAt(i, c);
      this.solids.push({ x: r.x, z: r.z, halfX: 17, halfZ: 7, top: r.y + r.h });
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  /** A few hulls at their berths, long enough to read as ships from altitude. */
  private buildShips(spec: MapSpec, hull: THREE.Material, deck: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    for (const p of this.quayLine(1500)) {
      if (Math.random() < 0.4) continue;
      const len = rand(210, 320), beam = rand(34, 46);
      const z = p.z - beam - 26;                       // moored alongside, in the water
      const parts = [
        boxAt(beam, 26, len, 0, 0, 0),
        boxAt(beam * 0.72, 20, 46, 0, 22, len * 0.3),  // superstructure
      ];
      const merged = mergeAll([parts[0]]);
      merged.rotateY(p.ang);
      merged.translate(p.x, HARBOUR.quayY - 9, z);
      g.add(new THREE.Mesh(merged, hull));

      const sup = mergeAll([parts[1]]);
      sup.rotateY(p.ang);
      sup.translate(p.x, HARBOUR.quayY - 9, z);
      g.add(new THREE.Mesh(sup, deck));

      this.solids.push({ x: p.x, z, halfX: len / 2, halfZ: beam, top: HARBOUR.quayY + 32 });
      void spec;
    }
    return g;
  }

  /** The mole light — the landmark that reads from altitude. */
  private buildLighthouse(mat: THREE.Material): { group: THREE.Group; beacon: THREE.PointLight } {
    const g = new THREE.Group();
    const tip = armTip();
    const tower = new THREE.CylinderGeometry(7, 12, 52, 10);
    tower.translate(0, 26, 0);
    const cap = new THREE.CylinderGeometry(9, 9, 9, 10);
    cap.translate(0, 56, 0);
    const merged = mergeAll([tower, cap]);
    merged.translate(tip.x, HARBOUR.arm.y, tip.z);
    g.add(new THREE.Mesh(merged, mat));

    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(5, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd08a }),
    );
    lamp.position.set(tip.x, HARBOUR.arm.y + 56, tip.z);
    g.add(lamp);

    const beacon = new THREE.PointLight(0xffc070, 2.4, 2600, 1.6);
    beacon.position.copy(lamp.position);
    g.add(beacon);

    this.solids.push({ x: tip.x, z: tip.z, halfX: 14, halfZ: 14, top: HARBOUR.arm.y + 62 });
    return { group: g, beacon };
  }

  private t = 0;
  update(dt: number) {
    this.t += dt;
    // a slow flash, the way a real harbour light works
    const phase = (this.t % 4) / 4;
    this.beacon.intensity = phase < 0.18 ? 3.6 : 0.5;
  }

  /** Solid height at a point, for terrain collision and AI avoidance. */
  solidHeight = (x: number, z: number): number => {
    let top = -1e6;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const bucket = this.grid.get((cx + i) * 100000 + (cz + j));
        if (!bucket) continue;
        for (const s of bucket) {
          if (Math.abs(x - s.x) <= s.halfX && Math.abs(z - s.z) <= s.halfZ && s.top > top) top = s.top;
        }
      }
    }
    return top;
  };

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number) {
  const b = new THREE.BoxGeometry(w, h, d);
  b.translate(x, y, z);
  return b;
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 1) return parts[0];
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const p of parts) {
    const a = p.toNonIndexed();
    pos.push(...Array.from(a.attributes.position.array as Float32Array));
    const n = a.attributes.normal;
    if (n) nrm.push(...Array.from(n.array as Float32Array));
    p.dispose();
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nrm.length === pos.length) merged.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  else merged.computeVertexNormals();
  return merged;
}

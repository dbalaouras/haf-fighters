import * as THREE from 'three';
import { HARBOUR, harbourWater, MapSpec, quayRing } from './maps';
import { rand } from '../core/mathx';

/**
 * The working half of Piraeus Dawn: gantry cranes along the quay, container
 * stacks behind them, hulls at their berths, and a lighthouse on the mole.
 *
 * Everything here is solid from the ground up, because obstacles are a height
 * field: registering a top makes the whole column beneath it solid. So the
 * crane booms and the bridge deck are things to go over or around, not gates to
 * fly through — there is no air under them, however much the geometry suggests
 * otherwise. Real underpasses would need the 3D solidity the volcano used to
 * carry, and that was deleted along with its tunnels.
 */

interface Berth {
  x: number; z: number; ang: number; len: number;
}

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
    const berths = this.buildPiers(spec);
    this.group.add(berths.group);
    this.group.add(this.buildShips(berths.berths, dark, rust));
    this.group.add(this.buildBridge(spec, steel, dark));

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

  /**
   * Points around the quay, each facing the water. The basin is closed now, so
   * this walks its perimeter rather than sweeping x, and drops anything that
   * lands on the mouth — that has to stay open.
   */
  private quayLine(step: number): Array<{ x: number; z: number; ang: number }> {
    return quayRing(step).filter((p) => harbourWater(p.x, p.z) > -260);
  }

  /**
   * A portal crane: legs, portal beams, and a boom cantilevered out over the
   * water. One merged geometry each, and solid, so the crane line is a wall of
   * obstacles down the waterfront rather than scenery to clip through.
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
        const back = 200 + lane * 78;
        // "behind" is away from the water, which the facing angle already knows
        const x = p.x - Math.sin(p.ang) * back + rand(-24, 24);
        const z = p.z - Math.cos(p.ang) * back;
        const inlandBy = -harbourWater(x, z);
        if (inlandBy < 0 || inlandBy > HARBOUR.quayDepth) continue;
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


  /**
   * Finger piers running out into the basin, which is what turns a shoreline
   * into a harbour: berths with water either side rather than one long wall.
   */
  private buildPiers(spec: MapSpec): { group: THREE.Group; berths: Berth[] } {
    const g = new THREE.Group();
    const berths: Berth[] = [];
    const deck = new THREE.MeshLambertMaterial({ color: 0x2c2f33, flatShading: true });
    const LEN = 330, HALF_W = 26;

    for (const p of this.quayLine(1150)) {
      const len = LEN * rand(0.8, 1.15);
      // out into the water, along the direction this stretch of quay faces
      const parts = [boxAt(HALF_W * 2, 16, len, 0, 0, -len / 2 - 40)];
      for (let i = 0; i < 5; i++) {
        // piles under the deck, so it does not read as a floating slab
        const t = -40 - (i + 0.5) * (len / 5);
        parts.push(boxAt(7, 40, 7, -HALF_W + 5, -20, t));
        parts.push(boxAt(7, 40, 7, HALF_W - 5, -20, t));
      }
      const merged = mergeAll(parts);
      merged.rotateY(p.ang);
      merged.translate(p.x, HARBOUR.quayY, p.z);
      g.add(new THREE.Mesh(merged, deck));

      this.solids.push({
        x: p.x, z: p.z - len / 2 - 40,
        halfX: HALF_W + 4, halfZ: len / 2 + 40, top: HARBOUR.quayY + 8,
      });
      // a berth either side of the finger
      berths.push({ x: p.x - HALF_W - 30, z: p.z - len / 2 - 40, ang: p.ang, len });
      if (Math.random() < 0.55) berths.push({ x: p.x + HALF_W + 30, z: p.z - len / 2 - 40, ang: p.ang, len });
    }
    void spec;
    return { group: g, berths };
  }

  /**
   * A plate-girder bridge over the channel: squat and industrial, where Neon
   * Delta has a suspension span. Lit along the deck for the same reason that
   * one is — a dark girder over dark water at dawn is invisible until you are
   * in it, and it blocks the channel from the water all the way up.
   */
  private buildBridge(spec: MapSpec, steel: THREE.Material, dark: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const n = HARBOUR.neck;
    const cx = (n.ax + n.bx) / 2, cz = (n.az + n.bz) / 2;
    const ang = Math.atan2(n.bz - n.az, n.bx - n.ax);
    const span = n.w * 2 + 620;
    const deckY = HARBOUR.bridge.deckY;

    const deck = mergeAll([
      boxAt(span, 9, 76, 0, 0, 0),
      boxAt(span, 16, 8, 0, 10, -34),
      boxAt(span, 16, 8, 0, 10, 34),
    ]);
    deck.rotateY(-ang);
    deck.translate(cx, deckY, cz);
    g.add(new THREE.Mesh(deck, steel));

    // pier bents spaced across the span, in the neck's own frame
    for (const t of [-1, -0.4, 0.4, 1]) {
      const dx = t * (n.w + 200);
      const wx = cx + dx * Math.cos(ang + Math.PI / 2);
      const wz = cz + dx * Math.sin(ang + Math.PI / 2);
      const ground = spec.baseHeight(wx, wz);
      const h = deckY - ground;
      if (h <= 0) continue;
      const pier = mergeAll([
        boxAt(32, h, 28, 0, h / 2, 0),
        boxAt(50, 10, 38, 0, h - 4, 0),
      ]);
      pier.translate(wx, ground, wz);
      g.add(new THREE.Mesh(pier, dark));
      this.solids.push({ x: wx, z: wz, halfX: 24, halfZ: 20, top: ground + h });
    }

    // deck lamps, so the span reads against the water before you are committed
    const lampGeo = new THREE.SphereGeometry(3.4, 6, 5);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    for (let i = -6; i <= 6; i++) {
      const dx = i * (span / 13);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(cx + dx * Math.cos(ang + Math.PI / 2), deckY + 22, cz + dx * Math.sin(ang + Math.PI / 2));
      g.add(lamp);
    }
    const glow = new THREE.PointLight(0xffc890, 1.6, 1800, 1.5);
    glow.position.set(cx, deckY + 30, cz);
    g.add(glow);

    this.solids.push({ x: cx, z: cz, halfX: span / 2, halfZ: span / 2, top: deckY + 18 });
    return g;
  }

  /** A few hulls at their berths, long enough to read as ships from altitude. */
  private buildShips(berths: Berth[], hull: THREE.Material, deckMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    for (const b of berths) {
      if (Math.random() < 0.35) continue;                 // not every berth is taken
      const len = b.len * rand(0.7, 0.95), beam = rand(30, 42);
      const parts = [boxAt(beam, 30, len, 0, 0, 0)];
      const merged = mergeAll(parts);
      merged.rotateY(b.ang);
      merged.translate(b.x, HARBOUR.quayY - 11, b.z);
      g.add(new THREE.Mesh(merged, hull));

      const sup = mergeAll([boxAt(beam * 0.7, 24, 44, 0, 26, len * 0.28)]);
      sup.rotateY(b.ang);
      sup.translate(b.x, HARBOUR.quayY - 11, b.z);
      g.add(new THREE.Mesh(sup, deckMat));

      this.solids.push({ x: b.x, z: b.z, halfX: beam, halfZ: len / 2, top: HARBOUR.quayY + 34 });
    }
    return g;
  }

  /** The mole light — the landmark that reads from altitude. */
  private buildLighthouse(mat: THREE.Material): { group: THREE.Group; beacon: THREE.PointLight } {
    const g = new THREE.Group();
    // on the headland beside the mouth, which is the thing worth marking
    const m = HARBOUR.mouth;
    const ang = Math.atan2(m.bz - m.az, m.bx - m.ax);
    const tip = {
      x: m.ax + Math.cos(ang + Math.PI / 2) * (m.w + 130),
      z: m.az + Math.sin(ang + Math.PI / 2) * (m.w + 130),
    };
    const tower = new THREE.CylinderGeometry(7, 12, 52, 10);
    tower.translate(0, 26, 0);
    const cap = new THREE.CylinderGeometry(9, 9, 9, 10);
    cap.translate(0, 56, 0);
    const merged = mergeAll([tower, cap]);
    merged.translate(tip.x, HARBOUR.quayY, tip.z);
    g.add(new THREE.Mesh(merged, mat));

    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(5, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd08a }),
    );
    lamp.position.set(tip.x, HARBOUR.quayY + 56, tip.z);
    g.add(lamp);

    const beacon = new THREE.PointLight(0xffc070, 2.4, 2600, 1.6);
    beacon.position.copy(lamp.position);
    g.add(beacon);

    this.solids.push({ x: tip.x, z: tip.z, halfX: 14, halfZ: 14, top: HARBOUR.quayY + 62 });
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

import * as THREE from 'three';
import { MapSpec, RIVER, riverOffset } from './maps';
import { rand } from '../core/mathx';

interface Block {
  x: number; z: number;
  halfX: number; halfZ: number;
  ground: number;
  height: number;
  top: number;
}

const _sphere = new THREE.Sphere();

const BRIDGE_X = 0;
const BRIDGE_HALF_WIDTH = 240;   // keep towers clear of buildings
const DECK_Y = 78;

/**
 * A night city: instanced towers with lit windows, plus a suspension bridge over
 * the river. Buildings are registered with the terrain as solid, so they collide,
 * block the camera and are avoided by the AI without the terrain mesh having to
 * model them.
 */
export class City {
  readonly group = new THREE.Group();
  private blocks: Block[] = [];
  /** blocks bucketed into a coarse grid, so height lookups stay O(1) */
  private grid = new Map<number, Block[]>();
  private readonly cell = 600;

  /**
   * Per height class: the mesh, every instance's matrix, and a bounding sphere
   * each, so the optional cull can repack the visible ones into the front of
   * the buffer and lower `count`. Three meshes throughout — the renderer is
   * bound by submission rather than fill here, so splitting the towers into
   * per-cell meshes would cost more than it saved.
   */
  private tiers: Array<{
    mesh: THREE.InstancedMesh;
    matrices: Float32Array;
    centres: Float32Array;   // x, y, z, radius per instance
  }> = [];
  private culling = false;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();

  constructor(spec: MapSpec, extent = 11000) {
    this.buildBlocks(spec, extent);
    this.group.add(...this.buildTowers());
    this.group.add(this.buildBridge());
    this.group.add(this.buildStreetGlow());
  }

  /* ---------------- layout ---------------- */

  private key(x: number, z: number): number {
    return Math.floor(x / this.cell) * 100000 + Math.floor(z / this.cell);
  }

  private buildBlocks(spec: MapSpec, extent: number) {
    const step = 260;
    for (let x = -extent; x <= extent; x += step) {
      for (let z = -extent; z <= extent; z += step) {
        // leave the river, its embankments and the bridge approach clear
        if (riverOffset(x, z) < RIVER.halfWidth + 220) continue;
        if (Math.abs(x - BRIDGE_X) < BRIDGE_HALF_WIDTH && riverOffset(x, z) < 820) continue;
        // thin out towards the edge of the map so it fades into open ground
        const density = 1 - Math.min(1, Math.hypot(x, z) / extent);
        if (Math.random() > 0.35 + density * 0.6) continue;

        const ground = spec.baseHeight(x, z);
        if (ground < 12) continue;

        // taller towers downtown, low-rise on the outskirts
        const core = 1 - Math.min(1, Math.hypot(x, z) / 5200);
        const h = rand(40, 90) + core * core * rand(30, 190);
        const jx = x + rand(-40, 40), jz = z + rand(-40, 40);
        const block: Block = {
          x: jx, z: jz,
          halfX: rand(38, 78), halfZ: rand(38, 78),
          ground, height: h, top: ground + h,
        };
        this.blocks.push(block);
        const k = this.key(jx, jz);
        const bucket = this.grid.get(k);
        if (bucket) bucket.push(block); else this.grid.set(k, [block]);
      }
    }
  }

  /* ---------------- towers ---------------- */

  /** Dark facade with a random scatter of lit windows, used as colour and emission. */
  private facadeTexture(cols: number, rows: number): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = cols * 8;
    cv.height = rows * 8;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#0a0c12';
    g.fillRect(0, 0, cv.width, cv.height);
    const lights = ['#ffd98a', '#ffc46a', '#cfe4ff', '#fff3c4'];
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        if (Math.random() > 0.42) continue;
        g.fillStyle = lights[(Math.random() * lights.length) | 0];
        g.globalAlpha = rand(0.45, 1);
        g.fillRect(cx * 8 + 2, cy * 8 + 2, 4, 5);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  /**
   * Three height classes, each its own instanced mesh, so window rows stay roughly
   * square instead of being stretched by the instance scale.
   */
  private buildTowers(): THREE.InstancedMesh[] {
    const classes = [
      { name: 'low', max: 110, rows: 6 },
      { name: 'mid', max: 200, rows: 12 },
      { name: 'high', max: Infinity, rows: 22 },
    ];
    const dummy = new THREE.Object3D();
    const meshes: THREE.InstancedMesh[] = [];

    for (const cls of classes) {
      const prevMax = classes[classes.indexOf(cls) - 1]?.max ?? 0;
      const members = this.blocks.filter((b) => b.height > prevMax && b.height <= cls.max);
      if (!members.length) continue;

      const geo = new THREE.BoxGeometry(1, 1, 1);
      const tex = this.facadeTexture(8, cls.rows);
      const mat = new THREE.MeshLambertMaterial({
        map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.15,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, members.length);
      mesh.frustumCulled = false;   // whole-object culling is useless at this size

      const matrices = new Float32Array(members.length * 16);
      const centres = new Float32Array(members.length * 4);
      members.forEach((b, i) => {
        dummy.position.set(b.x, b.ground + b.height / 2, b.z);
        dummy.scale.set(b.halfX * 2, b.height, b.halfZ * 2);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        dummy.matrix.toArray(matrices, i * 16);
        centres[i * 4] = b.x;
        centres[i * 4 + 1] = b.ground + b.height / 2;
        centres[i * 4 + 2] = b.z;
        centres[i * 4 + 3] = Math.hypot(b.halfX, b.halfZ, b.height / 2);
      });
      mesh.instanceMatrix.needsUpdate = true;
      meshes.push(mesh);
      this.tiers.push({ mesh, matrices, centres });
    }
    return meshes;
  }

  /* ---------------- bridge ---------------- */

  private buildBridge(): THREE.Group {
    const g = new THREE.Group();
    const centreZ = RIVER.meander(BRIDGE_X);
    const span = 2100;

    // Lambert alone leaves this black at night, so the steel carries its own
    // emission — the bridge is the landmark of the map and has to read from the air.
    const steel = new THREE.MeshLambertMaterial({
      color: 0x6d7a92, emissive: 0x1c2534, flatShading: true,
    });
    const lit = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff5a4a });

    // deck
    const deck = new THREE.Mesh(new THREE.BoxGeometry(150, 9, span), steel);
    deck.position.set(BRIDGE_X, DECK_Y, centreZ);
    g.add(deck);

    // approach ramps down to the embankments
    for (const side of [-1, 1]) {
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(150, 9, 900), steel);
      ramp.position.set(BRIDGE_X, DECK_Y - 14, centreZ + side * (span / 2 + 430));
      ramp.rotation.x = side * 0.035;
      g.add(ramp);
    }

    // towers and their cables
    for (const side of [-1, 1]) {
      const tz = centreZ + side * span * 0.26;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(34, 210, 34), steel);
      tower.position.set(BRIDGE_X, DECK_Y + 210 / 2 - 20, tz);
      g.add(tower);

      const crossbar = new THREE.Mesh(new THREE.BoxGeometry(150, 12, 22), steel);
      crossbar.position.set(BRIDGE_X, DECK_Y + 150, tz);
      g.add(crossbar);

      // beacon on top
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(9, 8, 6), beaconMat);
      beacon.position.set(BRIDGE_X, DECK_Y + 196, tz);
      g.add(beacon);
    }

    g.add(this.buildCables(centreZ, span));

    // deck lighting, so it reads from the air
    const lampGeo = new THREE.SphereGeometry(5.5, 6, 5);
    for (let i = -span / 2; i <= span / 2; i += 70) {
      for (const side of [-1, 1]) {
        const lamp = new THREE.Mesh(lampGeo, lit);
        lamp.position.set(BRIDGE_X + side * 68, DECK_Y + 14, centreZ + i);
        g.add(lamp);
      }
    }

    // a warm haze along the deck, so the span is visible from a long way out
    const glowPts: number[] = [];
    for (let i = -span / 2 - 700; i <= span / 2 + 700; i += 36) {
      glowPts.push(BRIDGE_X, DECK_Y + 16, centreZ + i);
    }
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
    g.add(new THREE.Points(glowGeo, new THREE.PointsMaterial({
      color: 0xffc46a, size: 42, sizeAttenuation: true,
      transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending,
    })));

    return g;
  }

  /** Main suspension cables as a sagging line on each side. */
  private buildCables(centreZ: number, span: number): THREE.LineSegments {
    const pts: number[] = [];
    const towerZ = span * 0.26;
    const topY = DECK_Y + 150;
    const sagAt = (z: number) => {
      const t = Math.abs(z) / towerZ;
      return t <= 1
        ? DECK_Y + 20 + (topY - DECK_Y - 20) * t * t          // sag between the towers
        : topY - (topY - DECK_Y) * Math.min(1, (Math.abs(z) - towerZ) / (span / 2 - towerZ));
    };
    for (const side of [-1, 1]) {
      let prev: [number, number, number] | null = null;
      for (let z = -span / 2; z <= span / 2; z += 40) {
        const p: [number, number, number] = [side * 66, sagAt(z), centreZ + z];
        if (prev) pts.push(...prev, ...p);
        prev = p;
      }
      // hangers down to the deck
      for (let z = -towerZ; z <= towerZ; z += 80) {
        pts.push(side * 66, sagAt(z), centreZ + z, side * 66, DECK_Y + 5, centreZ + z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fb2d4 }));
  }

  /** A faint warm haze over the streets, which is most of the night-city look. */
  private buildStreetGlow(): THREE.Points {
    const n = 2200;
    const pos = new Float32Array(n * 3);
    let k = 0;
    for (let i = 0; i < n && k < n; i++) {
      const x = rand(-10000, 10000), z = rand(-10000, 10000);
      if (riverOffset(x, z) < RIVER.halfWidth + 200) continue;
      pos[k * 3] = x;
      pos[k * 3 + 1] = RIVER.bankHeight + rand(4, 26);
      pos[k * 3 + 2] = z;
      k++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, k * 3), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const mat = new THREE.PointsMaterial({
      color: 0xffb45c, size: 26, sizeAttenuation: true,
      transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  /* ---------------- collision ---------------- */

  /** Solid height at a point: the top of a building if inside one, else far below. */
  /**
   * Optionally skip the towers that are off screen, repacking the survivors into
   * the front of each instance buffer. Off by default: on a fast machine there is
   * nothing to gain (measured 0.640 ms culled against 0.633 ms not), so this only
   * exists for hardware that cannot carry all 3,400 instances.
   *
   * Two details make or break it, and getting either wrong shows up as towers
   * appearing late at the edge of the screen while you bank:
   *
   *  - the camera matrices have to be refreshed here. `matrixWorldInverse` is
   *    otherwise only rebuilt inside `renderer.render()`, which runs after this,
   *    so the frustum would be a frame behind — and an F-16 rolls 3.5 degrees in
   *    a frame.
   *  - the visible set has to be rebuilt every frame. Recomputing it only after
   *    the camera had moved a bit was worth 0.1 ms and cost several degrees of
   *    stale frustum on top of the above.
   */
  update(camera: THREE.Camera, enabled: boolean) {
    if (!enabled) {
      if (this.culling) this.drawEverything();
      return;
    }
    this.culling = true;

    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);

    for (const { mesh, matrices, centres } of this.tiers) {
      const total = centres.length / 4;
      const dst = mesh.instanceMatrix.array as Float32Array;
      let n = 0;
      for (let i = 0; i < total; i++) {
        const o = i * 4;
        _sphere.center.set(centres[o], centres[o + 1], centres[o + 2]);
        _sphere.radius = centres[o + 3];
        if (!this.frustum.intersectsSphere(_sphere)) continue;
        dst.set(matrices.subarray(i * 16, i * 16 + 16), n * 16);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Put every instance back, for when the setting is switched off mid-match. */
  private drawEverything() {
    this.culling = false;
    for (const { mesh, matrices, centres } of this.tiers) {
      (mesh.instanceMatrix.array as Float32Array).set(matrices);
      mesh.count = centres.length / 4;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** How many tower instances are being drawn, and out of how many. */
  get instanceLoad(): { drawn: number; total: number } {
    let drawn = 0, total = 0;
    for (const t of this.tiers) { drawn += t.mesh.count; total += t.centres.length / 4; }
    return { drawn, total };
  }

  solidHeight = (x: number, z: number): number => {
    let best = -1e6;
    // a footprint can straddle a cell boundary, so check the neighbours too
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.grid.get(this.key(x + dx * this.cell, z + dz * this.cell));
        if (!bucket) continue;
        for (const b of bucket) {
          if (Math.abs(x - b.x) <= b.halfX && Math.abs(z - b.z) <= b.halfZ) {
            if (b.top > best) best = b.top;
          }
        }
      }
    }
    // the bridge deck and towers are solid too
    if (Math.abs(x - BRIDGE_X) <= 75) {
      const dz = Math.abs(z - RIVER.meander(BRIDGE_X));
      if (dz <= 1050) best = Math.max(best, DECK_Y + 5);
    }
    return best;
  };

  get buildingCount(): number { return this.blocks.length; }

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

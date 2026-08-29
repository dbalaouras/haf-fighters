import * as THREE from 'three';
import { rand } from '../core/mathx';

/**
 * A solid volcano: a rock cone with a lava-filled crater at the summit.
 *
 * It used to be hollow, with a chamber inside and three tunnels bored through
 * the shell to fly in by. That needed an analytic 3D solidity test, because a
 * heightmap cannot say "solid rock here, open air below it". Solid rock is
 * single-valued, so the whole thing is now just a height function — the same
 * kind of obstacle the city towers are — and the surface you see is the surface
 * you hit.
 */

export const V = {
  /**
   * The rim deliberately sits well below the altitude band the AI fights in
   * (CFG.ai.preferredAltitude). At 1500 m the lip was level with them and they
   * clipped it constantly — 19 of 22 uncredited losses in a 13 minute sample
   * were within 80 m of the same point on the rim.
   */
  height: 1150,
  /** outer cone: radius at the waterline tapering to the rim */
  outerBase: 3000,
  outerRim: 1750,
  /** summit crater: mouth just inside the rim, narrowing down to the lava */
  craterMouth: 1520,
  craterFloor: 720,
  /** height of the lava surface at the bottom of the crater */
  lava: 820,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * The whole volcano, as one height above sea level. Everything else — the mesh,
 * collision, AI avoidance, the camera floor — is derived from this, so they
 * cannot disagree with each other.
 */
export function surfaceY(r: number): number {
  if (r >= V.outerBase) return 0;
  if (r > V.outerRim) {
    // outer flank, falling away to the waterline
    return ((V.outerBase - r) / (V.outerBase - V.outerRim)) * V.height;
  }
  if (r > V.craterMouth) return V.height;              // the rim itself
  if (r > V.craterFloor) {
    // crater wall, dropping from the rim to the lava
    return lerp(V.lava, V.height, (r - V.craterFloor) / (V.craterMouth - V.craterFloor));
  }
  return V.lava;
}

export class Volcano {
  readonly group = new THREE.Group();
  private lavaMat: THREE.MeshBasicMaterial;
  private glow: THREE.PointLight;
  private t = 0;

  constructor() {
    const rock = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.group.add(new THREE.Mesh(this.buildShell(), rock));

    // lava floor, lit from within
    this.lavaMat = new THREE.MeshBasicMaterial({ color: 0xff6a1e });
    const disc = new THREE.CircleGeometry(V.craterFloor * 1.03, 48);
    disc.rotateX(-Math.PI / 2);
    disc.translate(0, V.lava, 0);
    this.group.add(new THREE.Mesh(disc, this.lavaMat));

    this.glow = new THREE.PointLight(0xff7a2a, 3.4, 5200, 1.4);
    this.glow.position.set(0, V.lava + 140, 0);
    this.group.add(this.glow);

    this.group.add(this.buildEmbers());
  }

  /* ---------------- geometry ---------------- */

  /**
   * One surface of revolution over surfaceY(). Rings are concentrated where the
   * profile bends — the crater wall and the rim — so the silhouette stays crisp
   * without paying for detail on the long straight flank.
   */
  private buildShell(): THREE.BufferGeometry {
    const pos: number[] = [];
    const col: number[] = [];
    const AZ = 96;

    const rockLow = new THREE.Color(0x5a4c40);
    const rockHigh = new THREE.Color(0x6b5a4a);
    const craterRock = new THREE.Color(0x2e2119);
    const hot = new THREE.Color(0x7a2f14);

    const radii: number[] = [];
    const span = (from: number, to: number, steps: number) => {
      for (let i = 0; i < steps; i++) radii.push(lerp(from, to, i / steps));
    };
    span(V.craterFloor, V.craterMouth, 10);   // crater wall
    span(V.craterMouth, V.outerRim, 3);       // rim
    span(V.outerRim, V.outerBase, 26);        // outer flank
    radii.push(V.outerBase);

    // rough the surface so it does not read as a machined cone
    const rough = (th: number, r: number) => Math.sin(th * 7 + r * 0.004) * 34 + Math.sin(th * 13) * 18;

    /** rock colour at a radius: dark and scorched in the crater, weathered outside */
    const tone = (r: number, th: number): THREE.Color => {
      const shade = 0.66 + 0.34 * (0.5 + 0.5 * Math.sin(th * 7 + r * 0.004));
      if (r <= V.craterMouth) {
        // glowing toward the lava
        const t = clamp01((V.craterMouth - r) / (V.craterMouth - V.craterFloor));
        return craterRock.clone().lerp(hot, t * 0.75).multiplyScalar(shade);
      }
      const t = clamp01((r - V.outerRim) / (V.outerBase - V.outerRim));
      return rockHigh.clone().lerp(rockLow, t).multiplyScalar(shade);
    };

    const vert = (r: number, th: number, jitter: number) => {
      const rr = r + jitter;
      return new THREE.Vector3(Math.cos(th) * rr, surfaceY(r), Math.sin(th) * rr);
    };

    for (let i = 0; i < AZ; i++) {
      const th0 = (i / AZ) * Math.PI * 2;
      const th1 = ((i + 1) / AZ) * Math.PI * 2;

      for (let j = 0; j < radii.length - 1; j++) {
        const r0 = radii[j], r1 = radii[j + 1];
        // the flank is roughened; the crater floor edge is left clean so the
        // lava disc meets the rock without gaps
        const k = r0 > V.craterMouth ? 1 : 0.45;
        const a = vert(r0, th0, rough(th0, r0) * k);
        const b = vert(r0, th1, rough(th1, r0) * k);
        const c = vert(r1, th1, rough(th1, r1) * k);
        const d = vert(r1, th0, rough(th0, r1) * k);
        const ca = tone(r0, th0), cb = tone(r1, th0);

        // wound a-b-c / a-c-d so the face normal comes out pointing away from
        // the rock: outward and up on the flank, inward and up in the crater
        const tri = (
          p0: THREE.Vector3, c0: THREE.Color,
          p1: THREE.Vector3, c1: THREE.Color,
          p2: THREE.Vector3, c2: THREE.Color,
        ) => {
          pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
          col.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
        };
        tri(a, ca, b, ca, c, cb);
        tri(a, ca, c, cb, d, cb);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /** Embers drifting up out of the crater. */
  private buildEmbers(): THREE.Points {
    const n = 700;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * V.craterMouth * 0.9;
      p[i * 3] = Math.cos(a) * r;
      p[i * 3 + 1] = rand(V.lava, V.height + 900);
      p[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, V.height / 2, 0), 6000);
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xff9a4a, size: 22, sizeAttenuation: true,
      transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    pts.frustumCulled = false;
    return pts;
  }

  update(dt: number) {
    this.t += dt;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 0.7);
    this.lavaMat.color.setRGB(1, 0.32 + pulse * 0.16, 0.08 + pulse * 0.06);
    this.glow.intensity = 3.0 + pulse * 1.2;
  }

  /* ---------------- solidity ---------------- */

  /**
   * Registered with the terrain as an obstacle height, exactly like the city
   * towers. An arrow property so it can be passed as a bare function.
   */
  heightAt = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    if (r >= V.outerBase) return -1e6;   // leave the seabed alone out here
    return surfaceY(r);
  };

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
  }
}

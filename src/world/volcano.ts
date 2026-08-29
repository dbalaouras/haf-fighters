import * as THREE from 'three';
import { rand } from '../core/mathx';

/**
 * A hollow volcano you can fly inside.
 *
 * A heightmap cannot express this — height(x,z) is single-valued, so it has no way
 * to say "solid rock here, open air below it". The cone is therefore its own mesh
 * with an analytic 3D solidity test behind it: outside the outer cone or inside the
 * chamber is open air, the shell between them is rock, and three bored tunnels punch
 * straight through the shell.
 */

export const V = {
  /**
   * The rim deliberately sits well below the altitude band the AI fights in
   * (CFG.ai.preferredAltitude). At 1500 m the lip was level with them and they
   * clipped it constantly — 19 of 22 uncredited losses in a 13 minute sample were
   * within 80 m of the same point on the rim.
   */
  height: 1150,
  lava: 150,
  /** outer cone: radius at the waterline tapering to the rim */
  outerBase: 3000,
  outerRim: 1750,
  /** inner chamber: radius at the lava floor widening to the crater mouth */
  innerBase: 1100,
  innerRim: 1400,
  /** entrances bored radially through the shell */
  tunnelY: 700,
  tunnelRadius: 260,
  tunnelAzimuths: [20, 140, 260].map((d) => (d * Math.PI) / 180),
  /** how far out the volcano claims the world from the heightmap */
  footprint: 3060,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** outer surface radius at an altitude */
export const outerR = (y: number) => lerp(V.outerBase, V.outerRim, clamp01(y / V.height));
/** chamber radius at an altitude */
export const innerR = (y: number) =>
  lerp(V.innerBase, V.innerRim, clamp01((y - V.lava) / (V.height - V.lava)));

export class Volcano {
  readonly group = new THREE.Group();
  private lavaMat: THREE.MeshBasicMaterial;
  private glow: THREE.PointLight;
  private t = 0;

  constructor() {
    const rock = new THREE.MeshLambertMaterial({
      vertexColors: true, flatShading: true, side: THREE.DoubleSide,
    });
    this.group.add(new THREE.Mesh(this.buildShell(), rock));

    // lava floor, lit from within
    this.lavaMat = new THREE.MeshBasicMaterial({ color: 0xff6a1e });
    const disc = new THREE.CircleGeometry(V.innerBase * 1.02, 48);
    disc.rotateX(-Math.PI / 2);
    disc.translate(0, V.lava, 0);
    this.group.add(new THREE.Mesh(disc, this.lavaMat));

    this.glow = new THREE.PointLight(0xff7a2a, 3.4, 5200, 1.4);
    this.glow.position.set(0, V.lava + 260, 0);
    this.group.add(this.glow);

    this.group.add(this.buildEmbers());
  }

  /* ---------------- geometry ---------------- */

  private inTunnelAt(theta: number, y: number, r: number): boolean {
    for (const az of V.tunnelAzimuths) {
      let d = theta - az;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      // arc distance across the bore at this radius, plus the vertical offset
      const across = Math.abs(d) * r;
      if (Math.hypot(across, y - V.tunnelY) < V.tunnelRadius) return true;
    }
    return false;
  }

  /**
   * Outer cone, inner chamber, crater rim and the tunnel tubes, as one buffer.
   * Quads that fall inside a bore are simply not emitted, which is how the
   * openings get cut without any CSG.
   */
  private buildShell(): THREE.BufferGeometry {
    const pos: number[] = [];
    const col: number[] = [];
    const AZ = 96, LEV = 30;

    const outside = new THREE.Color(0x5a4c40);
    const inside = new THREE.Color(0x241c18);
    const hot = new THREE.Color(0x6e2a12);

    const push = (x: number, y: number, z: number, c: THREE.Color) => {
      pos.push(x, y, z);
      col.push(c.r, c.g, c.b);
    };
    const quad = (
      a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
      ca: THREE.Color, cb: THREE.Color,
    ) => {
      push(a.x, a.y, a.z, ca); push(b.x, b.y, b.z, ca); push(c.x, c.y, c.z, cb);
      push(a.x, a.y, a.z, ca); push(c.x, c.y, c.z, cb); push(d.x, d.y, d.z, cb);
    };

    const v = (r: number, th: number, y: number, jitter = 0) =>
      new THREE.Vector3(
        Math.cos(th) * (r + jitter), y, Math.sin(th) * (r + jitter),
      );

    // rough the surface slightly so it does not read as a machined cone
    const rough = (th: number, y: number) => Math.sin(th * 7 + y * 0.004) * 34 + Math.sin(th * 13) * 18;

    for (let i = 0; i < AZ; i++) {
      const th0 = (i / AZ) * Math.PI * 2;
      const th1 = ((i + 1) / AZ) * Math.PI * 2;
      const thm = (th0 + th1) / 2;

      for (let j = 0; j < LEV; j++) {
        const y0 = (j / LEV) * V.height;
        const y1 = ((j + 1) / LEV) * V.height;
        const ym = (y0 + y1) / 2;

        // --- outer face ---
        const ro0 = outerR(y0), ro1 = outerR(y1);
        if (!this.inTunnelAt(thm, ym, outerR(ym))) {
          // vary the tone with the same function that roughens the surface, so
          // ridges and gullies read as different rock rather than one flat brown
          const sh0 = 0.66 + 0.34 * (0.5 + 0.5 * Math.sin(th0 * 7 + y0 * 0.004));
          const sh1 = 0.66 + 0.34 * (0.5 + 0.5 * Math.sin(th0 * 7 + y1 * 0.004));
          const cA = outside.clone().lerp(hot, clamp01((y0 - 900) / 900) * 0.35).multiplyScalar(sh0);
          const cB = outside.clone().lerp(hot, clamp01((y1 - 900) / 900) * 0.35).multiplyScalar(sh1);
          quad(
            v(ro0, th0, y0, rough(th0, y0)), v(ro0, th1, y0, rough(th1, y0)),
            v(ro1, th1, y1, rough(th1, y1)), v(ro1, th0, y1, rough(th0, y1)),
            cA, cB,
          );
        }

        // --- inner chamber face ---
        if (y1 > V.lava) {
          const iy0 = Math.max(y0, V.lava), iy1 = Math.max(y1, V.lava);
          const ri0 = innerR(iy0), ri1 = innerR(iy1);
          const imy = (iy0 + iy1) / 2;
          if (!this.inTunnelAt(thm, imy, innerR(imy))) {
            // the chamber wall needs relief too, or it reads as a smooth cylinder
            const shade = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(th0 * 5 + iy0 * 0.006));
            const cA = inside.clone().lerp(hot, clamp01(1 - (iy0 - V.lava) / 700)).multiplyScalar(shade);
            const cB = inside.clone().lerp(hot, clamp01(1 - (iy1 - V.lava) / 700)).multiplyScalar(shade);
            quad(
              v(ri0, th1, iy0, rough(th1, iy0) * 0.7), v(ri0, th0, iy0, rough(th0, iy0) * 0.7),
              v(ri1, th0, iy1, rough(th0, iy1) * 0.7), v(ri1, th1, iy1, rough(th1, iy1) * 0.7),
              cA, cB,
            );
          }
        }
      }

      // --- crater rim, joining inner to outer ---
      quad(
        v(innerR(V.height), th0, V.height), v(innerR(V.height), th1, V.height),
        v(outerR(V.height), th1, V.height), v(outerR(V.height), th0, V.height),
        outside, outside,
      );
    }

    // --- tunnel tubes ---
    const RING = 20;
    for (const az of V.tunnelAzimuths) {
      const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(dir, up).normalize();
      const rIn = innerR(V.tunnelY), rOut = outerR(V.tunnelY);

      for (let k = 0; k < RING; k++) {
        const a0 = (k / RING) * Math.PI * 2;
        const a1 = ((k + 1) / RING) * Math.PI * 2;
        const p = (ang: number, dist: number) => new THREE.Vector3()
          .addScaledVector(dir, dist)
          .addScaledVector(side, Math.cos(ang) * V.tunnelRadius)
          .addScaledVector(up, V.tunnelY + Math.sin(ang) * V.tunnelRadius);
        quad(p(a0, rIn), p(a1, rIn), p(a1, rOut), p(a0, rOut), inside, outside);
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
      const r = Math.sqrt(Math.random()) * V.innerRim * 0.9;
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

  contains(x: number, z: number): boolean {
    return x * x + z * z < V.footprint * V.footprint;
  }

  /** Outer surface height, so the AI and the camera treat it as a mountain. */
  heightAt(x: number, z: number): number {
    const r = Math.hypot(x, z);
    if (r >= V.outerBase) return -1e6;
    if (r <= V.outerRim) return V.height;
    // invert the outer taper
    return ((V.outerBase - r) / (V.outerBase - V.outerRim)) * V.height;
  }

  private inBore(x: number, y: number, z: number, pad: number): boolean {
    for (const az of V.tunnelAzimuths) {
      const dx = Math.cos(az), dz = Math.sin(az);
      // distance from the bore axis: perpendicular in plan, plus vertical offset
      const across = Math.abs(x * dz - z * dx);
      const along = x * dx + z * dz;
      if (along < 0) continue;                       // the bore only runs one way out
      if (Math.hypot(across, y - V.tunnelY) < V.tunnelRadius - pad) return true;
    }
    return false;
  }

  /** True if this point is inside rock. */
  isSolid(x: number, y: number, z: number, clearance: number): boolean {
    if (y > V.height + clearance) return false;      // over the rim
    const r = Math.hypot(x, z);
    if (r > outerR(y) - clearance) return false;     // outside the cone
    if (y < V.lava + clearance) return true;         // the lava floor is fatal
    if (r < innerR(y) - clearance) return false;     // open chamber
    return !this.inBore(x, y, z, clearance);
  }

  /** Effective floor below a point, so the chase camera behaves inside the chamber. */
  floorAt(x: number, y: number, z: number): number {
    const r = Math.hypot(x, z);
    if (y <= V.height && y > V.lava && r < innerR(y)) return V.lava;
    if (this.inBore(x, y, z, 0)) return V.tunnelY - V.tunnelRadius;
    return this.heightAt(x, z);
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
  }
}

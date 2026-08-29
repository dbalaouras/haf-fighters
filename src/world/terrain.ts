import * as THREE from 'three';
import { CFG } from '../core/config';
import { clamp01, smoothstep } from '../core/mathx';

/* ---- cheap deterministic value noise (no deps, same result on CPU & mesh build) ---- */

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smoothstep(xf), v = smoothstep(yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x: number, y: number, octaves = 5): number {
  let sum = 0, amp = 0.5, norm = 0, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(fx, fy) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03; fy *= 1.97;
  }
  return sum / norm;
}

/** A few hand-placed island cores keep the map readable instead of uniform noise soup. */
const ISLANDS: ReadonlyArray<{ x: number; z: number; r: number; h: number }> = [
  { x: 0, z: 0, r: 3100, h: 1500 },          // central massif — the landmark you navigate by
  { x: -6200, z: -3400, r: 2100, h: 900 },
  { x: 5600, z: 3900, r: 2400, h: 1050 },
  { x: -4200, z: 6100, r: 1500, h: 620 },
  { x: 6900, z: -6200, r: 1700, h: 740 },
  { x: -8200, z: 1200, r: 1200, h: 480 },
];

export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly water: THREE.Mesh;
  private waterMat: THREE.ShaderMaterial;

  constructor() {
    const size = CFG.world.size;
    const seg = CFG.world.segments;

    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.height(x, z);
      pos.setY(i, h);

      // vertex colouring: beach -> scrub -> forest -> rock -> snow
      const tint = fbm(x * 0.002, z * 0.002, 2) * 0.18 - 0.09;
      if (h < 8) c.setRGB(0.72, 0.66, 0.45);
      else if (h < 90) c.setRGB(0.36 + tint, 0.48 + tint, 0.26);
      else if (h < 420) c.setRGB(0.24 + tint, 0.36 + tint, 0.21);
      else if (h < 850) c.setRGB(0.36 + tint, 0.34 + tint, 0.31);
      else if (h < 1180) c.setRGB(0.48, 0.47, 0.46);
      else {
        const s = clamp01((h - 1180) / 260);
        c.setRGB(0.48 + 0.45 * s, 0.47 + 0.46 * s, 0.46 + 0.48 * s);
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;

    /* ---- ocean: flat plane, waves faked analytically in the fragment shader ---- */
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSun: { value: new THREE.Vector3(0.45, 0.62, 0.65).normalize() },
        uDeep: { value: new THREE.Color(0x11405f) },
        uShallow: { value: new THREE.Color(0x49a8cc) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSun;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        varying vec3 vWorld;

        // sum of a few directional sines -> surface normal, no geometry needed
        vec3 waveNormal(vec2 p, float t, float detail) {
          vec3 n = vec3(0.0, 1.0, 0.0);
          vec2 dirs[4];
          dirs[0] = normalize(vec2( 1.0,  0.35));
          dirs[1] = normalize(vec2(-0.6,  1.0));
          dirs[2] = normalize(vec2( 0.25, -1.0));
          dirs[3] = normalize(vec2(-1.0, -0.4));
          float len = 130.0;
          float amp = 0.05;
          for (int i = 0; i < 4; i++) {
            // drop the finer octaves with distance, otherwise they alias into moire
            float band = clamp(detail * 3.0 - float(i), 0.0, 1.0);
            float ph = dot(p, dirs[i]) / len * 6.2831 + t * (1.0 + float(i) * 0.27);
            n.xz -= dirs[i] * cos(ph) * amp * band;
            len *= 0.52; amp *= 0.62;
          }
          return normalize(n);
        }

        void main() {
          float dist = length(cameraPosition - vWorld);
          // wave detail LOD: full up close, glassy flat towards the horizon
          float detail = 1.0 - smoothstep(400.0, 5000.0, dist);
          vec3 n = waveNormal(vWorld.xz, uTime * 0.55, detail);
          vec3 v = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
          float diff = clamp(dot(n, uSun) * 0.5 + 0.66, 0.0, 1.0);
          vec3 col = mix(uDeep, uShallow, 0.28 + fres * 0.62) * diff;
          // sun glitter — also faded out with distance so the horizon stays calm
          vec3 h = normalize(uSun + v);
          float spec = pow(clamp(dot(n, h), 0.0, 1.0), 420.0) * 0.85 * detail;
          col += vec3(1.0, 0.95, 0.82) * spec;
          // broad, stable sheen so the far water still reads as water
          col += vec3(0.9, 0.94, 1.0) * pow(clamp(dot(vec3(0.0, 1.0, 0.0), h), 0.0, 1.0), 8.0) * 0.10;
          // fade into fog at the horizon so the plane edge never shows
          // fog on true 3D distance, so looking down from altitude hazes as well
          float fog = smoothstep(${CFG.world.fogNear.toFixed(1)}, ${CFG.world.fogFar.toFixed(1)}, dist);
          col = mix(col, vec3(0.62, 0.72, 0.85), fog);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const waterGeo = new THREE.PlaneGeometry(120000, 120000, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(waterGeo, this.waterMat);
    this.water.position.y = 0;
    this.water.frustumCulled = false;
    this.water.renderOrder = -1;
  }

  /** Ground height at a world position. Negative values are sea floor. */
  height(x: number, z: number): number {
    let mask = 0;
    for (const isl of ISLANDS) {
      const d = Math.hypot(x - isl.x, z - isl.z);
      const t = clamp01(1 - d / isl.r);
      mask = Math.max(mask, smoothstep(t) * (isl.h / 1500));
    }
    if (mask <= 0.001) return -220;

    const ridges = fbm(x * 0.00035, z * 0.00035, 5);
    const detail = fbm(x * 0.0022, z * 0.0022, 3);
    const h = (mask * 1500) * (0.45 + 0.75 * ridges) + detail * 90 * mask;
    return h - 190 * (1 - mask);
  }

  /** True when a point is inside solid ground (or in the water). */
  collides(p: THREE.Vector3, clearance = 0): boolean {
    if (p.y <= clearance) return true;
    return p.y - clearance <= this.height(p.x, p.z);
  }

  update(dt: number, cameraPos: THREE.Vector3) {
    this.waterMat.uniforms.uTime.value += dt;
    // keep the ocean centred so its far edge stays beyond the fog
    this.water.position.x = cameraPos.x;
    this.water.position.z = cameraPos.z;
  }
}

import * as THREE from 'three';
import { CFG } from '../core/config';
import { MapSpec } from './maps';

export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly water: THREE.Mesh;
  private waterMat: THREE.ShaderMaterial;
  /** anything standing on the ground that should also be solid, e.g. buildings */
  private obstacles: ((x: number, z: number) => number) | null = null;

  constructor(readonly spec: MapSpec) {
    const size = CFG.world.size;
    const seg = CFG.world.segments;

    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.baseHeight(x, z);
      pos.setY(i, h);

      this.spec.groundColor(h, x, z, c);
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
        uSun: { value: this.spec.sky.light.clone() },
        uDeep: { value: new THREE.Color(this.spec.water.deep) },
        uShallow: { value: new THREE.Color(this.spec.water.shallow) },
        uSpec: { value: this.spec.water.specular },
        uFogTint: { value: this.spec.water.fogTint.clone() },
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
        uniform float uSpec;
        uniform vec3 uFogTint;
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
          float spec = pow(clamp(dot(n, h), 0.0, 1.0), 420.0) * uSpec * detail;
          col += vec3(1.0, 0.95, 0.82) * spec;
          // broad, stable sheen so the far water still reads as water
          col += vec3(0.9, 0.94, 1.0) * pow(clamp(dot(vec3(0.0, 1.0, 0.0), h), 0.0, 1.0), 8.0) * 0.10;
          // fade into fog at the horizon so the plane edge never shows
          // fog on true 3D distance, so looking down from altitude hazes as well
          float fog = smoothstep(${this.spec.fog.near.toFixed(1)}, ${this.spec.fog.far.toFixed(1)}, dist);
          col = mix(col, uFogTint, fog);
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

  /** Ground height before scenery — what the mesh itself is built from. */
  baseHeight(x: number, z: number): number {
    return this.spec.baseHeight(x, z);
  }

  /**
   * Solid height at a world position, including anything built on the ground.
   * Collision, AI avoidance and the camera floor all go through here, so a city
   * block is as solid as a mountain without the terrain mesh having to model it.
   */
  height(x: number, z: number): number {
    const base = this.spec.baseHeight(x, z);
    if (!this.obstacles) return base;
    return Math.max(base, this.obstacles(x, z));
  }

  /** Register scenery that should count as solid. */
  setObstacles(fn: (x: number, z: number) => number) {
    this.obstacles = fn;
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

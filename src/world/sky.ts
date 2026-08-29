import * as THREE from 'three';
import { CFG } from '../core/config';
import { rand } from '../core/mathx';

/**
 * Gradient sky dome + sun disc + a cloud layer.
 *
 * The clouds are one merged buffer of quads billboarded in the vertex shader, so the
 * whole layer is a single draw call with no per-frame CPU work.
 */
export class Sky {
  readonly group = new THREE.Group();
  readonly sunDirection = new THREE.Vector3(0.45, 0.62, 0.65).normalize();
  readonly horizonColor = new THREE.Color(0x9db8d4);

  constructor() {
    this.group.add(this.buildDome());
    this.group.add(this.buildClouds(340));
  }

  private buildDome(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(40000, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x1d4f8f) },
        uMid: { value: new THREE.Color(0x76a8d8) },
        uBottom: { value: this.horizonColor },
        uSun: { value: this.sunDirection },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform vec3 uSun;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uBottom, uMid, smoothstep(0.44, 0.62, h));
          col = mix(col, uTop, smoothstep(0.6, 0.98, h));
          float lobe = clamp(dot(d, normalize(uSun)), 0.0, 1.0);
          // tight disc + tight bloom + broad haze, rather than one huge blown-out blob
          col += vec3(1.0, 0.94, 0.8) * (pow(lobe, 12000.0) * 3.2 + pow(lobe, 1200.0) * 0.55 + pow(lobe, 14.0) * 0.3);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const dome = new THREE.Mesh(geo, mat);
    dome.frustumCulled = false;
    dome.renderOrder = -2;
    return dome;
  }

  private buildClouds(count: number): THREE.Mesh {
    const positions = new Float32Array(count * 4 * 3);
    const centers = new Float32Array(count * 4 * 3);
    const uvs = new Float32Array(count * 4 * 2);
    const seeds = new Float32Array(count * 4);
    const indices: number[] = [];

    for (let i = 0; i < count; i++) {
      const r = 1800 + Math.random() * 19000;
      const a = Math.random() * Math.PI * 2;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const cy = 1400 + Math.random() * 2400;
      const w = rand(260, 780);
      const h = w * rand(0.34, 0.52);
      const seed = Math.random();

      const corners: ReadonlyArray<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let v = 0; v < 4; v++) {
        const o = (i * 4 + v);
        positions[o * 3] = corners[v][0] * w;
        positions[o * 3 + 1] = corners[v][1] * h;
        positions[o * 3 + 2] = 0;
        centers[o * 3] = cx; centers[o * 3 + 1] = cy; centers[o * 3 + 2] = cz;
        uvs[o * 2] = (corners[v][0] + 1) / 2;
        uvs[o * 2 + 1] = (corners[v][1] + 1) / 2;
        seeds[o] = seed;
      }
      const b = i * 4;
      indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setIndex(indices);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uFogColor: { value: this.horizonColor },
        uFogNear: { value: CFG.world.fogNear * 2 },
        uFogFar: { value: CFG.world.fogFar * 1.4 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aCenter;
        attribute float aSeed;
        varying vec2 vUv;
        varying float vSeed;
        varying float vDist;
        void main() {
          vUv = uv;
          vSeed = aSeed;
          // billboard: offset the quad in view space so it always faces the camera
          vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
          mv.xy += position.xy;
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
        varying vec2 vUv;
        varying float vSeed;
        varying float vDist;

        float blob(vec2 p, vec2 c, float r) {
          return smoothstep(r, 0.0, length((p - c) * vec2(1.0, 1.9)));
        }

        void main() {
          vec2 p = vUv;
          // a few overlapping soft lobes read as a puff instead of a rectangle
          float m = blob(p, vec2(0.5, 0.5), 0.42);
          m += blob(p, vec2(0.30 + vSeed * 0.1, 0.46), 0.30);
          m += blob(p, vec2(0.72 - vSeed * 0.12, 0.5), 0.27);
          m += blob(p, vec2(0.5 + (vSeed - 0.5) * 0.3, 0.62), 0.24);
          m = smoothstep(0.35, 1.15, m);
          if (m < 0.01) discard;

          // lit from above: brighter towards the top of the puff
          vec3 col = mix(vec3(0.85, 0.89, 0.95), vec3(1.0), smoothstep(0.2, 0.85, vUv.y));
          float fog = smoothstep(uFogNear, uFogFar, vDist);
          col = mix(col, uFogColor, fog);
          gl_FragColor = vec4(col, m * 0.5 * (1.0 - fog * 0.5));
        }
      `,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    return mesh;
  }

  addLights(scene: THREE.Scene) {
    const sun = new THREE.DirectionalLight(0xfff3dd, 2.1);
    sun.position.copy(this.sunDirection).multiplyScalar(1000);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xa8ccf0, 0x2a3a30, 1.15));
  }
}

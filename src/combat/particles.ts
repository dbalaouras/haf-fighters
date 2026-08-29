import * as THREE from 'three';
import { rand } from '../core/mathx';

interface Particle {
  life: number; maxLife: number;
  vel: THREE.Vector3;
  drag: number;
  size0: number; size1: number;
  col0: THREE.Color; col1: THREE.Color;
  alpha: number;
  gravity: number;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (450.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float a = vAlpha * (1.0 - r * r);
    gl_FragColor = vec4(vColor, a);
  }
`;

class Pool {
  readonly points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private parts: Particle[] = [];
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private color: Float32Array;
  private cursor = 0;
  private readonly max: number;
  private tmp = new THREE.Color();

  constructor(max: number, blending: THREE.Blending) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);

    for (let i = 0; i < max; i++) {
      this.parts.push({
        life: 0, maxLife: 1, vel: new THREE.Vector3(), drag: 1,
        size0: 1, size1: 1, col0: new THREE.Color(), col1: new THREE.Color(),
        alpha: 0, gravity: 0,
      });
      this.pos[i * 3 + 1] = -100000; // park unused particles far below the map
    }

    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    this.points = new THREE.Points(this.geo, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending,
    }));
    this.points.frustumCulled = false;
  }

  spawn(o: {
    pos: THREE.Vector3; vel: THREE.Vector3; life: number;
    size0: number; size1: number; col0: number; col1: number;
    alpha?: number; drag?: number; gravity?: number;
  }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const p = this.parts[i];
    p.life = o.life; p.maxLife = o.life;
    p.vel.copy(o.vel);
    p.drag = o.drag ?? 1.2;
    p.size0 = o.size0; p.size1 = o.size1;
    p.col0.setHex(o.col0); p.col1.setHex(o.col1);
    p.alpha = o.alpha ?? 1;
    p.gravity = o.gravity ?? 0;
    this.pos[i * 3] = o.pos.x; this.pos[i * 3 + 1] = o.pos.y; this.pos[i * 3 + 2] = o.pos.z;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      const p = this.parts[i];
      if (p.life <= 0) { this.alpha[i] = 0; continue; }
      p.life -= dt;
      const t = 1 - Math.max(0, p.life) / p.maxLife;
      const k = Math.exp(-p.drag * dt);
      p.vel.multiplyScalar(k);
      p.vel.y -= p.gravity * dt;
      this.pos[i * 3] += p.vel.x * dt;
      this.pos[i * 3 + 1] += p.vel.y * dt;
      this.pos[i * 3 + 2] += p.vel.z * dt;
      this.size[i] = p.size0 + (p.size1 - p.size0) * t;
      this.alpha[i] = p.life <= 0 ? 0 : p.alpha * (1 - t) * (1 - t);
      this.tmp.copy(p.col0).lerp(p.col1, t);
      this.color[i * 3] = this.tmp.r; this.color[i * 3 + 1] = this.tmp.g; this.color[i * 3 + 2] = this.tmp.b;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Facade over two pools: additive for fire/sparks, alpha-blended for smoke. */
export class Fx {
  readonly group = new THREE.Group();
  private fire = new Pool(2600, THREE.AdditiveBlending);
  private smoke = new Pool(2600, THREE.NormalBlending);
  private v = new THREE.Vector3();

  constructor() {
    this.group.add(this.smoke.points, this.fire.points);
  }

  update(dt: number) {
    this.fire.update(dt);
    this.smoke.update(dt);
  }

  explosion(pos: THREE.Vector3, scale = 1) {
    for (let i = 0; i < 26; i++) {
      this.v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(8, 46) * scale);
      this.fire.spawn({
        pos, vel: this.v, life: rand(0.35, 0.9),
        size0: 8 * scale, size1: 26 * scale, col0: 0xfff0b0, col1: 0xff4410, drag: 2.2,
      });
    }
    for (let i = 0; i < 22; i++) {
      this.v.set(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 26) * scale);
      this.smoke.spawn({
        pos, vel: this.v, life: rand(1.4, 3.2),
        size0: 12 * scale, size1: 62 * scale, col0: 0x585858, col1: 0x2b2b2b, alpha: 0.55, drag: 0.9, gravity: -1.5,
      });
    }
    for (let i = 0; i < 18; i++) {
      this.v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(40, 140) * scale);
      this.fire.spawn({
        pos, vel: this.v, life: rand(0.4, 1.1),
        size0: 3, size1: 0.5, col0: 0xffd070, col1: 0xff6020, drag: 0.6, gravity: 20,
      });
    }
  }

  missileTrail(pos: THREE.Vector3, vel: THREE.Vector3) {
    this.v.copy(vel).multiplyScalar(-0.06);
    this.smoke.spawn({
      pos, vel: this.v, life: 1.5,
      size0: 3, size1: 22, col0: 0xf2f2f2, col1: 0xbfbfbf, alpha: 0.6, drag: 1.6,
    });
    this.fire.spawn({
      pos, vel: this.v, life: 0.16,
      size0: 5, size1: 1, col0: 0xffe8a0, col1: 0xff7020, drag: 2,
    });
  }

  damageSmoke(pos: THREE.Vector3, vel: THREE.Vector3, severity: number) {
    this.v.copy(vel).multiplyScalar(-0.12);
    this.smoke.spawn({
      pos, vel: this.v, life: 1.2 + severity,
      size0: 6, size1: 30 + 30 * severity, col0: 0x3a3a3a, col1: 0x141414, alpha: 0.5, drag: 1.2,
    });
  }

  flareBurn(pos: THREE.Vector3, vel: THREE.Vector3, remaining: number) {
    this.v.copy(vel).multiplyScalar(-0.05);
    this.fire.spawn({
      pos, vel: this.v, life: 0.42,
      size0: 9 * remaining + 3, size1: 1, col0: 0xfffce0, col1: 0xff8a20, drag: 1.4,
    });
    this.smoke.spawn({
      pos, vel: this.v, life: 0.9,
      size0: 4, size1: 20, col0: 0xdadada, col1: 0x9a9a9a, alpha: 0.35, drag: 1.5,
    });
  }

  hitSpark(pos: THREE.Vector3) {
    for (let i = 0; i < 5; i++) {
      this.v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(10, 45));
      this.fire.spawn({
        pos, vel: this.v, life: rand(0.12, 0.3),
        size0: 3.5, size1: 0.5, col0: 0xffffd0, col1: 0xffa020, drag: 3,
      });
    }
  }

  muzzleFlash(pos: THREE.Vector3, vel: THREE.Vector3) {
    this.v.copy(vel).multiplyScalar(0.02);
    this.fire.spawn({
      pos, vel: this.v, life: 0.05, size0: 5, size1: 1, col0: 0xfff4c0, col1: 0xffa040, drag: 1,
    });
  }
}

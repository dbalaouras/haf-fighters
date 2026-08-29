import * as THREE from 'three';

/**
 * Everything that varies between maps. Terrain, sky and scenery all read from one
 * of these, so adding a map is writing a spec rather than editing the world code.
 */
export interface MapSpec {
  id: MapId;
  name: string;
  /** shown under the title on the menu */
  blurb: string;

  /** ground height before any scenery is placed; negative is below the waterline */
  baseHeight(x: number, z: number): number;
  /** vertex colour for a piece of ground at this height */
  groundColor(h: number, x: number, z: number, out: THREE.Color): void;

  sky: {
    top: number; mid: number; horizon: number;
    /** direction of the sun or moon */
    light: THREE.Vector3;
    /** tightness and strength of the celestial disc */
    discPower: number; discStrength: number; haloStrength: number;
    discColor: number;
    stars: number;              // 0 = none
    clouds: number;             // billboard count
    cloudColor: number;
    cloudOpacity: number;
  };

  water: { deep: number; shallow: number; specular: number; fogTint: THREE.Vector3 };

  light: {
    sunColor: number; sunIntensity: number;
    skyColor: number; groundColor: number; hemiIntensity: number;
  };

  fog: { color: number; near: number; far: number };

  /** built after the terrain, for anything map-specific standing on it */
  scenery?: 'city' | 'volcano';
}

export type MapId = 'CORAL' | 'CITY';

/* ---------------- shared noise ---------------- */

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}
const smooth = (t: number) => t * t * (3 - 2 * t);

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function fbm(x: number, y: number, octaves = 5): number {
  let sum = 0, amp = 0.5, norm = 0, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(fx, fy) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03; fy *= 1.97;
  }
  return sum / norm;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ---------------- Coral Range: the original islands at dawn ---------------- */

const ISLANDS: ReadonlyArray<{ x: number; z: number; r: number; h: number }> = [
  // a broad low shield: the volcano itself is real geometry sitting on top of it
  { x: 0, z: 0, r: 3500, h: 190 },
  { x: -6200, z: -3400, r: 2100, h: 900 },
  { x: 5600, z: 3900, r: 2400, h: 1050 },
  { x: -4200, z: 6100, r: 1500, h: 620 },
  { x: 6900, z: -6200, r: 1700, h: 740 },
  { x: -8200, z: 1200, r: 1200, h: 480 },
];

const CORAL: MapSpec = {
  id: 'CORAL',
  name: 'CORAL RANGE — DAWN',
  blurb: 'Islands, open water, and a volcano you can fly through',

  baseHeight(x, z) {
    let mask = 0;
    for (const isl of ISLANDS) {
      const d = Math.hypot(x - isl.x, z - isl.z);
      mask = Math.max(mask, smooth(clamp01(1 - d / isl.r)) * (isl.h / 1500));
    }
    if (mask <= 0.001) return -220;
    const ridges = fbm(x * 0.00035, z * 0.00035, 5);
    const detail = fbm(x * 0.0022, z * 0.0022, 3);
    return (mask * 1500) * (0.45 + 0.75 * ridges) + detail * 90 * mask - 190 * (1 - mask);
  },

  groundColor(h, x, z, c) {
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
  },

  sky: {
    top: 0x1d4f8f, mid: 0x76a8d8, horizon: 0x9db8d4,
    light: new THREE.Vector3(0.45, 0.62, 0.65).normalize(),
    discPower: 12000, discStrength: 3.2, haloStrength: 0.3, discColor: 0xfff0cc,
    stars: 0, clouds: 340, cloudColor: 0xffffff, cloudOpacity: 0.5,
  },
  water: { deep: 0x11405f, shallow: 0x49a8cc, specular: 0.85, fogTint: new THREE.Vector3(0.62, 0.72, 0.85) },
  light: { sunColor: 0xfff3dd, sunIntensity: 2.1, skyColor: 0xa8ccf0, groundColor: 0x2a3a30, hemiIntensity: 1.15 },
  fog: { color: 0x9db8d4, near: 3000, far: 22000 },
  scenery: 'volcano',
};

/* ---------------- Neon Delta: a river city after dark ---------------- */

/** The river snakes across the map; the city sits on both banks. */
export const RIVER = {
  halfWidth: 430,
  meander: (x: number) => Math.sin(x * 0.00034) * 1100 + Math.sin(x * 0.00097) * 320,
  bankHeight: 46,
  bedDepth: -70,
};

/** Distance from a point to the middle of the river, across its width. */
export function riverOffset(x: number, z: number): number {
  return Math.abs(z - RIVER.meander(x));
}

const CITY: MapSpec = {
  id: 'CITY',
  name: 'NEON DELTA — NIGHT',
  blurb: 'A river city after dark. Mind the bridge.',

  baseHeight(x, z) {
    const off = riverOffset(x, z);
    // carve the channel, with banks easing up out of the water
    if (off < RIVER.halfWidth) {
      const t = off / RIVER.halfWidth;
      return RIVER.bedDepth + smooth(t) * (RIVER.bankHeight - RIVER.bedDepth) * 0.55;
    }
    const inland = clamp01((off - RIVER.halfWidth) / 700);
    const plain = RIVER.bankHeight * (0.55 + 0.45 * smooth(inland));
    // low hills far out, so the horizon is not a perfect line
    const far = clamp01((Math.hypot(x, z) - 9000) / 7000);
    const hills = fbm(x * 0.00016, z * 0.00016, 4) * 900 * far * far;
    return plain + hills + fbm(x * 0.0013, z * 0.0013, 3) * 9;
  },

  groundColor(h, x, z, c) {
    if (h < 6) { c.setRGB(0.05, 0.07, 0.11); return; }          // riverbed
    const off = riverOffset(x, z);
    if (off < RIVER.halfWidth + 130) { c.setRGB(0.13, 0.13, 0.15); return; }  // embankment
    if (h > 260) { c.setRGB(0.10, 0.11, 0.13); return; }         // outlying hills
    // city ground: dark asphalt with a faint sodium-light wash
    const glow = fbm(x * 0.0016, z * 0.0016, 2);
    c.setRGB(0.09 + glow * 0.07, 0.085 + glow * 0.05, 0.10 + glow * 0.04);
  },

  sky: {
    top: 0x03060f, mid: 0x0a1226, horizon: 0x1b2338,
    light: new THREE.Vector3(-0.35, 0.55, 0.4).normalize(),
    discPower: 5000, discStrength: 1.6, haloStrength: 0.12, discColor: 0xdfe8ff,
    stars: 1400, clouds: 90, cloudColor: 0x2a3350, cloudOpacity: 0.34,
  },
  water: { deep: 0x040910, shallow: 0x10293f, specular: 0.5, fogTint: new THREE.Vector3(0.10, 0.13, 0.20) },
  light: { sunColor: 0x9fb4e6, sunIntensity: 0.5, skyColor: 0x2a3556, groundColor: 0x140f18, hemiIntensity: 0.5 },
  fog: { color: 0x121a2b, near: 2200, far: 17000 },
  scenery: 'city',
};

export const MAPS: Record<MapId, MapSpec> = { CORAL, CITY };
export const MAP_ORDER: readonly MapId[] = ['CORAL', 'CITY'];

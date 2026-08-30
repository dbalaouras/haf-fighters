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

  /**
   * Where Air Superiority puts A, B and C. Optional: without it the zones fall
   * back to the team spawns and the middle of the map, which works anywhere but
   * ignores what the map is actually about.
   */
  zones?: Array<{ x: number; z: number; owner?: 'BLUE' | 'RED' | null }>;
  /** built after the terrain, for anything map-specific standing on it */
  scenery?: 'city' | 'volcano' | 'harbour';
  /**
   * Where a built-up map may not put towers, and what landmark it gets. The
   * tower field itself used to hard-code Neon Delta's river and bridge; moving
   * that into the spec is what lets a waterfront reuse the same instancing.
   */
  built?: {
    keepClear(x: number, z: number): boolean;
    landmark: 'bridge' | 'harbour';
    /** lit windows everywhere, or only the few that are up at dawn */
    litWindows: boolean;
  };
}

export type MapId = 'CORAL' | 'CITY' | 'HARBOUR';

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
  name: 'CORAL RANGE — SUNRISE',
  blurb: 'Islands and open water, around a live volcano',

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

  // Sunrise, not the 38-degree mid-morning this used to call dawn: the sun sits
  // at 16 degrees so it is still in shot, warms the horizon, and rakes the water.
  // The low backlit dawn is reserved for the harbour map.
  sky: {
    top: 0x123f7d, mid: 0x6b9ccc, horizon: 0xd7a279,
    light: new THREE.Vector3(0.55, 0.28, 0.79).normalize(),
    discPower: 6500, discStrength: 4.4, haloStrength: 0.55, discColor: 0xffd39a,
    stars: 0, clouds: 340, cloudColor: 0xffe3cd, cloudOpacity: 0.55,
  },
  water: { deep: 0x0e3652, shallow: 0x3f95bb, specular: 1.15, fogTint: new THREE.Vector3(0.78, 0.68, 0.62) },
  light: { sunColor: 0xffd9a6, sunIntensity: 2.3, skyColor: 0xc0b6c4, groundColor: 0x30302a, hemiIntensity: 1.0 },
  fog: { color: 0xb9977f, near: 3500, far: 23000 },
  // B sits over the volcano: the one piece of terrain worth fighting around
  zones: [
    { x: -5200, z: 4200, owner: 'BLUE' },
    { x: 0, z: 0 },
    { x: 5200, z: -4200, owner: 'RED' },
  ],
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
  // B over the bridge, which is the landmark and the only crossing
  zones: [
    { x: -5400, z: 4400, owner: 'BLUE' },
    { x: 0, z: 0 },
    { x: 5400, z: -4400, owner: 'RED' },
  ],
  scenery: 'city',
  built: {
    keepClear: (x, z) => riverOffset(x, z) < RIVER.halfWidth + 220
      || (Math.abs(x) < 240 && riverOffset(x, z) < 820),
    landmark: 'bridge',
    litWindows: true,
  },
};


/* ---------------- Piraeus Dawn: a working harbour at first light ---------------- */

/**
 * Laid out after the real Piraeus rather than as an open bay: a big basin
 * almost closed by the land around it, reached through one narrow mouth, with a
 * second smaller basin off its north-east corner joined by a neck. That shape
 * is the whole character of the map — the water is a room you fly into, not a
 * coastline you fly along, and the only way in is watched from both sides.
 */
export const HARBOUR = {
  /** the main basin, Kentrikos Limenas */
  main: { cx: -200, cz: -300, hx: 2500, hz: 1750, r: 700 },
  /** the inner harbour off its north-east corner, Esoterikos Limenas */
  inner: { cx: 3050, cz: 2050, hx: 950, hz: 780, r: 320 },
  /** the neck joining them, which the bridge crosses */
  neck: { ax: 2250, az: 1250, bx: 2750, bz: 1780, w: 400 },
  /**
   * The mouth. Short and wide enough to read as a gap between two headlands
   * rather than a canal — the approach should be a threshold you cross, not a
   * corridor you fly down.
   */
  mouth: { ax: 100, az: -1750, bx: 500, bz: -3500, w: 940 },
  /** open sea south of here, whatever else the shapes say */
  seaZ: -3450,

  depth: -185,
  quayY: 15,
  plainY: 70,
  /** metres inland from any waterline that stay clear of towers */
  quayDepth: 420,
  bridge: { deckY: 96 },
};

/** Distance outside a rounded rectangle; negative inside it. */
function sdBox(x: number, z: number, b: { cx: number; cz: number; hx: number; hz: number; r: number }) {
  const dx = Math.abs(x - b.cx) - (b.hx - b.r);
  const dz = Math.abs(z - b.cz) - (b.hz - b.r);
  const ox = Math.max(dx, 0), oz = Math.max(dz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(dx, dz), 0) - b.r;
}

/** Distance outside a thick line segment; negative inside it. */
function sdCapsule(x: number, z: number, c: { ax: number; az: number; bx: number; bz: number; w: number }) {
  const px = x - c.ax, pz = z - c.az;
  const bx = c.bx - c.ax, bz = c.bz - c.az;
  const t = Math.max(0, Math.min(1, (px * bx + pz * bz) / (bx * bx + bz * bz)));
  return Math.hypot(px - bx * t, pz - bz * t) - c.w;
}

/**
 * How far inside the waterline a point is, in metres. Positive is water,
 * negative is land, and the magnitude is the distance to the shore — which is
 * what the quay, the tower mask and the ground colour all key off.
 */
export function harbourWater(x: number, z: number): number {
  return Math.max(
    HARBOUR.seaZ - z,                       // open sea to the south
    -sdBox(x, z, HARBOUR.main),
    -sdBox(x, z, HARBOUR.inner),
    -sdCapsule(x, z, HARBOUR.neck),
    -sdCapsule(x, z, HARBOUR.mouth),
  );
}

/**
 * Points around the inside of the main basin, each facing the water. The quay
 * has to follow a closed shore now rather than a function of x, so it is walked
 * as an inset rounded rectangle.
 */
export function quayRing(step: number): Array<{ x: number; z: number; ang: number }> {
  const b = HARBOUR.main;
  const inset = 90;                          // stand back from the water's edge
  const hx = b.hx - inset, hz = b.hz - inset;
  const out: Array<{ x: number; z: number; ang: number }> = [];
  const perimeter = 4 * (hx + hz);
  const n = Math.max(8, Math.round(perimeter / step));
  for (let i = 0; i < n; i++) {
    const d = (i / n) * perimeter;
    let x: number, z: number, ang: number;
    if (d < 2 * hx) { x = b.cx - hx + d; z = b.cz - hz; ang = Math.PI; }              // south shore
    else if (d < 2 * hx + 2 * hz) { x = b.cx + hx; z = b.cz - hz + (d - 2 * hx); ang = -Math.PI / 2; }
    else if (d < 4 * hx + 2 * hz) { x = b.cx + hx - (d - 2 * hx - 2 * hz); z = b.cz + hz; ang = 0; }
    else { x = b.cx - hx; z = b.cz + hz - (d - 4 * hx - 2 * hz); ang = Math.PI / 2; }
    // skip the corners, where a crane would be facing into rock
    if (harbourWater(x, z) > -40) out.push({ x, z, ang });
  }
  return out;
}

const HARBOUR_MAP: MapSpec = {
  id: 'HARBOUR',
  name: 'PIRAEUS DAWN — FIRST LIGHT',
  blurb: 'An enclosed basin, backlit. One narrow mouth, and everything watches it',

  baseHeight(x, z) {
    const w = harbourWater(x, z);
    if (w > 0) {
      // basin floor, deepening away from the shore
      return HARBOUR.quayY + (HARBOUR.depth - HARBOUR.quayY) * smooth(clamp01(w / 900));
    }
    const d = -w;                                        // metres inland
    if (d < HARBOUR.quayDepth) return HARBOUR.quayY;     // flat working apron
    const rise = clamp01((d - HARBOUR.quayDepth) / 900);
    const plain = HARBOUR.quayY + (HARBOUR.plainY - HARBOUR.quayY) * smooth(rise);
    const far = clamp01((d - 3500) / 6000);
    const hills = fbm(x * 0.00018, z * 0.00018, 4) * 1200 * far * far;
    return plain + hills + fbm(x * 0.0012, z * 0.0012, 3) * 7;
  },

  groundColor(h, x, z, c) {
    if (h < 4) { c.setRGB(0.05, 0.07, 0.09); return; }                 // basin floor
    const d = -harbourWater(x, z);
    if (d >= 0 && d < HARBOUR.quayDepth) {
      // tarmac, not concrete: the apron fills the foreground on every low pass
      const w = fbm(x * 0.004, z * 0.004, 2) * 0.055;
      c.setRGB(0.105 + w, 0.10 + w, 0.10 + w);
      return;
    }
    if (h > 300) { c.setRGB(0.115, 0.11, 0.10); return; }
    const t = fbm(x * 0.0018, z * 0.0018, 2);
    c.setRGB(0.11 + t * 0.055, 0.105 + t * 0.045, 0.10 + t * 0.035);
  },

  // Sun barely up and BEHIND the skyline, so the towers read as rim-lit
  // silhouettes and the basin holds its mist. Coral Range owns the other
  // early morning, facing into a clear sunrise; these two must not blur.
  sky: {
    top: 0x16305c, mid: 0x5c7098, horizon: 0xe0a878,
    light: new THREE.Vector3(-0.34, 0.115, 0.93).normalize(),
    discPower: 4200, discStrength: 5.2, haloStrength: 0.8, discColor: 0xffc07a,
    stars: 120, clouds: 260, cloudColor: 0xffd8bc, cloudOpacity: 0.5,
  },
  water: { deep: 0x122232, shallow: 0x3d5f74, specular: 1.3, fogTint: new THREE.Vector3(0.80, 0.70, 0.66) },
  light: { sunColor: 0xffc28a, sunIntensity: 1.5, skyColor: 0xa9b6cc, groundColor: 0x2b2620, hemiIntensity: 0.95 },
  fog: { color: 0xc0a291, near: 1800, far: 19000 },
  // B over the mouth: the one way in, and the only ground both teams must cross
  zones: [
    { x: -5800, z: 3600, owner: 'BLUE' },
    { x: 550, z: -3400 },
    { x: 5800, z: -3800, owner: 'RED' },
  ],
  scenery: 'harbour',
  built: {
    keepClear: (x, z) => harbourWater(x, z) > -(HARBOUR.quayDepth + 60),
    landmark: 'harbour',
    litWindows: false,
  },
};

export const MAPS: Record<MapId, MapSpec> = { CORAL, CITY, HARBOUR: HARBOUR_MAP };
export const MAP_ORDER: readonly MapId[] = ['CORAL', 'CITY', 'HARBOUR'];

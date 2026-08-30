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
  built: {
    keepClear: (x, z) => riverOffset(x, z) < RIVER.halfWidth + 220
      || (Math.abs(x) < 240 && riverOffset(x, z) < 820),
    landmark: 'bridge',
    litWindows: true,
  },
};


/* ---------------- Piraeus Dawn: a working harbour at first light ---------------- */

export const HARBOUR = {
  /** the shoreline, as a z for any x — a shallow bay opening south */
  shore: (x: number) => -700 + 1250 * Math.sin(x / 4600) - 900 * Math.cos(x / 9000),
  /** working quay: flat, and kept clear of towers so the cranes have the frontage */
  quayDepth: 420,
  quayY: 15,
  plainY: 64,
  basinFloor: -170,
  /** the breakwater arm, an arc with a gap at its west end for the harbour mouth */
  arm: { cx: 1900, cz: -1200, r: 4200, halfWidth: 80, y: 22, from: 0.55, to: 2.35 },
  /**
   * The inner channel, cutting inland off the basin. 380 m of half-width is
   * about seven terrain cells across, which is the least that reads as water
   * rather than a crease — the Neon Delta river uses 430 for the same reason.
   */
  channel: { x: 1500, halfWidth: 380, reach: 3400, depth: -58, bridgeAt: 1100, deckY: 92 },
};

/**
 * How much the channel has been dug out at a point: 1 in open water down the
 * middle, easing to 0 at the banks, at the mouth and at the turning basin.
 */
export function channelCut(x: number, z: number): number {
  const c = HARBOUR.channel;
  const across = 1 - smooth(clamp01(Math.abs(x - c.x) / c.halfWidth));
  if (across <= 0) return 0;
  const d = inland(x, z);
  const along = smooth(clamp01((d + 500) / 700)) * smooth(clamp01((c.reach - d) / 800));
  return across * along;
}

/** metres inland from the shoreline; negative out over the water */
export function inland(x: number, z: number): number {
  return z - HARBOUR.shore(x);
}

/** How far a point sits from the centreline of the breakwater arm, or Infinity. */
export function armOffset(x: number, z: number): number {
  const a = HARBOUR.arm;
  const dx = x - a.cx, dz = z - a.cz;
  let th = Math.atan2(dz, dx);
  if (th < 0) th += Math.PI * 2;
  if (th < a.from || th > a.to) return Infinity;
  return Math.abs(Math.hypot(dx, dz) - a.r);
}

/** World position of the breakwater tip, where the lighthouse stands. */
export function armTip(): { x: number; z: number } {
  const a = HARBOUR.arm;
  return { x: a.cx + Math.cos(a.to) * a.r, z: a.cz + Math.sin(a.to) * a.r };
}

const HARBOUR_MAP: MapSpec = {
  id: 'HARBOUR',
  name: 'PIRAEUS DAWN — FIRST LIGHT',
  blurb: 'A backlit harbour: docks, a bridge over the channel, open sea past the mole',

  baseHeight(x, z) {
    const a = HARBOUR.arm;
    const off = armOffset(x, z);
    if (off < a.halfWidth) {
      // the mole itself, with its flanks tumbling into the water
      return a.y - smooth(clamp01(off / a.halfWidth)) * 6;
    }
    const d = inland(x, z);
    if (d < 0) {
      // basin, deepening away from the shore
      const deep = clamp01(-d / 2600);
      let y = HARBOUR.quayY - 4 + (HARBOUR.basinFloor - HARBOUR.quayY) * smooth(deep);
      if (off < a.halfWidth + 260) {
        // shoal up against the outside of the mole
        y += (a.y - y) * smooth(1 - (off - a.halfWidth) / 260) * 0.55;
      }
      const cut = channelCut(x, z);
      return cut > 0 ? Math.min(y, HARBOUR.channel.depth) : y;
    }
    let y: number;
    if (d < HARBOUR.quayDepth) {
      y = HARBOUR.quayY;                                        // flat working apron
    } else {
      const rise = clamp01((d - HARBOUR.quayDepth) / 900);
      const plain = HARBOUR.quayY + (HARBOUR.plainY - HARBOUR.quayY) * smooth(rise);
      // hills well inland, so the skyline has something behind it
      const far = clamp01((d - 4000) / 6000);
      const hills = fbm(x * 0.00018, z * 0.00018, 4) * 1150 * far * far;
      y = plain + hills + fbm(x * 0.0012, z * 0.0012, 3) * 7;
    }
    // dredge the inner channel through whatever the land was doing
    const cut = channelCut(x, z);
    return cut > 0 ? y + (HARBOUR.channel.depth - y) * cut : y;
  },

  groundColor(h, x, z, c) {
    if (h < 4) { c.setRGB(0.06, 0.08, 0.10); return; }                  // basin floor
    if (armOffset(x, z) < HARBOUR.arm.halfWidth + 20) { c.setRGB(0.15, 0.145, 0.14); return; }
    if (channelCut(x, z) > 0.2) { c.setRGB(0.05, 0.07, 0.09); return; }   // channel bed
    const d = inland(x, z);
    if (d >= 0 && d < HARBOUR.quayDepth) {
      // tarmac, not concrete: the apron fills the foreground on every low pass,
      // and a light grey there washed the whole map out
      const w = fbm(x * 0.004, z * 0.004, 2) * 0.055;
      c.setRGB(0.105 + w, 0.10 + w, 0.10 + w);
      return;
    }
    if (h > 300) { c.setRGB(0.115, 0.11, 0.10); return; }               // inland hills
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
  scenery: 'harbour',
  built: {
    // towers stand back from the working apron, and never on the mole
    keepClear: (x, z) => {
      const d = inland(x, z);
      if (d < HARBOUR.quayDepth + 60) return true;                    // working apron
      if (armOffset(x, z) < HARBOUR.arm.halfWidth + 200) return true; // the mole
      const c = HARBOUR.channel;
      // the channel, its wharves, and the ground the bridge lands on
      if (Math.abs(x - c.x) < c.halfWidth + 260 && d > -400 && d < c.reach + 300) return true;
      return false;
    },
    landmark: 'harbour',
    litWindows: false,
  },
};

export const MAPS: Record<MapId, MapSpec> = { CORAL, CITY, HARBOUR: HARBOUR_MAP };
export const MAP_ORDER: readonly MapId[] = ['CORAL', 'CITY', 'HARBOUR'];

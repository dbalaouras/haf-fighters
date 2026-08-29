import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A procedurally built low-poly delta fighter. Convention: nose points down -Z,
 * wings span X, canopy up +Y — matching Three.js object space so `quaternion`
 * can be used directly as the flight attitude.
 *
 * Parts are merged per material so each jet costs 6 draw calls instead of ~16;
 * with 10 aircraft in the air that difference is worth the extra plumbing.
 */

export interface JetVisual {
  group: THREE.Group;
  burners: THREE.Mesh[];
}

/** where the engines sit across the span */
function nozzleOffsets(shape: JetShape): number[] {
  return shape.engines === 1 ? [0] : [-0.7, 0.7];
}

const matCache = new Map<string, THREE.Material>();
const mat = (key: string, make: () => THREE.Material): THREE.Material => {
  let m = matCache.get(key);
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
};

const geoCache = new Map<string, THREE.BufferGeometry>();

/** Extrude a flat planform (x = span, y = forward) into a thin horizontal surface. */
function panel(points: ReadonlyArray<[number, number]>, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  geo.rotateX(-Math.PI / 2);   // shape +y -> world -z (forward), depth -> world y
  return geo;
}

const WING: ReadonlyArray<[number, number]> = [
  [0.85, 2.6], [6.5, -1.3], [6.7, -2.5], [0.85, -3.2],
];
const TAILPLANE: ReadonlyArray<[number, number]> = [
  [0.7, -3.2], [3.0, -4.5], [3.1, -5.2], [0.7, -5.4],
];
const FIN: ReadonlyArray<[number, number]> = [
  [0.0, -2.6], [2.9, -4.4], [3.0, -5.3], [0.0, -5.3],
];

/** Merge a bag of parts into one geometry (all made non-indexed first so shapes mix cleanly). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat, false);
  if (!merged) throw new Error('geometry merge failed');
  merged.computeVertexNormals();
  return merged;
}

function buildPart(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

export interface JetShape {
  span: number;
  length: number;
  tail: 'twin' | 'single';
  /** how many engines, which changes the tail end entirely */
  engines: 1 | 2;
  /** a single chin inlet under the nose, or a pair on the shoulders */
  intake: 'chin' | 'side';
  /** outward cant of the fins, in radians */
  finCant: number;
}

const DEFAULT_SHAPE: JetShape = {
  span: 1, length: 1, tail: 'twin', engines: 2, intake: 'side', finCant: 0.22,
};

export function buildJet(teamColor: number, shape: JetShape = DEFAULT_SHAPE): JetVisual {
  const group = new THREE.Group();
  const key = [
    shape.span, shape.length, shape.tail, shape.engines, shape.intake, shape.finCant,
  ].join('-');

  const body = mat('body', () => new THREE.MeshLambertMaterial({ color: 0x8a949e, flatShading: true }));
  const dark = mat('dark', () => new THREE.MeshLambertMaterial({ color: 0x3a4149, flatShading: true }));
  const accent = mat(`accent-${teamColor}`, () => new THREE.MeshLambertMaterial({ color: teamColor, flatShading: true }));
  const glass = mat('glass', () => new THREE.MeshPhongMaterial({
    color: 0x0d2033, shininess: 90, specular: 0xaaccff, transparent: true, opacity: 0.85,
  }));
  const flame = mat('flame', () => new THREE.MeshBasicMaterial({
    color: 0x8fd6ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  }));

  const bodyGeo = buildPart(`jet-body-${key}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    // span and length scale the planform, which is most of the silhouette

    const fus = new THREE.CylinderGeometry(0.95, 0.82, 10, 10, 1);
    fus.rotateX(Math.PI / 2);
    parts.push(fus);

    const nose = new THREE.ConeGeometry(0.95, 3.8, 10);
    nose.rotateX(-Math.PI / 2);
    nose.translate(0, 0, -6.9);
    parts.push(nose);

    for (const side of [-1, 1]) {
      const w = panel(WING, 0.22);
      if (side < 0) w.scale(-1, 1, 1);
      parts.push(w);
      const tp = panel(TAILPLANE, 0.18);
      if (side < 0) tp.scale(-1, 1, 1);
      parts.push(tp);
    }
    const g = merge(parts);
    g.scale(shape.span, 1, shape.length);
    return g;
  });

  const darkGeo = buildPart(`jet-dark-${key}`, () => {
    const parts: THREE.BufferGeometry[] = [];

    if (shape.intake === 'chin') {
      // one inlet slung under the forward fuselage
      const intake = new THREE.BoxGeometry(1.7, 1.0, 4.6);
      intake.translate(0, -0.95, -1.6);
      parts.push(intake);
    } else {
      for (const side of [-1, 1]) {
        const intake = new THREE.BoxGeometry(0.9, 0.85, 4.2);
        intake.translate(side * 1.35, -0.35, -0.8);
        parts.push(intake);
      }
    }

    // one big nozzle on the centreline, or a pair spaced either side of it
    for (const x of nozzleOffsets(shape)) {
      const r = shape.engines === 1 ? 0.86 : 0.62;
      const nozzle = new THREE.CylinderGeometry(r, r * 0.8, 1.7, 10);
      nozzle.rotateX(Math.PI / 2);
      nozzle.translate(x, 0, 5.4);
      parts.push(nozzle);
    }

    const g = merge(parts);
    g.scale(shape.span, 1, shape.length);
    return g;
  });

  const accentGeo = buildPart(`jet-accent-${key}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    if (shape.tail === 'single') {
      // one upright fin on the centreline instead of a canted pair
      const f = panel(FIN, 0.18);
      f.rotateZ(Math.PI / 2);
      f.scale(1.25, 1, 1);
      parts.push(f);
    }
    for (const side of [-1, 1]) {
      // the wing is swept, so the tip chord sits BEHIND the root — +z, not -z
      const tip = new THREE.BoxGeometry(1.5, 0.26, 1.4);
      tip.translate(side * 5.75, 0, 1.9);
      parts.push(tip);

      if (shape.tail === 'twin') {
        const f = panel(FIN, 0.16);
        f.rotateZ(Math.PI / 2);
        f.rotateZ(side * shape.finCant);
        f.translate(side * 1.1, 0.5, 0);
        parts.push(f);
      }
    }
    const g = merge(parts);
    g.scale(shape.span, 1, shape.length);
    return g;
  });

  const glassGeo = buildPart(`jet-glass-${key}`, () => {
    const canopy = new THREE.SphereGeometry(1, 12, 8);
    canopy.scale(0.8, 0.72, 2.1);
    canopy.translate(0, 0.8, -2.4);
    return canopy;
  });

  const burnerGeo = buildPart(`jet-burner-${key}`, () => {
    const cone = new THREE.ConeGeometry(0.46, 1, 8, 1, true);
    cone.rotateX(Math.PI / 2);
    cone.translate(0, 0, 0.5);
    return cone;
  });

  group.add(new THREE.Mesh(bodyGeo, body));
  group.add(new THREE.Mesh(darkGeo, dark));
  group.add(new THREE.Mesh(accentGeo, accent));
  group.add(new THREE.Mesh(glassGeo, glass));

  const burners: THREE.Mesh[] = [];
  for (const x of nozzleOffsets(shape)) {
    const burner = new THREE.Mesh(burnerGeo, flame.clone());
    burner.position.set(x * shape.span, 0, 6.1 * shape.length);
    // a single engine burns one bigger plume rather than two
    const width = shape.engines === 1 ? 1.5 : 1;
    burner.scale.set(width, width, 0.01);
    burners.push(burner);
    group.add(burner);
  }

  return { group, burners };
}

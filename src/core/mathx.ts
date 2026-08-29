export const DEG = Math.PI / 180;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp01((v - a) / (b - a));

/** Frame-rate independent exponential approach towards `to`. */
export const damp = (from: number, to: number, lambda: number, dt: number) =>
  lerp(from, to, 1 - Math.exp(-lambda * dt));

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Move `v` towards `target` by at most `maxDelta`. */
export const approach = (v: number, target: number, maxDelta: number) => {
  const d = target - v;
  return Math.abs(d) <= maxDelta ? target : v + Math.sign(d) * maxDelta;
};

export const smoothstep = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export const fmtInt = (n: number) => Math.round(n).toString();
export const fmtTime = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
};

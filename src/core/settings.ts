import { clamp01 } from './mathx';
import { ActionId, Bindings, defaultBindings } from './bindings';

export interface SettingsData {
  /** pulling back on the mouse raises the nose when false */
  invertPitch: boolean;
  invertRoll: boolean;
  /** coordinated turns + auto-levelling; off gives raw rate control */
  assist: boolean;
  /** 0..1, mapped onto the usable mouse-gain range */
  sensitivity: number;
  volume: number;
  muted: boolean;
  bindings: Bindings;
}

const KEY = 'harfighters.settings.v1';
/** previous name of this game — read once so existing preferences survive the rename */
const LEGACY_KEY = 'skyclash.settings.v2';

const DEFAULTS: SettingsData = {
  invertPitch: false,
  invertRoll: false,
  assist: true,
  sensitivity: 0.35,
  volume: 0.7,
  muted: false,
  bindings: defaultBindings(),
};

export const SENS_MIN = 0.0008;
export const SENS_MAX = 0.006;

/** Player preferences, persisted to localStorage and observable. */
export class Settings {
  data: SettingsData = { ...DEFAULTS };
  private listeners: Array<(d: SettingsData) => void> = [];

  constructor() { this.load(); }

  private load() {
    try {
      const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SettingsData>;
      for (const k of Object.keys(DEFAULTS) as Array<keyof SettingsData>) {
        if (k === 'bindings') continue;
        const v = parsed[k];
        if (typeof v === typeof DEFAULTS[k]) (this.data[k] as SettingsData[typeof k]) = v as never;
      }
      // merge bindings so a new action added later still gets its default
      if (parsed.bindings && typeof parsed.bindings === 'object') {
        this.data.bindings = { ...defaultBindings(), ...parsed.bindings };
      }
      this.data.sensitivity = clamp01(this.data.sensitivity);
      this.data.volume = clamp01(this.data.volume);
    } catch {
      // private browsing / blocked storage — defaults are fine
    }
  }

  private save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  onChange(cb: (d: SettingsData) => void) { this.listeners.push(cb); }

  private emit() {
    this.save();
    for (const cb of this.listeners) cb(this.data);
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]) {
    if (this.data[key] === value) return;
    this.data[key] = value;
    this.emit();
  }

  toggle(key: 'invertPitch' | 'invertRoll' | 'assist' | 'muted') {
    this.data[key] = !this.data[key];
    this.emit();
  }

  nudgeSensitivity(delta: number) {
    this.set('sensitivity', clamp01(this.data.sensitivity + delta));
  }

  nudgeVolume(delta: number) {
    this.set('volume', clamp01(this.data.volume + delta));
    if (this.data.volume > 0 && this.data.muted) this.set('muted', false);
  }

  /** Assign a key to an action, clearing whatever else was using it. */
  bind(action: ActionId, code: string) {
    // never store an empty code — that would silently unbind the action
    if (!code) return;
    const next: Bindings = { ...this.data.bindings };
    for (const id of Object.keys(next) as ActionId[]) {
      if (id !== action && next[id] === code) next[id] = '';
    }
    next[action] = code;
    this.data.bindings = next;
    this.emit();
  }

  key(action: ActionId): string { return this.data.bindings[action]; }

  get effectiveVolume(): number { return this.data.muted ? 0 : this.data.volume; }

  /** mouse gain in radians of virtual-stick travel per pixel of movement */
  get mouseGain(): number {
    return SENS_MIN + this.data.sensitivity * (SENS_MAX - SENS_MIN);
  }

  get sensitivityPct(): number { return Math.round(this.data.sensitivity * 100); }
  get volumePct(): number { return Math.round(this.data.volume * 100); }

  reset() {
    this.data = { ...DEFAULTS, bindings: defaultBindings() };
    this.emit();
  }
}

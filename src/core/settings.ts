import { clamp01 } from './mathx';
import { ActionId, Bindings, defaultBindings } from './bindings';
import { MapId, MAPS } from '../world/maps';
import { AirframeId, AIRFRAMES, DifficultyId, DIFFICULTIES, ModeId, MODES } from './config';

export const MAX_NAME = 14;
export const DEFAULT_NAME = 'VIPER';

/** Keep callsigns in the same shape as the AI ones, and safe to render as text. */
export function sanitizeName(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
  return cleaned || DEFAULT_NAME;
}

export interface SettingsData {
  /** the player's callsign, shown on the HUD, scoreboard and kill feed */
  pilotName: string;
  mapId: MapId;
  /** which set of match rules to play under */
  mode: ModeId;
  difficulty: DifficultyId;
  airframe: AirframeId;
  /** pulling back on the mouse raises the nose when false */
  invertPitch: boolean;
  invertRoll: boolean;
  /** coordinated turns + auto-levelling; off gives raw rate control */
  assist: boolean;
  /** cannon rounds follow the lead solution at close range */
  aimAssist: boolean;
  /** 0..1, mapped onto the usable mouse-gain range */
  sensitivity: number;
  volume: number;
  muted: boolean;
  /**
   * Skip buildings that are off screen. Worth nothing on a machine that can
   * already carry the whole city, so it defaults off and is there for ones
   * that cannot.
   */
  cullCity: boolean;
  bindings: Bindings;
}

const KEY = 'haffighters.settings.v1';
/** earlier names for this game — read as fallbacks so preferences survive renames */
const LEGACY_KEYS = ['harfighters.settings.v1', 'skyclash.settings.v2'];

const DEFAULTS: SettingsData = {
  pilotName: DEFAULT_NAME,
  mapId: 'CORAL',
  mode: 'DM',
  difficulty: 'REGULAR',
  airframe: 'FA9',
  invertPitch: false,
  invertRoll: false,
  assist: true,
  aimAssist: true,
  sensitivity: 0.15,
  volume: 0.7,
  muted: false,
  cullCity: false,
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
      let raw = localStorage.getItem(KEY);
      for (const legacy of LEGACY_KEYS) {
        if (raw) break;
        raw = localStorage.getItem(legacy);
      }
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
      if (!MODES[this.data.mode]) this.data.mode = 'DM';
      this.data.volume = clamp01(this.data.volume);
      this.data.pilotName = sanitizeName(this.data.pilotName);
      if (!MAPS[this.data.mapId]) this.data.mapId = DEFAULTS.mapId;
      if (!DIFFICULTIES[this.data.difficulty]) this.data.difficulty = DEFAULTS.difficulty;
      if (!AIRFRAMES[this.data.airframe]) this.data.airframe = DEFAULTS.airframe;
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

  toggle(key: 'invertPitch' | 'invertRoll' | 'assist' | 'aimAssist' | 'muted' | 'cullCity') {
    this.data[key] = !this.data[key];
    this.emit();
  }

  nudgeSensitivity(delta: number) {
    this.set('sensitivity', clamp01(this.data.sensitivity + delta));
  }

  setMap(id: MapId) { this.set('mapId', id); }

  setMode(id: ModeId) { this.set('mode', id); }

  setDifficulty(id: DifficultyId) { this.set('difficulty', id); }

  setAirframe(id: AirframeId) { this.set('airframe', id); }

  setPilotName(raw: string) {
    this.set('pilotName', sanitizeName(raw));
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

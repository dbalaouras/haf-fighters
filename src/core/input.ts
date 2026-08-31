import { clamp, damp } from './mathx';
import { CFG } from './config';
import { Settings } from './settings';
import { ActionId } from './bindings';

export interface Sample {
  pitch: number; roll: number; yaw: number; throttle: number;
  burner: boolean; gun: boolean; missile: boolean; flares: boolean; chaff: boolean;
  /** look-around offsets in radians, non-zero only while free look is held */
  freeLook: boolean; lookYaw: number; lookPitch: number;
}

/** radar ranges the scroll wheel steps through, in metres */
export const RADAR_RANGES = [2000, 4000, 6000, 10000, 16000] as const;

const DEAD = 0.12;

/** left/right variants of the same modifier, so binding one accepts either */
const TWINS: Record<string, string> = {
  ShiftLeft: 'ShiftRight', ShiftRight: 'ShiftLeft',
  ControlLeft: 'ControlRight', ControlRight: 'ControlLeft',
  AltLeft: 'AltRight', AltRight: 'AltLeft',
};
const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

/**
 * Flight is mouse-only: a pointer-locked "virtual stick" that recentres slowly, or
 * — where a browser refuses pointer lock — the cursor's offset from screen centre.
 * The keyboard handles throttle, rudder and weapons through rebindable actions.
 */
export class Input {
  private keys = new Set<string>();
  private mouseDown = new Set<number>();
  private stick = { x: 0, y: 0 };
  throttle: number = CFG.flight.cruiseThrottle;
  pointerLocked = false;
  /** false once requestPointerLock has been refused (embedded frames, some browsers) */
  lockAvailable = true;

  private pendingCameraToggle = false;
  private pendingWeaponSwap = false;
  private look = { yaw: 0, pitch: 0 };
  private radarStep = 2;
  private absMouse: { x: number; y: number } | null = null;
  private onLockChange?: (locked: boolean) => void;
  onEscape?: () => void;
  /** held-open scoreboard */
  onScoreboard?: (show: boolean) => void;

  constructor(private canvas: HTMLCanvasElement, private settings: Settings) {
    addEventListener('keydown', this.keyDown);
    addEventListener('keyup', this.keyUp);
    canvas.addEventListener('mousedown', this.mDown);
    addEventListener('mouseup', this.mUp);
    addEventListener('mousemove', this.mMove);
    addEventListener('blur', () => this.clearKeys());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) this.mouseDown.clear();
      this.onLockChange?.(this.pointerLocked);
    });
  }

  onPointerLockChange(cb: (locked: boolean) => void) { this.onLockChange = cb; }

  get invertPitch(): boolean { return this.settings.data.invertPitch; }

  requestLock() {
    if (!this.lockAvailable) return;
    // Safari returns undefined here; Chromium returns a promise that can reject
    // (e.g. inside an embedded frame) — and some browsers throw synchronously when
    // there is no user activation. Fall back to absolute-cursor steering either way.
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch(() => { this.lockAvailable = false; });
    } catch {
      this.lockAvailable = false;
    }
  }

  clearKeys() {
    this.keys.clear();
    this.mouseDown.clear();
    this.look.yaw = 0;
    this.look.pitch = 0;
    this.onScoreboard?.(false);
  }

  private bound(action: ActionId): boolean {
    const code = this.settings.key(action);
    if (!code) return false;
    if (this.keys.has(code)) return true;
    // treat the two shifts (and the two ctrls/alts) as the same key when bound
    const twin = TWINS[code];
    return !!twin && this.keys.has(twin);
  }

  private isBoundToAnything(code: string): boolean {
    return Object.values(this.settings.data.bindings).includes(code);
  }

  /** typing into a text field is not a game input */
  private typingInField(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private keyDown = (e: KeyboardEvent) => {
    if (this.typingInField(e)) return;
    if (e.code === 'Tab' || (e.code === 'Space' && this.pointerLocked)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape') this.onEscape?.();
    if (e.code === 'Tab') this.onScoreboard?.(true);
    this.keys.add(e.code);

    if (e.code === this.settings.key('camera')) this.pendingCameraToggle = true;
    if (e.code === this.settings.key('swapWeapon')) this.pendingWeaponSwap = true;

    // fixed shortcuts, skipped when the player has rebound that key to an action
    if (this.isBoundToAnything(e.code)) return;
    if (e.code === 'KeyI') this.settings.toggle('invertPitch');
    if (e.code === 'KeyG') this.settings.toggle('assist');
    if (e.code === 'KeyN') this.settings.toggle('muted');
    if (e.code === 'BracketLeft') this.settings.nudgeSensitivity(-0.08);
    if (e.code === 'BracketRight') this.settings.nudgeSensitivity(0.08);
  };

  private keyUp = (e: KeyboardEvent) => {
    if (this.typingInField(e)) return;
    if (e.code === 'Tab') this.onScoreboard?.(false);
    this.keys.delete(e.code);
  };
  private mDown = (e: MouseEvent) => { this.mouseDown.add(e.button); };
  private mUp = (e: MouseEvent) => { this.mouseDown.delete(e.button); };

  private mMove = (e: MouseEvent) => {
    if (this.bound('freeLook')) {
      // looking around must not also fly the aircraft
      const gain = this.settings.mouseGain * 1.6;
      this.look.yaw = clamp(this.look.yaw - e.movementX * gain, -Math.PI * 0.85, Math.PI * 0.85);
      this.look.pitch = clamp(this.look.pitch - e.movementY * gain, -1.1, 1.1);
      return;
    }
    if (this.pointerLocked) {
      const gain = this.settings.mouseGain;
      this.stick.x = clamp(this.stick.x + e.movementX * gain, -1, 1);
      this.stick.y = clamp(this.stick.y + e.movementY * gain, -1, 1);
    } else {
      this.absMouse = { x: e.clientX, y: e.clientY };
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    if (dir === 0) return;
    this.radarStep = clamp(this.radarStep + dir, 0, RADAR_RANGES.length - 1);
  };

  get radarRange(): number { return RADAR_RANGES[this.radarStep]; }

  consumeCameraToggle(): boolean {
    const v = this.pendingCameraToggle;
    this.pendingCameraToggle = false;
    return v;
  }

  consumeWeaponSwap(): boolean {
    const v = this.pendingWeaponSwap;
    this.pendingWeaponSwap = false;
    return v;
  }

  sample(dt: number): Sample {
    const freeLook = this.bound('freeLook');
    if (!freeLook) {
      // recentre the view when the key is let go
      this.look.yaw = damp(this.look.yaw, 0, 7, dt);
      this.look.pitch = damp(this.look.pitch, 0, 7, dt);
    }

    if (freeLook) {
      // hold the stick where it is rather than letting it drift while looking
    } else if (this.pointerLocked || !this.absMouse) {
      // the locked stick eases back to centre so you can let go and fly straight,
      // but the pitch axis holds far longer than roll — see CFG.assist.centrePitch
      this.stick.x = damp(this.stick.x, 0, CFG.assist.centreRoll, dt);
      this.stick.y = damp(this.stick.y, 0, CFG.assist.centrePitch, dt);
    } else {
      const reach = Math.min(innerWidth, innerHeight) * 0.34;
      this.stick.x = clamp((this.absMouse.x - innerWidth / 2) / reach, -1, 1);
      this.stick.y = clamp((this.absMouse.y - innerHeight / 2) / reach, -1, 1);
    }

    let roll = this.stick.x;
    let pitch = -this.stick.y;
    let yaw = (this.bound('rudderRight') ? 1 : 0) - (this.bound('rudderLeft') ? 1 : 0);

    let gun = this.mouseDown.has(0) || this.bound('fireGun');
    let missile = this.mouseDown.has(2) || this.bound('fireMissile');
    let flares = this.bound('flares');
    let chaff = this.bound('chaff');

    let burner = this.bound('afterburner');
    let brake = this.bound('brake');

    // gamepad overlay: left stick flies, triggers are throttle
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      roll += dz(p.axes[0] ?? 0);
      pitch -= dz(p.axes[1] ?? 0);
      yaw += dz(p.axes[2] ?? 0);
      burner = burner || (p.buttons[7]?.value ?? 0) > 0.5;
      brake = brake || (p.buttons[6]?.value ?? 0) > 0.5;
      gun = gun || !!p.buttons[0]?.pressed || !!p.buttons[5]?.pressed;
      missile = missile || !!p.buttons[1]?.pressed || !!p.buttons[4]?.pressed;
      flares = flares || !!p.buttons[2]?.pressed;
      chaff = chaff || !!p.buttons[3]?.pressed;
      break;
    }

    // Throttle is not something the player trims: it holds cruise, drops on the
    // brake, and runs to full while the burner is called for.
    const F = CFG.flight;
    const target = burner ? 1 : brake ? F.brakeThrottle : F.cruiseThrottle;
    this.throttle = clamp(damp(this.throttle, target, F.throttleResponse, dt), 0, 1);

    if (this.settings.data.invertPitch) pitch = -pitch;
    if (this.settings.data.invertRoll) roll = -roll;

    return {
      pitch: clamp(pitch, -1, 1),
      roll: clamp(roll, -1, 1),
      yaw: clamp(yaw, -1, 1),
      throttle: this.throttle,
      burner, gun, missile, flares, chaff,
      freeLook, lookYaw: this.look.yaw, lookPitch: this.look.pitch,
    };
  }
}

import { clamp, damp } from './mathx';
import { CFG } from './config';
import { Settings } from './settings';
import { ActionId } from './bindings';

export interface Sample {
  pitch: number; roll: number; yaw: number; throttle: number;
  burner: boolean; gun: boolean; missile: boolean; flares: boolean;
}

const DEAD = 0.12;
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
    // (e.g. inside an embedded frame) — fall back to absolute-cursor steering.
    const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch(() => { this.lockAvailable = false; });
  }

  clearKeys() {
    this.keys.clear();
    this.mouseDown.clear();
    this.onScoreboard?.(false);
  }

  private bound(action: ActionId): boolean {
    const code = this.settings.key(action);
    return !!code && this.keys.has(code);
  }

  private isBoundToAnything(code: string): boolean {
    return Object.values(this.settings.data.bindings).includes(code);
  }

  private keyDown = (e: KeyboardEvent) => {
    if (e.code === 'Tab' || (e.code === 'Space' && this.pointerLocked)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape') this.onEscape?.();
    if (e.code === 'Tab') this.onScoreboard?.(true);
    this.keys.add(e.code);

    if (e.code === this.settings.key('camera')) this.pendingCameraToggle = true;

    // fixed shortcuts, skipped when the player has rebound that key to an action
    if (this.isBoundToAnything(e.code)) return;
    if (e.code === 'KeyI') this.settings.toggle('invertPitch');
    if (e.code === 'KeyG') this.settings.toggle('assist');
    if (e.code === 'KeyN') this.settings.toggle('muted');
    if (e.code === 'BracketLeft') this.settings.nudgeSensitivity(-0.08);
    if (e.code === 'BracketRight') this.settings.nudgeSensitivity(0.08);
  };

  private keyUp = (e: KeyboardEvent) => {
    if (e.code === 'Tab') this.onScoreboard?.(false);
    this.keys.delete(e.code);
  };
  private mDown = (e: MouseEvent) => { this.mouseDown.add(e.button); };
  private mUp = (e: MouseEvent) => { this.mouseDown.delete(e.button); };

  private mMove = (e: MouseEvent) => {
    if (this.pointerLocked) {
      const gain = this.settings.mouseGain;
      this.stick.x = clamp(this.stick.x + e.movementX * gain, -1, 1);
      this.stick.y = clamp(this.stick.y + e.movementY * gain, -1, 1);
    } else {
      this.absMouse = { x: e.clientX, y: e.clientY };
    }
  };

  consumeCameraToggle(): boolean {
    const v = this.pendingCameraToggle;
    this.pendingCameraToggle = false;
    return v;
  }

  sample(dt: number): Sample {
    if (this.pointerLocked || !this.absMouse) {
      // the locked stick eases back to centre so you can let go and fly straight
      this.stick.x = damp(this.stick.x, 0, 1.1, dt);
      this.stick.y = damp(this.stick.y, 0, 1.1, dt);
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
      burner, gun, missile, flares,
    };
  }
}

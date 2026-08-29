import * as THREE from 'three';
import { CFG, TEAM, TeamId, WEAPONS, WEAPON_ORDER } from '../core/config';
import { Aircraft } from '../entities/aircraft';
import { Waypoint } from '../world/waypoints';
import { clamp01, fmtTime, lerp } from '../core/mathx';

export interface FeedLine { text: string; team: TeamId | null; t: number }

export interface HudState {
  player: Aircraft;
  aircraft: readonly Aircraft[];
  camera: THREE.PerspectiveCamera;
  score: Record<TeamId, number>;
  timeLeft: number;
  feed: FeedLine[];
  banner: { text: string; sub?: string; color?: string } | null;
  oobSeconds: number;
  damageFlash: number;
  fps: number;
  agl: number;
  assist: boolean;
  invertPitch: boolean;
  muted: boolean;
  waypoints: readonly Waypoint[];
  rearmFlash: number;
  radarRange: number;
  freeLook: boolean;
  /** where the player's rounds would arrive, or null with nothing in front */
  gun: {
    point: THREE.Vector3; dist: number; missBy: number; hot: boolean; name: string;
  } | null;
}

const ACCENT = '#7fe3b0';
const WARN = '#ff5a4a';
const DIM = 'rgba(127, 227, 176, 0.42)';
const INK = 'rgba(6, 14, 20, 0.55)';

export class Hud {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private _v = new THREE.Vector3();
  private time = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.w = innerWidth;
    this.h = innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  /** world -> screen px; null when behind the camera */
  private project(p: THREE.Vector3, camera: THREE.Camera): { x: number; y: number } | null {
    this._v.copy(p).project(camera);
    if (this._v.z > 1) return null;
    return { x: (this._v.x * 0.5 + 0.5) * this.w, y: (-this._v.y * 0.5 + 0.5) * this.h };
  }

  draw(s: HudState, dt: number) {
    this.time += dt;
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.font = '11px "SF Mono", Menlo, monospace';
    c.textBaseline = 'middle';
    c.lineWidth = 1;

    if (s.damageFlash > 0) this.damageVignette(s.damageFlash);

    this.rearmMarkers(s);
    this.contacts(s);
    if (s.player.alive) {
      this.reticle(s);
      this.gunPipper(s);
      this.bankScale(s);
      this.speedTape(s);
      this.altTape(s);
      this.throttleBlock(s);
      this.weaponsBlock(s);
      this.compass(s);
    }
    this.radar(s);
    this.scoreboard(s);
    this.feed(s);
    this.warnings(s);
    this.banner(s);
    this.debug(s);
  }

  /* ---------------- contacts & lock ---------------- */

  private contacts(s: HudState) {
    const c = this.ctx;
    const p = s.player;

    for (const a of s.aircraft) {
      if (!a.alive || a === p) continue;
      const dist = p.pos.distanceTo(a.pos);
      if (dist > 9000) continue;

      const sp = this.project(a.pos, s.camera);
      const hostile = a.team !== p.team;
      const col = hostile ? WARN : TEAM[a.team].css;

      if (!sp) continue;

      const size = clamp01(1 - dist / 9000) * 26 + 12;
      const half = size / 2;
      c.strokeStyle = col;
      c.globalAlpha = hostile ? 0.95 : 0.55;

      if (hostile) {
        c.strokeRect(sp.x - half, sp.y - half, size, size);
        c.fillStyle = col;
        c.globalAlpha = 0.85;
        c.textAlign = 'left';
        c.fillText(`${a.name}`, sp.x + half + 6, sp.y - 6);
        c.fillText(`${(dist / 1000).toFixed(1)}km`, sp.x + half + 6, sp.y + 7);
        // health pips
        const hpw = size;
        c.globalAlpha = 0.35;
        c.fillRect(sp.x - half, sp.y + half + 5, hpw, 2.5);
        c.globalAlpha = 0.95;
        c.fillStyle = a.hp > 50 ? ACCENT : '#ffd166';
        c.fillRect(sp.x - half, sp.y + half + 5, hpw * (a.hp / CFG.hull.hp), 2.5);
      } else {
        // friendly: small diamond
        c.beginPath();
        c.moveTo(sp.x, sp.y - half * 0.7);
        c.lineTo(sp.x + half * 0.7, sp.y);
        c.lineTo(sp.x, sp.y + half * 0.7);
        c.lineTo(sp.x - half * 0.7, sp.y);
        c.closePath();
        c.stroke();
      }
      c.globalAlpha = 1;
    }

    // lock brackets on the current target
    const t = p.lockTarget;
    if (t && t.alive) {
      const sp = this.project(t.pos, s.camera);
      const dist = p.pos.distanceTo(t.pos);
      if (sp) {
        const locked = p.locked;
        const prog = locked ? 1 : p.lockProgress;
        const base = clamp01(1 - dist / 9000) * 26 + 18;
        const r = lerp(base * 2.4, base, prog);
        c.strokeStyle = locked ? WARN : '#ffd166';
        c.lineWidth = locked ? 2 : 1.4;
        c.globalAlpha = locked ? 0.9 + Math.sin(this.time * 14) * 0.1 : 0.8;
        const corner = r * 0.42;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          c.beginPath();
          c.moveTo(sp.x + sx * r, sp.y + sy * r - sy * corner);
          c.lineTo(sp.x + sx * r, sp.y + sy * r);
          c.lineTo(sp.x + sx * r - sx * corner, sp.y + sy * r);
          c.stroke();
        }
        if (locked) {
          c.fillStyle = WARN;
          c.textAlign = 'center';
          c.fillText('LOCK', sp.x, sp.y - r - 12);
        }
        c.lineWidth = 1;
        c.globalAlpha = 1;
      } else {
        this.offscreenArrow(t.pos, s);
      }
    }
  }

  /** Ring markers, showing whether each gate is up and how far away it is. */
  private rearmMarkers(s: HudState) {
    const c = this.ctx;
    const p = s.player;
    if (!p.alive) return;

    for (const wp of s.waypoints) {
      const sp = this.project(wp.pos, s.camera);
      if (!sp) continue;
      const dist = p.pos.distanceTo(wp.pos);
      const cooling = wp.cooldown > 0;
      const near = dist < 1400;

      c.globalAlpha = cooling ? 0.4 : near ? 0.9 : 0.55;
      c.strokeStyle = cooling ? '#ff8a5c' : '#7fe3ff';
      const r = near ? 13 : 9;

      // a circle for a ring, rather than the old diamond
      c.beginPath();
      c.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.arc(sp.x, sp.y, r * 0.42, 0, Math.PI * 2);
      c.stroke();

      c.fillStyle = cooling ? '#ff8a5c' : '#7fe3ff';
      c.textAlign = 'center';
      c.fillText(
        cooling ? `${wp.cooldown.toFixed(1)}s` : `REARM ${(dist / 1000).toFixed(1)}km`,
        sp.x, sp.y + r + 12,
      );
      c.globalAlpha = 1;
    }
  }

  private offscreenArrow(target: THREE.Vector3, s: HudState) {
    const c = this.ctx;
    const cam = s.camera;
    const local = this._v.copy(target).applyMatrix4(cam.matrixWorldInverse);
    const ang = Math.atan2(local.x, -local.y) - Math.PI / 2;
    const cx = this.w / 2, cy = this.h / 2;
    const r = Math.min(this.w, this.h) * 0.33;
    const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.fillStyle = WARN;
    c.globalAlpha = 0.85;
    c.beginPath();
    c.moveTo(10, 0); c.lineTo(-6, 6); c.lineTo(-6, -6);
    c.closePath();
    c.fill();
    c.restore();
    c.globalAlpha = 1;
  }

  /* ---------------- flight instruments ---------------- */

  private reticle(s: HudState) {
    const c = this.ctx;
    const cx = this.w / 2, cy = this.h / 2;

    c.strokeStyle = ACCENT;
    c.globalAlpha = 0.9;
    c.beginPath();
    c.arc(cx, cy, 13, 0, Math.PI * 2);
    c.stroke();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1]] as const) {
      c.beginPath();
      c.moveTo(cx + dx * 16, cy + dy * 16);
      c.lineTo(cx + dx * 26, cy + dy * 26);
      c.stroke();
    }
    c.beginPath();
    c.arc(cx, cy, 1.6, 0, Math.PI * 2);
    c.fillStyle = ACCENT;
    c.fill();

    // gun heat arc
    if (s.player.gunHeat > 0.02) {
      c.strokeStyle = s.player.gunOverheated ? WARN : s.player.gunHeat > 0.7 ? '#ff9d4a' : '#ffd166';
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(s.player.gunHeat));
      c.stroke();
      c.lineWidth = 1;
    }

    // velocity vector (flight path marker)
    const fpm = this.project(this._v.copy(s.player.pos).addScaledVector(s.player.forward(), 800), s.camera);
    if (fpm) {
      c.strokeStyle = DIM;
      c.beginPath();
      c.arc(fpm.x, fpm.y, 5, 0, Math.PI * 2);
      c.moveTo(fpm.x - 10, fpm.y); c.lineTo(fpm.x - 5, fpm.y);
      c.moveTo(fpm.x + 5, fpm.y); c.lineTo(fpm.x + 10, fpm.y);
      c.moveTo(fpm.x, fpm.y - 5); c.lineTo(fpm.x, fpm.y - 10);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  /**
   * The gunsight: a pipper on the point the rounds would actually reach, with a
   * lead line back to the boresight. It fills in when the solution is good, which
   * is the whole point — the cannon is otherwise pure guesswork against a turning
   * target, since the lead angle runs to a dozen degrees at typical range.
   */
  private gunPipper(s: HudState) {
    const sol = s.gun;
    if (!sol) return;

    const sp = this.project(sol.point, s.camera);
    if (!sp) return;

    const c = this.ctx;
    const cx = this.w / 2, cy = this.h / 2;
    // fade in as the shot becomes plausible rather than popping into view
    const near = clamp01(1 - (sol.dist - CFG.gun.range) / (CFG.gun.pipperRange - CFG.gun.range));
    const alpha = 0.35 + 0.65 * near;
    const col = sol.hot ? '#ffd166' : ACCENT;

    // lead line from the boresight out to the solution
    c.globalAlpha = alpha * 0.4;
    c.strokeStyle = col;
    c.setLineDash([4, 5]);
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(sp.x, sp.y);
    c.stroke();
    c.setLineDash([]);

    // the pipper itself
    c.globalAlpha = alpha;
    c.lineWidth = sol.hot ? 2 : 1.3;
    c.strokeStyle = col;
    c.beginPath();
    c.arc(sp.x, sp.y, 9, 0, Math.PI * 2);
    c.stroke();

    if (sol.hot) {
      c.fillStyle = col;
      c.beginPath();
      c.arc(sp.x, sp.y, 3.2, 0, Math.PI * 2);
      c.fill();
    }

    // range arc: a full ring at the muzzle, closing as the target runs away
    const rangeLeft = clamp01(1 - sol.dist / CFG.gun.range);
    if (rangeLeft > 0) {
      c.globalAlpha = alpha * 0.85;
      c.lineWidth = 2.4;
      c.beginPath();
      c.arc(sp.x, sp.y, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * rangeLeft);
      c.stroke();
    }

    c.lineWidth = 1;
    c.globalAlpha = alpha * 0.9;
    c.fillStyle = col;
    c.textAlign = 'left';
    c.fillText(`${sol.dist.toFixed(0)}m`, sp.x + 20, sp.y + 4);
    c.globalAlpha = 1;
  }

  /**
   * Fixed roll scale with a moving sky pointer, the way a real HUD shows bank.
   * With flight assist on this is also the clearest feedback that the jet is
   * rolling itself back to level when the stick is released.
   */
  private bankScale(s: HudState) {
    const c = this.ctx;
    const cx = this.w / 2, cy = this.h / 2;
    const r = 62;
    const bank = s.player.bank;

    c.strokeStyle = 'rgba(127, 227, 176, 0.62)';
    c.globalAlpha = 1;
    for (const deg of [-60, -45, -30, -15, 0, 15, 30, 45, 60]) {
      const th = -Math.PI / 2 + deg * Math.PI / 180;
      const major = deg === 0 || Math.abs(deg) === 30 || Math.abs(deg) === 60;
      const len = major ? 9 : 5;
      c.lineWidth = major ? 1.6 : 1;
      const x0 = cx + Math.cos(th) * r, y0 = cy + Math.sin(th) * r;
      const x1 = cx + Math.cos(th) * (r + len), y1 = cy + Math.sin(th) * (r + len);
      c.beginPath();
      c.moveTo(x0, y0); c.lineTo(x1, y1);
      c.stroke();
    }
    c.lineWidth = 1;

    // pointer: rotates opposite the bank, clamped so it stays on the scale
    const inverted = Math.abs(bank) > Math.PI / 2;
    const shown = clamp01(Math.abs(bank) / (70 * Math.PI / 180)) * Math.sign(bank) * (70 * Math.PI / 180);
    const th = -Math.PI / 2 - shown;
    c.fillStyle = inverted ? '#ffd166' : ACCENT;
    c.globalAlpha = 1;
    c.save();
    c.translate(cx + Math.cos(th) * (r - 2), cy + Math.sin(th) * (r - 2));
    c.rotate(th + Math.PI / 2);
    c.beginPath();
    c.moveTo(0, -6); c.lineTo(-4.5, 1.5); c.lineTo(4.5, 1.5);
    c.closePath();
    c.fill();
    c.restore();
    c.globalAlpha = 1;
  }

  private tape(x: number, label: string, value: number, step: number, digits: number, align: 'left' | 'right') {
    const c = this.ctx;
    const cy = this.h / 2;
    const H = 190;
    const pxPerUnit = H / (step * 6);

    c.strokeStyle = DIM;
    c.fillStyle = ACCENT;
    c.globalAlpha = 0.75;
    c.beginPath();
    c.moveTo(x, cy - H / 2); c.lineTo(x, cy + H / 2);
    c.stroke();

    const first = Math.ceil((value - step * 3) / step) * step;
    c.textAlign = align === 'left' ? 'right' : 'left';
    for (let v = first; v <= value + step * 3; v += step) {
      const y = cy + (value - v) * pxPerUnit;
      const major = Math.abs(v % (step * 2)) < 1e-6;
      const len = major ? 9 : 5;
      c.globalAlpha = 0.5;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (align === 'left' ? -len : len), y);
      c.stroke();
      if (major) {
        c.globalAlpha = 0.65;
        c.fillText(v.toFixed(0), x + (align === 'left' ? -13 : 13), y);
      }
    }

    // current-value box
    c.globalAlpha = 1;
    const bw = 58, bh = 20;
    const bx = align === 'left' ? x - bw - 16 : x + 16;
    c.fillStyle = INK;
    c.fillRect(bx, cy - bh / 2, bw, bh);
    c.strokeStyle = ACCENT;
    c.strokeRect(bx, cy - bh / 2, bw, bh);
    c.fillStyle = '#dffff0';
    c.textAlign = 'center';
    c.font = '13px "SF Mono", Menlo, monospace';
    c.fillText(value.toFixed(digits), bx + bw / 2, cy);
    c.font = '10px "SF Mono", Menlo, monospace';
    c.fillStyle = DIM;
    c.fillText(label, bx + bw / 2, cy - bh / 2 - 10);
    c.font = '11px "SF Mono", Menlo, monospace';
  }

  private speedTape(s: HudState) {
    this.tape(this.w / 2 - 200, 'M/S', s.player.speed, 50, 0, 'left');
    const c = this.ctx;
    c.fillStyle = DIM;
    c.textAlign = 'center';
    c.fillText(`${(s.player.speed * 1.94384).toFixed(0)} KT`, this.w / 2 - 245, this.h / 2 + 112);
    c.fillText(`${s.player.gforce.toFixed(1)} G`, this.w / 2 - 245, this.h / 2 + 127);
  }

  private altTape(s: HudState) {
    this.tape(this.w / 2 + 200, 'ALT M', s.player.pos.y, 500, 0, 'right');
    const c = this.ctx;
    c.fillStyle = s.agl < 250 ? WARN : DIM;
    c.textAlign = 'center';
    c.fillText(`AGL ${s.agl.toFixed(0)}`, this.w / 2 + 245, this.h / 2 + 112);
  }

  private compass(s: HudState) {
    const c = this.ctx;
    const f = s.player.forward();
    const hdg = (Math.atan2(f.x, -f.z) * 180 / Math.PI + 360) % 360;
    const cx = this.w / 2, y = 74;
    const span = 300, pxPerDeg = span / 90;

    c.save();
    c.beginPath();
    c.rect(cx - span / 2, y - 16, span, 32);
    c.clip();
    c.strokeStyle = DIM;
    c.fillStyle = DIM;
    c.textAlign = 'center';
    for (let d = -50; d <= 50; d += 5) {
      const deg = hdg + d;
      const x = cx + d * pxPerDeg;
      const major = ((Math.round(deg) % 10) + 10) % 10 === 0;
      c.globalAlpha = 0.55;
      c.beginPath();
      c.moveTo(x, y + 6);
      c.lineTo(x, y + (major ? -2 : 2));
      c.stroke();
      if (major) {
        const lab = ((Math.round(deg) % 360) + 360) % 360;
        c.globalAlpha = 0.7;
        c.fillText(lab.toString().padStart(3, '0'), x, y - 9);
      }
    }
    c.restore();

    c.globalAlpha = 1;
    c.fillStyle = ACCENT;
    c.beginPath();
    c.moveTo(cx, y + 10); c.lineTo(cx - 5, y + 17); c.lineTo(cx + 5, y + 17);
    c.closePath();
    c.fill();
  }

  /* ---------------- weapons & throttle ---------------- */

  private bar(x: number, y: number, w: number, h: number, t: number, col: string, label: string) {
    const c = this.ctx;
    c.fillStyle = INK;
    c.fillRect(x, y, w, h);
    c.fillStyle = col;
    c.fillRect(x, y, w * clamp01(t), h);
    c.strokeStyle = DIM;
    c.strokeRect(x, y, w, h);
    c.fillStyle = DIM;
    c.textAlign = 'left';
    c.fillText(label, x, y - 9);
  }

  private throttleBlock(s: HudState) {
    const c = this.ctx;
    const p = s.player;
    const x = 42, y = this.h - 148, w = 150, h = 12;

    const lit = p.burnerActive;
    this.bar(x, y, w, h, p.controls.throttle, lit ? '#ff9d4a' : ACCENT,
      `THR ${(p.controls.throttle * 100).toFixed(0)}%`);

    // afterburner fuel — the resource the player is actually managing
    const dry = p.burnerFuel <= 0.001;
    const fuelCol = dry ? WARN : lit ? '#ff9d4a' : '#ffd166';
    const label = dry ? 'AB  DRY' : lit ? 'AB  BURNING' : `AB  ${(p.burnerFuel * 100).toFixed(0)}%`;
    this.bar(x, y + 34, w, h, p.burnerFuel, fuelCol, label);
    if (lit || dry) {
      // pulse the gauge while it matters
      c.globalAlpha = 0.35 + 0.35 * Math.sin(this.time * (dry ? 9 : 14));
      c.strokeStyle = fuelCol;
      c.strokeRect(x - 2, y + 32, w + 4, h + 4);
      c.globalAlpha = 1;
    }

    this.bar(x, y + 68, w, h, p.hp / p.frame.hp,
      p.hp > 60 ? ACCENT : p.hp > 30 ? '#ffd166' : WARN, `HULL ${p.hp.toFixed(0)}%`);

    // subsystem condition, so a hit reads as "what broke" and not just a number
    const sys: ReadonlyArray<[string, number]> = [
      ['ENG', p.systems.engine],
      ['CTL', p.systems.controls],
      ['FUEL', p.systems.fuel],
    ];
    const cellW = w / 3;
    sys.forEach(([label, v], i) => {
      const sx = x + i * cellW;
      const col = v > 0.66 ? ACCENT : v > 0.33 ? '#ffd166' : WARN;
      c.fillStyle = INK;
      c.fillRect(sx, y + 92, cellW - 5, 5);
      c.fillStyle = col;
      c.fillRect(sx, y + 92, (cellW - 5) * clamp01(v), 5);
      c.fillStyle = v > 0.66 ? DIM : col;
      c.textAlign = 'left';
      c.fillText(label, sx, y + 87);
    });

    // control-mode readout, so the current flight model is never a mystery
    const flags = [s.assist ? 'ASSIST' : 'MANUAL'];
    if (s.freeLook) flags.push('LOOK');
    if (s.invertPitch) flags.push('INV');
    if (s.muted) flags.push('MUTED');
    c.fillStyle = DIM;
    c.textAlign = 'left';
    c.fillText(flags.join('  ·  '), x, y + 118);
  }

  private weaponsBlock(s: HudState) {
    const c = this.ctx;
    const p = s.player;
    const right = this.w - 42;
    const pipW = 8, gap = 5;

    // the cannon has unlimited rounds; heat is what stops you firing
    c.textAlign = 'right';
    c.fillStyle = DIM;
    c.fillText('CANNON', right, this.h - 122);
    c.fillStyle = p.gunOverheated ? WARN : p.gunHeat > 0.7 ? '#ff9d4a' : '#dffff0';
    c.font = '15px "SF Mono", Menlo, monospace';
    c.fillText(p.gunOverheated ? 'OVERHEAT' : `${Math.round(p.gunHeat * 100)}°`, right, this.h - 104);
    c.font = '11px "SF Mono", Menlo, monospace';

    // missiles: both types listed, the selected one highlighted
    let wy = this.h - 84;
    for (const id of WEAPON_ORDER) {
      const spec = WEAPONS[id];
      const rounds = p.ammo[id];
      const active = p.weapon === id;
      const col = rounds === 0 ? 'rgba(127,227,176,0.25)' : active ? ACCENT : DIM;

      c.textAlign = 'right';
      c.fillStyle = col;
      c.fillText(`${active ? '▸ ' : ''}${spec.tag}`, right - CFG.missile.pipWidth, wy);

      const capacity = p.frame.ammo[id];
      for (let i = 0; i < capacity; i++) {
        const x = right - (capacity - i) * (pipW + gap);
        c.fillStyle = i < rounds
          ? (active ? ACCENT : 'rgba(127,227,176,0.4)')
          : 'rgba(127,227,176,0.14)';
        c.fillRect(x, wy - 5, pipW, 10);
      }
      wy += 20;
    }

    // reload bar for whichever type is selected
    if (p.missileCooldown > 0 && p.missiles > 0) {
      const spec = p.weaponSpec;
      const t = 1 - clamp01(p.missileCooldown / spec.reload);
      const w = p.frame.ammo[p.weapon] * (pipW + gap);
      c.fillStyle = '#ffd166';
      c.fillRect(right - w, wy - 2, w * t, 2.5);
    }

    // flares, counted in salvos since that is how they are dispensed
    // countermeasures: flares defeat infrared, chaff defeats radar
    const cm: ReadonlyArray<[string, number, number, number, boolean, string]> = [
      ['FLARE', p.flares, p.frame.flares, CFG.flare.salvo, p.flareCooldown <= 0, '255,209,102'],
      ['CHAFF', p.chaff, p.frame.chaff, CFG.chaff.salvo, p.chaffCooldown <= 0, '190,208,240'],
    ];
    let cy = this.h - 34;
    for (const [label, held, max, salvo, ready, rgb] of cm) {
      const salvos = Math.floor(held / salvo);
      const maxSalvos = Math.floor(max / salvo);
      c.fillStyle = ready && salvos > 0 ? DIM : 'rgba(127,227,176,0.22)';
      c.textAlign = 'right';
      c.fillText(label, right - CFG.missile.pipWidth, cy + 8);
      for (let i = 0; i < maxSalvos; i++) {
        const x = right - (maxSalvos - i) * (pipW + gap);
        c.fillStyle = i < salvos
          ? `rgba(${rgb},${ready ? 1 : 0.32})`
          : `rgba(${rgb},0.14)`;
        c.fillRect(x, cy, pipW, 10);
      }
      cy += 16;
    }
  }

  /* ---------------- radar ---------------- */

  /** Radar geometry, shared so anything else can lay out around it. */
  private radarLayout() {
    const r = Math.min(74, this.w * 0.11, this.h * 0.14);
    return { r, cx: this.w - r - 42, cy: r + 46 };
  }

  private radar(s: HudState) {
    const c = this.ctx;
    const p = s.player;
    const { r, cx, cy } = this.radarLayout();
    const range = s.radarRange;

    c.fillStyle = 'rgba(6, 18, 24, 0.5)';
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = DIM;
    for (const rr of [r, r * 0.62, r * 0.3]) {
      c.beginPath();
      c.arc(cx, cy, rr, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(cx - r, cy); c.lineTo(cx + r, cy);
    c.moveTo(cx, cy - r); c.lineTo(cx, cy + r);
    c.globalAlpha = 0.35;
    c.stroke();
    c.globalAlpha = 1;

    const f = p.forward();
    const hdg = Math.atan2(f.x, -f.z);

    // rearm zones first, so contacts draw over them
    for (const wp of s.waypoints) {
      const dx = wp.pos.x - p.pos.x, dz = wp.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const k = Math.min(1, d / range) * r;
      const rel = Math.atan2(dx, -dz) - hdg;
      const x = cx + Math.sin(rel) * k;
      const y = cy - Math.cos(rel) * k;
      c.strokeStyle = wp.cooldown > 0 ? 'rgba(255,138,92,0.5)' : 'rgba(127,227,255,0.8)';
      c.beginPath();
      c.arc(x, y, 3.5, 0, Math.PI * 2);
      c.stroke();
    }

    for (const a of s.aircraft) {
      if (!a.alive || a === p) continue;
      const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const k = Math.min(1, d / range) * r;
      const ang = Math.atan2(dx, -dz);
      const rel = ang - hdg;
      const x = cx + Math.sin(rel) * k;
      const y = cy - Math.cos(rel) * k;
      const hostile = a.team !== p.team;
      c.fillStyle = hostile ? WARN : TEAM[a.team].css;
      const size = a === p.lockTarget ? 4 : 2.6;
      c.beginPath();
      c.arc(x, y, size, 0, Math.PI * 2);
      c.fill();
      // altitude relative marker
      if (hostile) {
        c.strokeStyle = WARN;
        c.globalAlpha = 0.5;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x, y - Math.max(-8, Math.min(8, (a.pos.y - p.pos.y) / 200)));
        c.stroke();
        c.globalAlpha = 1;
      }
    }
    c.fillStyle = ACCENT;
    c.beginPath();
    c.moveTo(cx, cy - 5); c.lineTo(cx - 3.5, cy + 4); c.lineTo(cx + 3.5, cy + 4);
    c.closePath();
    c.fill();

    c.fillStyle = DIM;
    c.textAlign = 'center';
    c.fillText(`${(range / 1000).toFixed(0)} KM  ⌃⌄`, cx, cy + r + 12);
  }

  /* ---------------- match info ---------------- */

  private scoreboard(s: HudState) {
    const c = this.ctx;
    const cx = this.w / 2;

    c.textAlign = 'center';
    c.font = '12px "SF Mono", Menlo, monospace';
    c.fillStyle = DIM;
    c.fillText(fmtTime(s.timeLeft), cx, 22);

    c.font = '22px "SF Mono", Menlo, monospace';
    c.textAlign = 'right';
    c.fillStyle = TEAM.BLUE.css;
    c.fillText(`${s.score.BLUE}`, cx - 22, 44);
    c.textAlign = 'left';
    c.fillStyle = TEAM.RED.css;
    c.fillText(`${s.score.RED}`, cx + 22, 44);
    c.textAlign = 'center';
    c.fillStyle = DIM;
    c.font = '11px "SF Mono", Menlo, monospace';
    c.fillText('—', cx, 44);
    c.fillText(`FIRST TO ${CFG.match.scoreLimit}`, cx, 60);

    // team strength bars
    const alive = (t: TeamId) => s.aircraft.filter((a) => a.team === t && a.alive).length;
    const drawPips = (t: TeamId, x: number, dir: number) => {
      const n = alive(t);
      for (let i = 0; i < CFG.match.teamSize; i++) {
        c.fillStyle = i < n ? TEAM[t].css : 'rgba(255,255,255,0.14)';
        c.fillRect(x + dir * i * 9, 12, 6, 4);
      }
    };
    drawPips('BLUE', cx - 100, -1);
    drawPips('RED', cx + 94, 1);
  }

  private feed(s: HudState) {
    const c = this.ctx;
    const rl = this.radarLayout();
    c.textAlign = 'right';
    // starts below the radar, which now occupies the top-right corner
    let y = rl.cy + rl.r + 34;
    for (const line of s.feed.slice(-6)) {
      const a = clamp01(line.t / 1.2);
      c.globalAlpha = a;
      c.fillStyle = line.team ? TEAM[line.team].css : '#dffff0';
      c.fillText(line.text, this.w - 42, y);
      y += 17;
    }
    c.globalAlpha = 1;
  }

  private warnings(s: HudState) {
    const c = this.ctx;
    const cx = this.w / 2;
    const p = s.player;
    let y = this.h / 2 + 140;

    const blink = Math.sin(this.time * 12) > -0.2;

    if (p.threat > 0 && blink) {
      c.fillStyle = WARN;
      c.textAlign = 'center';
      c.font = '15px "SF Mono", Menlo, monospace';
      c.fillText('◤ MISSILE INBOUND ◢', cx, y);
      c.font = '11px "SF Mono", Menlo, monospace';
      y += 20;
    }
    if (s.agl < 250 && p.alive && blink) {
      c.fillStyle = WARN;
      c.textAlign = 'center';
      c.fillText('PULL UP', cx, y);
      y += 18;
    }
    if (s.rearmFlash > 0 && p.alive) {
      c.globalAlpha = clamp01(s.rearmFlash);
      c.fillStyle = '#7fe3ff';
      c.textAlign = 'center';
      c.font = '15px "SF Mono", Menlo, monospace';
      c.fillText('◆ REARMED ◆', cx, y);
      c.font = '11px "SF Mono", Menlo, monospace';
      c.globalAlpha = 1;
      y += 20;
    }
    if (s.oobSeconds > 0) {
      c.fillStyle = blink ? WARN : '#ffd166';
      c.textAlign = 'center';
      c.fillText(`RETURN TO COMBAT AREA — ${s.oobSeconds.toFixed(0)}s`, cx, y);
    }
  }

  private banner(s: HudState) {
    if (!s.banner) return;
    const c = this.ctx;
    const cx = this.w / 2, cy = this.h * 0.34;
    c.textAlign = 'center';
    c.font = '30px "SF Mono", Menlo, monospace';
    c.fillStyle = s.banner.color ?? '#dffff0';
    c.fillText(s.banner.text, cx, cy);
    if (s.banner.sub) {
      c.font = '12px "SF Mono", Menlo, monospace';
      c.fillStyle = DIM;
      c.fillText(s.banner.sub, cx, cy + 28);
    }
    c.font = '11px "SF Mono", Menlo, monospace';
  }

  private damageVignette(t: number) {
    const c = this.ctx;
    const g = c.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.25,
      this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.7);
    g.addColorStop(0, 'rgba(255,40,20,0)');
    g.addColorStop(1, `rgba(255,40,20,${0.55 * clamp01(t)})`);
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);
  }

  private debug(s: HudState) {
    const c = this.ctx;
    c.textAlign = 'left';
    c.fillStyle = 'rgba(127,227,176,0.3)';
    c.fillText(`${s.fps.toFixed(0)} FPS`, 42, 24);
    c.fillText(`K ${s.player.kills} / D ${s.player.deaths}`, 42, 40);
  }
}

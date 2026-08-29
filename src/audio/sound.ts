import * as THREE from 'three';
import { CFG } from '../core/config';
import { clamp, clamp01, lerp, rand } from '../core/mathx';
import { Settings } from '../core/settings';
import { Aircraft } from '../entities/aircraft';

/**
 * Entirely synthesised audio — no sample files to load.
 *
 * The engine is deliberately noise-based rather than oscillator-based: a real jet
 * is broadband roar plus a low rumble plus an *inharmonic* turbine whine, and the
 * sawtooth-stack approach that a lot of browser games use is what makes them sound
 * like a motorbike. Positional one-shots lose their high frequencies with distance
 * (air absorption) and feed a small convolution reverb, which is most of what makes
 * synthesised effects sit in a world instead of on top of it.
 *
 * The AudioContext is created on the first user gesture, since browsers refuse to
 * start one before that.
 */

/** inharmonic partials — harmonic ratios sound like an organ, not a turbine */
const WHINE_RATIOS = [1, 1.51, 2.17];

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;

  // --- continuous engine voices ---
  private rumbleGain!: GainNode;
  private rumbleFilter!: BiquadFilterNode;
  private rumbleTilt!: BiquadFilterNode;
  private roarGain!: GainNode;
  private roarFilter!: BiquadFilterNode;
  private roarTilt!: BiquadFilterNode;
  private burnerGain!: GainNode;
  private burnerFilter!: BiquadFilterNode;
  private burnerTilt!: BiquadFilterNode;
  private whineGain!: GainNode;
  private whineOscs: OscillatorNode[] = [];
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;

  private listenerPos = new THREE.Vector3();
  private listenerRight = new THREE.Vector3(1, 0, 0);

  private lockBeep = 0;
  private warnBeep = 0;
  private warnToggle = false;
  private lastGunSound = new Map<Aircraft, number>();
  private prevRange = new Map<Aircraft, number>();
  private lastFlyby = -1;
  private now = 0;

  constructor(private settings: Settings) {
    settings.onChange(() => this.applyVolume());
  }

  get enabled(): boolean { return this.ctx !== null; }

  /** Must be called from a user gesture (the enter-battle click does it). */
  resume() {
    if (!this.ctx) this.build();
    void this.ctx?.resume();
  }

  /* ---------------- graph construction ---------------- */

  private build() {
    type Ctor = typeof AudioContext;
    const AC: Ctor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!AC) return;

    const ctx = new AC();
    this.ctx = ctx;

    // a compressor keeps a busy furball from clipping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15;
    comp.knee.value = 24;
    comp.ratio.value = 9;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);

    // reusable white noise
    const len = Math.floor(ctx.sampleRate * 2);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // open-air reverb, fed by a send. Highpassed first so it never turns muddy.
    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(1.7, 3.2);
    const sendHp = ctx.createBiquadFilter();
    sendHp.type = 'highpass';
    sendHp.frequency.value = 320;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(sendHp).connect(convolver);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    convolver.connect(wet).connect(this.master);

    this.buildEngine(ctx);
    this.applyVolume();
  }

  /** Exponentially decaying stereo noise — a serviceable open-space impulse. */
  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  private buildEngine(ctx: AudioContext) {
    // Each noise layer is filtered twice. A single biquad only rolls off 6 dB per
    // octave, which leaves white noise sounding like hiss sitting on top of the
    // engine; the second stage steepens it into something that reads as air moving.

    // low rumble — resonant lowpassed noise, the weight of the thing
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 90;
    this.rumbleFilter.Q.value = 4.5;
    this.rumbleTilt = ctx.createBiquadFilter();
    this.rumbleTilt.type = 'lowpass';
    this.rumbleTilt.frequency.value = 190;
    this.rumbleTilt.Q.value = 0.7;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumbleFilter.connect(this.rumbleTilt).connect(this.rumbleGain).connect(this.master);
    this.loopNoise(this.rumbleFilter, 1);

    // broadband roar — the main body of the sound
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'bandpass';
    this.roarFilter.frequency.value = 300;
    this.roarFilter.Q.value = 0.6;
    this.roarTilt = ctx.createBiquadFilter();
    this.roarTilt.type = 'lowpass';
    this.roarTilt.frequency.value = 760;
    this.roarTilt.Q.value = 0.7;
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    this.roarFilter.connect(this.roarTilt).connect(this.roarGain).connect(this.master);
    this.loopNoise(this.roarFilter, 0.8);

    // afterburner — heavier low-mid noise with an irregular crackle on top
    this.burnerFilter = ctx.createBiquadFilter();
    this.burnerFilter.type = 'bandpass';
    this.burnerFilter.frequency.value = 180;
    this.burnerFilter.Q.value = 0.8;
    this.burnerTilt = ctx.createBiquadFilter();
    this.burnerTilt.type = 'lowpass';
    this.burnerTilt.frequency.value = 520;
    this.burnerTilt.Q.value = 0.7;
    this.burnerGain = ctx.createGain();
    this.burnerGain.gain.value = 0;
    this.burnerFilter.connect(this.burnerTilt).connect(this.burnerGain).connect(this.master);
    this.loopNoise(this.burnerFilter, 0.55);
    // two detuned LFOs sum into the gain so the crackle never sounds periodic
    for (const [rate, depth] of [[6.5, 0.022], [11.3, 0.014]] as const) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = rate;
      const amt = ctx.createGain();
      amt.gain.value = depth;
      lfo.connect(amt).connect(this.burnerGain.gain);
      lfo.start();
    }

    // turbine whine — quiet, but it is what says "jet" rather than "engine"
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineGain.connect(this.master);
    for (const ratio of WHINE_RATIOS) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 500 * ratio;
      const g = ctx.createGain();
      g.gain.value = 1 / (ratio * 1.8);   // upper partials sit lower
      osc.connect(g).connect(this.whineGain);
      osc.start();
      this.whineOscs.push(osc);
    }

    // airflow over the canopy
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 900;
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter.connect(this.windGain).connect(this.master);
    this.loopNoise(this.windFilter, 0.9);
  }

  private loopNoise(dest: AudioNode, rate: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rate;
    src.connect(dest);
    src.start();
  }

  private applyVolume() {
    if (!this.ctx) return;
    const v = this.settings.effectiveVolume * CFG.audio.masterVolume;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setListener(pos: THREE.Vector3, quat: THREE.Quaternion) {
    this.listenerPos.copy(pos);
    this.listenerRight.set(1, 0, 0).applyQuaternion(quat);
  }

  /* ---------------- one-shot plumbing ---------------- */

  private place(pos: THREE.Vector3): { gain: number; pan: number; dist: number } {
    const dx = pos.x - this.listenerPos.x;
    const dy = pos.y - this.listenerPos.y;
    const dz = pos.z - this.listenerPos.z;
    const dist = Math.hypot(dx, dy, dz);
    const g = Math.pow(clamp01(1 - dist / CFG.audio.falloff), 1.8);
    if (g <= 0.001) return { gain: 0, pan: 0, dist };
    const inv = 1 / Math.max(1e-3, dist);
    const pan = clamp(
      (dx * this.listenerRight.x + dy * this.listenerRight.y + dz * this.listenerRight.z) * inv, -1, 1);
    return { gain: g, pan, dist };
  }

  /**
   * Builds gain -> air-absorption lowpass -> pan -> master, plus a reverb send.
   * Returns the gain node so the caller can shape an envelope on it.
   */
  private out(gain: number, pan: number, dist: number, wet = 0.25): GainNode | null {
    const ctx = this.ctx;
    if (!ctx || gain <= 0.001) return null;

    const g = ctx.createGain();
    g.gain.value = gain;

    // distant sounds lose their top end long before they lose their level
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const t = clamp01(dist / CFG.audio.falloff);
    lp.frequency.value = lerp(18000, 700, t * t);
    g.connect(lp);

    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      lp.connect(p).connect(this.master);
      if (wet > 0) p.connect(this.sendAt(wet));
    } else {
      lp.connect(this.master);
      if (wet > 0) lp.connect(this.sendAt(wet));
    }
    return g;
  }

  private sendAt(amount: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = amount;
    g.connect(this.reverbSend);
    return g;
  }

  private noiseBurst(dest: AudioNode, dur: number, rate = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    src.loop = true;
    // start at a random point so repeated bursts are not identical
    src.connect(dest);
    src.start(ctx.currentTime, Math.random() * 1.5);
    src.stop(ctx.currentTime + dur);
  }

  private tone(dest: AudioNode, type: OscillatorType, from: number, to: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, ctx.currentTime);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), ctx.currentTime + dur);
    o.connect(dest);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  private env(node: GainNode, peak: number, attack: number, decay: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private band(dest: AudioNode, type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  /* ---------------- events ---------------- */

  gun(pos: THREE.Vector3, shooter: Aircraft) {
    if (!this.ctx) return;
    // the cannon fires ~23 rounds a second; one sound each would be a wall of noise
    const last = this.lastGunSound.get(shooter) ?? -1;
    if (this.now - last < CFG.audio.gunSoundInterval) return;
    this.lastGunSound.set(shooter, this.now);

    const { gain, pan, dist } = this.place(pos);
    const vary = rand(0.9, 1.12);

    // body: a short low thump, which is what a cannon actually sounds like
    const body = this.out(gain * 0.42, pan, dist, 0.3);
    if (body) {
      this.env(body, gain * 0.42, 0.002, 0.075);
      this.tone(body, 'sine', 190 * vary, 62, 0.09);
    }
    // crack: brief mid transient over the top
    const crack = this.out(gain * 0.3, pan, dist, 0.22);
    if (crack) {
      const bp = this.band(crack, 'bandpass', 1250 * vary, 0.8);
      this.env(crack, gain * 0.3, 0.001, 0.05);
      this.noiseBurst(bp, 0.06, 1.4 * vary);
    }
  }

  explosion(pos: THREE.Vector3, scale = 1) {
    if (!this.ctx) return;
    const { gain, pan, dist } = this.place(pos);

    // initial crack
    const crack = this.out(gain * 0.55, pan, dist, 0.35);
    if (crack) {
      const hp = this.band(crack, 'highpass', 900, 0.7);
      this.env(crack, gain * 0.55, 0.001, 0.09);
      this.noiseBurst(hp, 0.12, 1.3);
    }

    // body: noise swept down from bright to dull
    const body = this.out(gain * 0.85, pan, dist, 0.45);
    if (body) {
      const lp = this.band(body, 'lowpass', 1900, 1.4);
      lp.frequency.exponentialRampToValueAtTime(85, this.ctx.currentTime + 0.75 * scale);
      this.env(body, gain * 0.85, 0.006, 0.9 * scale);
      this.noiseBurst(lp, 1.0 * scale, 0.7);
    }

    // sub boom
    const boom = this.out(gain * 0.7, pan, dist, 0.2);
    if (boom) {
      this.env(boom, gain * 0.7, 0.012, 0.7 * scale);
      this.tone(boom, 'sine', 88, 32, 0.75 * scale);
    }
  }

  missileLaunch(pos: THREE.Vector3) {
    if (!this.ctx) return;
    const { gain, pan, dist } = this.place(pos);
    const out = this.out(gain * 0.6, pan, dist, 0.4);
    if (!out) return;
    const bp = this.band(out, 'bandpass', 320, 0.7);
    bp.frequency.exponentialRampToValueAtTime(2600, this.ctx.currentTime + 0.6);
    this.env(out, gain * 0.6, 0.015, 0.8);
    this.noiseBurst(bp, 0.85, 1.05);
  }

  flares(pos: THREE.Vector3) {
    if (!this.ctx) return;
    const { gain, pan, dist } = this.place(pos);
    const out = this.out(gain * 0.4, pan, dist, 0.3);
    if (!out) return;
    const hp = this.band(out, 'highpass', 1500, 0.6);
    this.env(out, gain * 0.4, 0.005, 0.45);
    this.noiseBurst(hp, 0.5, 1.7);
  }

  /** Another jet tearing past — the sound that sells speed. */
  private flyby(pos: THREE.Vector3, closure: number) {
    if (!this.ctx) return;
    const { gain, pan, dist } = this.place(pos);
    const out = this.out(gain * 0.8, pan, dist, 0.5);
    if (!out) return;
    const bp = this.band(out, 'bandpass', 900, 0.6);
    // the sweep down through the band is the Doppler cue
    bp.frequency.setValueAtTime(1500 + closure * 1.4, this.ctx.currentTime);
    bp.frequency.exponentialRampToValueAtTime(280, this.ctx.currentTime + 0.5);
    this.env(out, gain * 0.8, 0.05, 0.55);
    this.noiseBurst(bp, 0.65, 1);
  }

  /** Taking rounds on your own airframe — dry and metallic, not positional. */
  hullHit() {
    if (!this.ctx) return;
    const out = this.out(0.5, 0, 0, 0.15);
    if (out) {
      const bp = this.band(out, 'bandpass', 2600, 2.4);
      this.env(out, 0.5, 0.001, 0.13);
      this.noiseBurst(bp, 0.15, 1.9);
    }
    const clank = this.out(0.3, 0, 0, 0.1);
    if (clank) {
      this.env(clank, 0.3, 0.002, 0.16);
      this.tone(clank, 'square', 420, 190, 0.17);
    }
  }

  private beep(freq: number, dur: number, vol: number, type: OscillatorType = 'sine') {
    const out = this.out(vol, 0, 0, 0.05);
    if (!out) return;
    this.env(out, vol, 0.004, dur);
    this.tone(out, type, freq, freq, dur + 0.01);
  }

  /* ---------------- continuous state ---------------- */

  update(dt: number, player: Aircraft, running: boolean, aircraft: readonly Aircraft[] = []) {
    if (!this.ctx) return;
    this.now += dt;

    const alive = player.alive && running;
    const throttle = alive ? player.controls.throttle : 0;
    const speedT = clamp01(player.speed / CFG.flight.speedBurner);
    const burner = alive && player.burnerActive;
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number, tau = 0.18) => p.setTargetAtTime(v, t, tau);

    // rumble and roar carry the weight; both open up with throttle
    const rumbleF = 72 + throttle * 58;
    set(this.rumbleFilter.frequency, rumbleF, 0.2);
    set(this.rumbleTilt.frequency, rumbleF * 2.2, 0.2);
    set(this.rumbleGain.gain, alive ? lerp(0.035, 0.15, throttle) : 0);

    // the roar's cutoff opening up is most of what you hear as "more power"
    const roarF = lerp(230, 660, throttle) + speedT * 170;
    set(this.roarFilter.frequency, roarF, 0.15);
    set(this.roarTilt.frequency, roarF * 2.4, 0.15);
    set(this.roarGain.gain, alive ? lerp(0.06, 0.22, throttle) : 0);

    // the burner is a separate layer, not just "more engine"
    const burnerF = 150 + speedT * 130;
    set(this.burnerFilter.frequency, burnerF, 0.15);
    set(this.burnerTilt.frequency, burnerF * 3, 0.15);
    set(this.burnerGain.gain, burner ? 0.16 : 0, 0.12);

    // turbine whine climbs steeply with throttle and stays quiet
    const whine = lerp(430, 1580, throttle) + speedT * 180;
    for (let i = 0; i < this.whineOscs.length; i++) {
      set(this.whineOscs[i].frequency, whine * WHINE_RATIOS[i], 0.14);
    }
    set(this.whineGain.gain, alive ? lerp(0.004, 0.03, throttle * throttle) : 0);

    // airflow rises with the square of speed and gets brighter with it
    set(this.windFilter.frequency, 620 + speedT * 1150, 0.2);
    set(this.windGain.gain, alive ? speedT * speedT * 0.05 : 0, 0.25);

    if (!alive) { this.lockBeep = 0; this.warnBeep = 0; this.prevRange.clear(); return; }

    this.checkFlybys(player, aircraft);

    // missile inbound: insistent two-tone, and it wins over the lock tone
    if (player.threat > 0) {
      this.warnBeep -= dt;
      if (this.warnBeep <= 0) {
        this.warnBeep = 0.26;
        this.warnToggle = !this.warnToggle;
        this.beep(this.warnToggle ? 740 : 555, 0.1, 0.26, 'triangle');
      }
    } else {
      this.warnBeep = 0;
    }

    // seeker tone: quickens as the lock builds, solid once it takes
    if (player.lockTarget && player.lockTarget.alive) {
      this.lockBeep -= dt;
      if (this.lockBeep <= 0) {
        if (player.locked) {
          this.lockBeep = 0.075;
          this.beep(1250, 0.06, 0.07);
        } else {
          this.lockBeep = lerp(0.4, 0.13, player.lockProgress);
          this.beep(880, 0.05, 0.055);
        }
      }
    } else {
      this.lockBeep = 0;
    }
  }

  /** Fire a whoosh when another jet crosses close aboard. */
  private checkFlybys(player: Aircraft, aircraft: readonly Aircraft[]) {
    const TRIGGER = 190;
    for (const a of aircraft) {
      if (a === player || !a.alive) { this.prevRange.delete(a); continue; }
      const d = a.pos.distanceTo(player.pos);
      const prev = this.prevRange.get(a) ?? d;
      this.prevRange.set(a, d);
      if (d > 900) continue;
      // crossed inbound through the trigger radius this frame. A global cooldown
      // stops a furball at knife range turning into a stream of whooshes.
      if (prev >= TRIGGER && d < TRIGGER && this.now - this.lastFlyby > 0.4) {
        this.lastFlyby = this.now;
        this.flyby(a.pos, Math.abs(a.speed - player.speed) + 120);
      }
    }
  }

  /** Drop per-aircraft bookkeeping between matches. */
  reset() {
    this.lastGunSound.clear();
    this.prevRange.clear();
    this.lastFlyby = -1;
  }
}

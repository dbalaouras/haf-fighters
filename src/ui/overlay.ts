import {
  AIRFRAMES,
  AIRFRAME_ORDER,
  AirframeId,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  DifficultyId,
  GAME_NAME,
  MODES,
  MODE_ORDER,
  ModeId,
} from '../core/config';
import { MatchResult } from '../core/game';
import { Settings } from '../core/settings';
import { ACTIONS, ActionId, keyLabel } from '../core/bindings';
import { MatchInfo, scoreboardHtml } from './scoreboard';
import { MAX_NAME } from '../core/settings';
import { MapId, MAPS, MAP_ORDER } from '../world/maps';

/** Fixed, non-rebindable inputs. */
const FIXED: ReadonlyArray<[string, string]> = [
  ['Fly (pitch &amp; bank)', 'Mouse'],
  ['Cannon', 'Left click'],
  ['Missile', 'Right click'],
  ['Scoreboard', 'Hold Tab'],
  ['Radar zoom', 'Scroll'],
  ['Pause', 'Esc'],
];

/**
 * Cog outline for the settings button. Built from the tooth geometry rather
 * than pasted path data so the proportions stay tunable: each tooth rises from
 * the root circle to a flat tip, with an arc across the tip and another across
 * the valley between teeth. The earlier icon was a ring with thin radiating
 * spokes, which read as a brightness control rather than a gear.
 */
function cogPath(teeth = 8, rTip = 10.2, rRoot = 7.5, tipHalf = 8.5, rootHalf = 14.5): string {
  const at = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  };
  const step = 360 / teeth;
  let d = `M ${at(-90 - rootHalf, rRoot)}`;
  for (let i = 0; i < teeth; i++) {
    const c = i * step - 90;
    d += ` L ${at(c - tipHalf, rTip)} A ${rTip} ${rTip} 0 0 1 ${at(c + tipHalf, rTip)}`;
    d += ` L ${at(c + rootHalf, rRoot)} A ${rRoot} ${rRoot} 0 0 1 ${at(c + step - rootHalf, rRoot)}`;
  }
  return `${d} Z`;
}

const GEAR_ICON = `
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
       stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
    <path d="${cogPath()}"/>
    <circle cx="12" cy="12" r="3.1"/>
  </svg>`;

type Ctl = 'invertPitch' | 'invertRoll' | 'assist' | 'muted' | 'cullCity'
  | 'sens-' | 'sens+' | 'vol-' | 'vol+' | 'reset' | `bind:${ActionId}`;

type Act = 'resume' | 'restart' | 'leave' | 'settings' | 'back'
  | `mode:${ModeId}`
  | `map:${MapId}` | `diff:${DifficultyId}` | `frame:${AirframeId}`;

export class Overlay {
  private el: HTMLElement;
  private mode: 'start' | 'paused' | 'end' = 'start';
  /** which face of the panel is showing — the title/pause screen or settings */
  private view: 'main' | 'settings' = 'main';
  private lastEnd: { result: MatchResult; info: MatchInfo } | null = null;
  private capturing: ActionId | null = null;

  onResume?: () => void;
  onRestart?: () => void;
  onLeave?: () => void;

  constructor(el: HTMLElement, private settings: Settings) {
    this.el = el;

    el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement | null)?.closest('[data-act]') as HTMLElement | null;
      if (act) {
        e.stopPropagation();
        this.act(act.dataset.act as Act);
        return;
      }
      const ctl = (e.target as HTMLElement | null)?.closest('[data-ctl]') as HTMLElement | null;
      if (ctl) {
        e.stopPropagation();
        this.apply(ctl.dataset.ctl as Ctl);
        return;
      }
      // backdrop
      if (this.capturing) { this.capturing = null; this.render(); return; }
      if (this.view === 'settings') { this.view = 'main'; this.render(); return; }
      if (this.mode === 'end') this.onRestart?.();
      else this.onResume?.();
    });

    // capture phase so a key being bound never reaches the game's input handler
    addEventListener('keydown', (e) => {
      if (!this.capturing) return;
      e.preventDefault();
      e.stopPropagation();
      // Escape cancels; a keydown without a usable code is ignored rather than
      // being stored as a blank binding
      if (e.code && e.code !== 'Escape') this.settings.bind(this.capturing, e.code);
      this.capturing = null;
      this.render();
    }, true);

    settings.onChange(() => { if (!this.el.classList.contains('hidden')) this.render(); });
  }

  /**
   * Read the callsign field straight out of the DOM at action time rather than
   * syncing on every keystroke — writing to settings re-renders the panel, which
   * would blow away the input the user is typing into.
   */
  private commitName() {
    const el = this.el.querySelector('.callsign') as HTMLInputElement | null;
    if (el) this.settings.setPilotName(el.value);
  }

  private act(a: Act) {
    this.commitName();
    if (a.startsWith('mode:')) {
      this.settings.setMode(a.slice(5) as ModeId);
      return;
    }
    if (a.startsWith('map:')) {
      // rebuilding the world is not instant, so show the choice before it happens
      this.settings.setMap(a.slice(4) as MapId);
      return;
    }
    if (a.startsWith('diff:')) {
      this.settings.setDifficulty(a.slice(5) as DifficultyId);
      return;
    }
    if (a.startsWith('frame:')) {
      this.settings.setAirframe(a.slice(6) as AirframeId);
      return;
    }
    switch (a) {
      case 'settings': this.view = 'settings'; this.render(); break;
      case 'back': this.view = 'main'; this.capturing = null; this.render(); break;
      case 'resume': this.onResume?.(); break;
      case 'restart': this.onRestart?.(); break;
      case 'leave': this.onLeave?.(); break;
    }
  }

  private apply(ctl: Ctl) {
    if (ctl.startsWith('bind:')) {
      this.capturing = ctl.slice(5) as ActionId;
      this.render();
      return;
    }
    switch (ctl) {
      case 'sens-': this.settings.nudgeSensitivity(-0.08); break;
      case 'sens+': this.settings.nudgeSensitivity(0.08); break;
      case 'vol-': this.settings.nudgeVolume(-0.1); break;
      case 'vol+': this.settings.nudgeVolume(0.1); break;
      case 'reset': this.settings.reset(); break;
      case 'invertPitch': case 'invertRoll': case 'assist': case 'muted': case 'cullCity':
        this.settings.toggle(ctl);
        break;
    }
  }

  hide() {
    this.capturing = null;
    this.view = 'main';
    this.el.classList.add('hidden');
  }

  start() { this.mode = 'start'; this.view = 'main'; this.render(); }
  paused() { this.mode = 'paused'; this.view = 'main'; this.render(); }
  end(result: MatchResult, info: MatchInfo) {
    this.mode = 'end';
    this.view = 'main';
    this.lastEnd = { result, info };
    this.render();
  }

  /* ---------------- fragments ---------------- */

  private toggleRow(label: string, ctl: Ctl, on: boolean, hint?: string) {
    return `<div class="srow" data-ctl="${ctl}">
      <span>${label}${hint ? `<i>${hint}</i>` : ''}</span>
      <em class="${on ? 'on' : 'off'}">${on ? 'ON' : 'OFF'}</em>
    </div>`;
  }

  private stepperRow(label: string, minus: Ctl, plus: Ctl, value: string, hint?: string) {
    return `<div class="srow static">
      <span>${label}${hint ? `<i>${hint}</i>` : ''}</span>
      <span class="stepper">
        <b data-ctl="${minus}">&minus;</b><u>${value}</u><b data-ctl="${plus}">+</b>
      </span>
    </div>`;
  }

  private controlsHtml() {
    const fixed = FIXED
      .map(([l, k]) => `<div class="srow static"><span>${l}</span><em class="key">${k}</em></div>`)
      .join('');

    const bindable = ACTIONS.map((a) => {
      const capturing = this.capturing === a.id;
      const code = this.settings.key(a.id);
      const label = capturing ? 'PRESS A KEY' : code ? keyLabel(code) : 'UNBOUND';
      return `<div class="srow" data-ctl="bind:${a.id}">
        <span>${a.label}</span>
        <em class="key ${capturing ? 'capturing' : ''}${!capturing && !code ? ' unbound' : ''}">${label}</em>
      </div>`;
    }).join('');

    return `<div class="block">
      <div class="bhead">Controls</div>
      ${fixed}
      <div class="bsub">Click a key to rebind${this.capturing ? ' &middot; Esc cancels' : ''}</div>
      ${bindable}
    </div>`;
  }

  private settingsHtml() {
    const d = this.settings.data;
    return `<div class="block">
      <div class="bhead">Flight</div>
      ${this.toggleRow('Invert pitch', 'invertPitch', d.invertPitch, 'I')}
      ${this.toggleRow('Invert roll', 'invertRoll', d.invertRoll)}
      ${this.toggleRow('Flight assist', 'assist', d.assist, 'G')}
      ${this.stepperRow('Mouse sensitivity', 'sens-', 'sens+', `${this.settings.sensitivityPct}%`, '[ ]')}
      <div class="bsub">Graphics</div>
      ${this.toggleRow('Skip off-screen buildings', 'cullCity', d.cullCity)}
      <div class="bsub">Audio</div>
      ${this.toggleRow('Mute', 'muted', d.muted, 'N')}
      ${this.stepperRow('Volume', 'vol-', 'vol+', `${this.settings.volumePct}%`)}
      <div class="sreset" data-ctl="reset">Reset to defaults</div>
    </div>`;
  }

  private assistNote() {
    return this.settings.data.assist
      ? `Flight assist is <b>on</b>: banking carves a turn and the jet rolls level
         when you let go. Hold pitch to tighten the turn or to climb.`
      : `Flight assist is <b>off</b>: the mouse commands roll and pitch <i>rates</i>,
         so the jet holds whatever attitude you leave it in. Bank, then pull to turn.`;
  }

  private gearButton() {
    return `<button class="gear" data-act="settings" aria-label="Settings">${GEAR_ICON}</button>`;
  }

  /* ---------------- views ---------------- */

  private renderSettings() {
    this.el.innerHTML = `<div class="panel">
      <div class="panel-head">
        <button class="act ghost" data-act="back">&larr; BACK</button>
        <h2>SETTINGS</h2>
      </div>
      <div class="cols">${this.controlsHtml()}${this.settingsHtml()}</div>
      <div class="note">${this.assistNote()}</div>
    </div>`;
  }

  private renderEnd() {
    const { result, info } = this.lastEnd!;
    const title = result.winner === 'DRAW' ? 'DRAW' : result.winner === 'BLUE' ? 'VICTORY' : 'DEFEAT';
    const color = result.winner === 'BLUE' ? '#7fe3b0' : result.winner === 'RED' ? '#ff7a66' : '#dffff0';

    this.el.innerHTML = `<div class="panel wide">
      <h1 style="color:${color}">${title}</h1>
      <div class="sub">${result.winner === 'DRAW' ? 'NEITHER SIDE REACHED THE LIMIT'
        : `TEAM ${result.winner} TOOK IT ${MODES[this.settings.data.mode].killsScore ? 'ON KILLS' : 'ON GROUND HELD'}`}</div>
      ${scoreboardHtml(info)}
      <div class="acts">
        <button class="act primary" data-act="restart">NEW MATCH</button>
        <button class="act" data-act="leave">BACK TO MENU</button>
      </div>
    </div>`;
  }

  /** 0..1 for a stat bar, so the trade between airframes is visible not just named */
  private static norm(v: number, lo: number, hi: number): number {
    return Math.max(0.06, Math.min(1, (v - lo) / (hi - lo)));
  }

  private bars(spec: (typeof AIRFRAMES)[AirframeId]): string {
    const rows: ReadonlyArray<[string, number]> = [
      ['TURN', Overlay.norm(spec.pitchRate, 1.12, 1.5)],
      ['SPEED', Overlay.norm(spec.speedMax, 298, 362)],
      ['HULL', Overlay.norm(spec.hp, 80, 120)],
    ];
    return `<span class="bars">${rows.map(([label, v]) => `
      <span class="bar"><i>${label}</i><u><b style="width:${(v * 100).toFixed(0)}%"></b></u></span>`).join('')}</span>`;
  }

  /**
   * The mode sits above the three columns rather than beside them: it changes
   * what the other choices mean, and a fourth column would have put the panel
   * back over the fold it was rebuilt to clear.
   */
  private modeRow(): string {
    const d = this.settings.data;
    const opts = MODE_ORDER.map((id) => {
      const m = MODES[id];
      return `<button class="mode${d.mode === id ? ' on' : ''}" data-act="mode:${id}">
        <b>${m.name}</b><i>${m.blurb}</i>
      </button>`;
    }).join('');
    return `<div class="modes">${opts}</div>`;
  }

  private choices(): string {
    const d = this.settings.data;

    const airframes = AIRFRAME_ORDER.map((id) => {
      const a = AIRFRAMES[id];
      return `<button class="opt${d.airframe === id ? ' on' : ''}" data-act="frame:${id}">
        <span class="opt-top"><b>${a.name}</b><i>${a.ammo.IR}&times;IR · ${a.ammo.RADAR}&times;RDR</i></span>
        ${this.bars(a)}
      </button>`;
    }).join('');

    const skills = DIFFICULTY_ORDER.map((id) => {
      const x = DIFFICULTIES[id];
      return `<button class="opt${d.difficulty === id ? ' on' : ''}" data-act="diff:${id}">
        <span class="opt-top"><b>${x.label}</b></span>
        <span class="opt-sub">${x.blurb}</span>
      </button>`;
    }).join('');

    const maps = MAP_ORDER.map((id) => {
      const m = MAPS[id];
      const [name, when] = m.name.split(' — ');
      return `<button class="opt${d.mapId === id ? ' on' : ''}" data-act="map:${id}">
        <span class="opt-top"><b>${name}</b><i>${when ?? ''}</i></span>
        <span class="opt-sub">${m.blurb}</span>
      </button>`;
    }).join('');

    return `<div class="choices">
      <div class="choice">
        <span class="choice-head">Your aircraft</span>
        ${airframes}
      </div>
      <div class="choice">
        <span class="choice-head">Bandit skill</span>
        ${skills}
      </div>
      <div class="choice">
        <span class="choice-head">Map</span>
        ${maps}
      </div>
    </div>`;
  }

  private renderTitle() {
    const paused = this.mode === 'paused';
    const [first, ...rest] = GAME_NAME.split(' ');
    const k = (a: Parameters<Settings['key']>[0]) => keyLabel(this.settings.key(a));

    this.el.innerHTML = `<div class="panel title-panel${paused ? ' narrow' : ''}">
      ${this.gearButton()}

      <div class="title-block">
        ${paused
          ? `<div class="eyebrow">${GAME_NAME}</div><h1>PAUSED</h1>`
          : `<h1 class="game-title">${first} <span>${rest.join(' ')}</span></h1>`}
        <div class="sub">5 V 5 &nbsp;·&nbsp; ${MODES[this.settings.data.mode].name}
          &nbsp;·&nbsp; FIRST TO ${MODES[this.settings.data.mode].scoreLimit}</div>
      </div>

      ${paused ? '' : this.modeRow()}
      ${paused ? '' : this.choices()}

      ${paused
        ? `<div class="launch">
             <button class="act primary big" data-act="resume">RESUME</button>
             <button class="act big" data-act="leave">LEAVE MATCH</button>
           </div>`
        : `<div class="launch-row">
             <label class="field-inline">
               <span>CALLSIGN</span>
               <input class="callsign" type="text" maxlength="${MAX_NAME}" spellcheck="false"
                      autocomplete="off" value="${this.settings.data.pilotName}">
             </label>
             <button class="act primary big" data-act="resume">ENTER BATTLE</button>
           </div>`}

      <div class="hint">
        <b>Mouse</b> flies &nbsp;·&nbsp; <b>Click</b> to fire &nbsp;·&nbsp;
        <b>${k('afterburner')}</b> burner &nbsp;·&nbsp; <b>${k('flares')}</b>/<b>${k('chaff')}</b> countermeasures
        &nbsp;·&nbsp; <b>Tab</b> scores &nbsp;·&nbsp; full controls behind the gear
      </div>
    </div>`;
  }

  private render() {
    this.el.classList.remove('hidden');
    if (this.mode === 'end' && this.lastEnd && this.view === 'main') { this.renderEnd(); return; }
    if (this.view === 'settings') { this.renderSettings(); return; }
    this.renderTitle();
    this.wireCallsign();
  }

  private wireCallsign() {
    const el = this.el.querySelector('.callsign') as HTMLInputElement | null;
    if (!el) return;
    // clicks in the field must not fall through to the backdrop and launch a match
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); this.act('resume'); }
    });
  }
}

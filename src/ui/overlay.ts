import { CFG, GAME_NAME, MAP_NAME, MODE_NAME } from '../core/config';
import { MatchResult } from '../core/game';
import { Settings } from '../core/settings';
import { ACTIONS, ActionId, keyLabel } from '../core/bindings';
import { MatchInfo, scoreboardHtml } from './scoreboard';
import { MAX_NAME } from '../core/settings';

/** Fixed, non-rebindable inputs. */
const FIXED: ReadonlyArray<[string, string]> = [
  ['Fly (pitch &amp; bank)', 'Mouse'],
  ['Cannon', 'Left click'],
  ['Missile', 'Right click'],
  ['Scoreboard', 'Hold Tab'],
  ['Pause', 'Esc'],
];

const GEAR_ICON = `
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
       stroke-width="1.5" stroke-linecap="round">
    <circle cx="12" cy="12" r="3.3"/>
    <path d="M12 2.6v2.7M12 18.7v2.7M21.4 12h-2.7M5.3 12H2.6
             M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9M18.6 18.6l-1.9-1.9M7.3 7.3L5.4 5.4"/>
  </svg>`;

type Ctl = 'invertPitch' | 'invertRoll' | 'assist' | 'muted'
  | 'sens-' | 'sens+' | 'vol-' | 'vol+' | 'reset' | `bind:${ActionId}`;

type Act = 'resume' | 'restart' | 'leave' | 'settings' | 'back';

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
      case 'invertPitch': case 'invertRoll': case 'assist': case 'muted':
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
        : `TEAM ${result.winner} REACHED ${CFG.match.scoreLimit} KILLS`}</div>
      ${scoreboardHtml(info)}
      <div class="acts">
        <button class="act primary" data-act="restart">NEW MATCH</button>
        <button class="act" data-act="leave">BACK TO MENU</button>
      </div>
    </div>`;
  }

  private renderTitle() {
    const paused = this.mode === 'paused';
    const [first, ...rest] = GAME_NAME.split(' ');
    const k = (a: Parameters<Settings['key']>[0]) => keyLabel(this.settings.key(a));

    const keys: ReadonlyArray<[string, string]> = [
      ['Mouse', 'fly'],
      ['Click', 'guns'],
      ['R-click', 'missile'],
      [k('afterburner'), 'burner'],
      [k('brake'), 'brake'],
      [k('flares'), 'flares'],
      ['Tab', 'scores'],
    ];

    this.el.innerHTML = `<div class="panel title-panel">
      ${this.gearButton()}

      <div class="title-block">
        ${paused
          ? `<div class="eyebrow">${GAME_NAME}</div><h1>PAUSED</h1>`
          : `<h1 class="game-title">${first} <span>${rest.join(' ')}</span></h1>`}
        <div class="sub">5 V 5 &nbsp;·&nbsp; ${MODE_NAME}</div>
        <div class="sub dim">${MAP_NAME}</div>
      </div>

      <div class="rule"></div>

      ${paused
        ? `<div class="launch">
             <button class="act primary big" data-act="resume">RESUME</button>
             <button class="act big" data-act="leave">LEAVE MATCH</button>
           </div>`
        : `<div class="launch">
             <label class="field">
               <span>CALLSIGN</span>
               <input class="callsign" type="text" maxlength="${MAX_NAME}" spellcheck="false"
                      autocomplete="off" value="${this.settings.data.pilotName}">
             </label>
             <button class="act primary big" data-act="resume">ENTER BATTLE</button>
           </div>`}

      <div class="keys">
        ${keys.map(([key, label]) => `<span><b>${key}</b>${label}</span>`).join('')}
      </div>
      <div class="fineprint">First team to ${CFG.match.scoreLimit} kills
        &nbsp;·&nbsp; full controls behind the gear</div>
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

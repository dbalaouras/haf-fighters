import { CFG, MODE_NAME, TEAM, TeamId } from '../core/config';
import { fmtTime } from '../core/mathx';

export interface PilotRow {
  name: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  isPlayer: boolean;
  airframe: string;
  alive: boolean;
  respawnIn: number;
}

export interface MatchInfo {
  score: Record<TeamId, number>;
  timeLeft: number;
  teams: Array<{ team: TeamId; css: string; pilots: PilotRow[] }>;
  mapName: string;
  /** shown in place of the running clock once the match is decided */
  result?: 'VICTORY' | 'DEFEAT' | 'DRAW';
}

const RANK_CLASS = ['gold', 'silver', 'bronze'];

/**
 * Full-match scoreboard: two team tables side by side, sorted by score, with the
 * top three across both teams badged. Used both for the hold-Tab overlay and the
 * end-of-match panel, so they can never disagree.
 */
export function scoreboardHtml(info: MatchInfo): string {
  // rank the top three across both teams, as a combined leaderboard
  const ranked = info.teams
    .flatMap((t) => t.pilots.map((p) => ({ name: p.name, team: t.team, score: p.score })))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const rankOf = (team: TeamId, name: string) =>
    ranked.findIndex((r) => r.team === team && r.name === name);

  const lead = info.score.BLUE === info.score.RED ? 'DRAW'
    : info.score.BLUE > info.score.RED ? 'BLUE LEADS' : 'RED LEADS';

  const table = (t: MatchInfo['teams'][number]) => `
    <div class="sb-team ${t.team.toLowerCase()}">
      <div class="sb-row sb-th">
        <span class="sb-name">TEAM ${t.team}</span>
        <span class="sb-air">AIRCRAFT</span>
        <span class="sb-kda">K / D / A</span>
        <span class="sb-pts">SCORE</span>
      </div>
      ${t.pilots.map((p) => {
        const rank = rankOf(t.team, p.name);
        const badge = rank >= 0 ? `<i class="sb-rank ${RANK_CLASS[rank]}">${rank + 1}</i>` : '';
        return `
        <div class="sb-row${p.isPlayer ? ' me' : ''}${p.alive ? '' : ' down'}">
          <span class="sb-name">${badge}${p.name}${p.alive ? '' : `<u>DOWN ${p.respawnIn}s</u>`}</span>
          <span class="sb-air">${p.airframe}</span>
          <span class="sb-kda">${p.kills} / ${p.deaths} / ${p.assists}</span>
          <span class="sb-pts">${p.score.toLocaleString()}</span>
        </div>`;
      }).join('')}
    </div>`;

  return `
    <div class="sb">
      <div class="sb-head">
        <div class="sb-mode">${MODE_NAME}<span>${info.mapName}</span></div>
        <div class="sb-score">
          <b class="blue">${info.score.BLUE}</b>
          <span>${info.result ?? lead}</span>
          <b class="red">${info.score.RED}</b>
        </div>
        <div class="sb-meta">${fmtTime(info.timeLeft)}<span>FIRST TO ${CFG.match.scoreLimit}</span></div>
      </div>
      <div class="sb-tables">${info.teams.map(table).join('')}</div>
    </div>`;
}

/** The hold-Tab overlay. */
export class Scoreboard {
  private el: HTMLElement;
  private visible = false;
  private refresh = 0;

  constructor(el: HTMLElement, private supply: () => MatchInfo) {
    this.el = el;
  }

  // show/hide always drive the DOM rather than trusting the flag, so the two can
  // never drift out of sync
  show() {
    this.visible = true;
    this.refresh = 0.25;
    this.el.innerHTML = scoreboardHtml(this.supply());
    this.el.classList.remove('hidden');
  }

  hide() {
    this.visible = false;
    this.el.classList.add('hidden');
  }

  get isVisible(): boolean { return this.visible; }

  /** Keep the numbers live while it is held open, without rebuilding every frame. */
  update(dt: number) {
    if (!this.visible) return;
    this.refresh -= dt;
    if (this.refresh > 0) return;
    this.refresh = 0.25;
    this.el.innerHTML = scoreboardHtml(this.supply());
  }
}

export { TEAM };

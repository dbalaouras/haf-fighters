import { Game } from './core/game';
import { Input } from './core/input';
import { Settings } from './core/settings';
import { Overlay } from './ui/overlay';
import { Scoreboard } from './ui/scoreboard';

const sceneCanvas = document.getElementById('scene') as HTMLCanvasElement;
const hudCanvas = document.getElementById('hud') as HTMLCanvasElement;
const overlayEl = document.getElementById('overlay') as HTMLElement;
const scoreboardEl = document.getElementById('scoreboard') as HTMLElement;

const settings = new Settings();
const input = new Input(sceneCanvas, settings);
const game = new Game(sceneCanvas, hudCanvas, input, settings);
const overlay = new Overlay(overlayEl, settings);
const scoreboard = new Scoreboard(scoreboardEl, () => game.matchInfo());

// the player's jet is the only one that flies with assist; AI keeps raw rate control
const applySettings = () => { game.player.assist = settings.data.assist; };
settings.onChange(applySettings);
applySettings();

overlay.start();

const resume = () => {
  if (game.over) return;
  overlay.hide();
  scoreboard.hide();
  game.paused = false;
  input.requestLock();
  // browsers only allow audio to start from a user gesture — this click is it
  game.audio.resume();
};

const pause = () => {
  if (game.paused || game.over) return;
  game.paused = true;
  scoreboard.hide();
  overlay.paused();
};

overlay.onResume = resume;
overlay.onRestart = () => {
  game.reset();
  resume();
};
overlay.onLeave = () => {
  game.leaveMatch();
  scoreboard.hide();
  overlay.start();
};

game.onMatchEnd = (result) => {
  game.paused = true;
  scoreboard.hide();
  if (document.pointerLockElement) document.exitPointerLock();
  const outcome = result.winner === 'DRAW' ? 'DRAW'
    : result.winner === game.player.team ? 'VICTORY' : 'DEFEAT';
  overlay.end(result, game.matchInfo(outcome));
};

// hold Tab for the full scoreboard, but only while actually flying
input.onScoreboard = (show) => {
  if (show && !game.paused && !game.over) scoreboard.show();
  else scoreboard.hide();
};
game.onFrame = (dt) => scoreboard.update(dt);

input.onEscape = pause;

// losing pointer lock (Esc, alt-tab, window blur) pauses the player's jet
input.onPointerLockChange((locked) => {
  if (!locked) pause();
});

game.start();

// expose for quick console tinkering while iterating on feel
(window as unknown as { game: Game }).game = game;

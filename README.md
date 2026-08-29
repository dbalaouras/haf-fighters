# HAR Fighters

A 5v5 arcade jet dogfighter in the browser. One map, one airframe, ten aircraft in
the air: you plus four AI wingmen against five AI bandits. Deliberately **not** a
full simulator — arcade flight model, instant action, ~3 minute matches.

Runs in any modern browser, so it plays on macOS as-is. No assets to download:
the terrain, ocean, sky, clouds and the aircraft are all generated in code.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open the printed URL (default http://localhost:5173) and click to fly.

```bash
npm run build
```

Type-checks and produces a static bundle in `dist/` — deployable to any static host.

> Pointer lock is used for mouse flight. If a browser refuses it (embedded frames,
> some Safari configurations) the game falls back to steering from the cursor's
> offset from screen centre, so it stays playable either way.

## Deploying

**No backend.** HAR Fighters is a pure static front end — the whole game runs in the
browser. There is no API, no database, no environment variables and no runtime
network traffic at all: the terrain, ocean, sky, aircraft and every sound are
generated in code, so the built site is one `index.html` plus a single hashed JS
bundle (about 580 KB, ~150 KB gzipped). Loading the production build issues exactly
one resource request, for that bundle.

That makes AWS Amplify Hosting a good fit, and [`amplify.yml`](amplify.yml) in the
repo is ready to use. Connect the repository in the Amplify console and it will pick
the spec up automatically; the settings that matter are:

- Build command: `npm run build`
- Output directory: `dist`

Two things worth knowing:

- **No SPA rewrite rule is needed.** There is only one route, so the usual
  "redirect 404 to /index.html" rule is unnecessary — though it is harmless if you
  add it out of habit.
- **Serve it over HTTPS**, which Amplify does by default. Pointer lock — used for
  mouse flight — needs a secure context. The game falls back to cursor-offset
  steering without it, but you want the locked stick.

Nothing about the app is Amplify-specific. `dist/` is plain static output, so S3 +
CloudFront, Netlify, Vercel, GitHub Pages or any static host works the same way. The
one thing that will *not* work is opening `dist/index.html` from `file://` — the
bundle is an ES module, so it needs to be served over http(s).

## Controls

| Action | Input | Rebindable |
| --- | --- | --- |
| Fly (pitch & bank) | **Mouse** | — |
| Cannon | Left click / `Space` | yes |
| Missile (needs lock) | Right click / `R` | yes |
| Afterburner | `W` | yes |
| Brake | `S` | yes |
| Flares | `F` | yes |
| Rudder | `Q` / `E` | yes |
| Camera (chase / cockpit) | `C` | yes |
| Scoreboard | Hold `Tab` | — |
| Pause | `Esc` | — |
| Flight assist | `G` | — |
| Invert pitch | `I` | — |
| Mute | `N` | — |
| Mouse sensitivity | `[` / `]` | — |

**Flying is mouse-only.** The keyboard does thrust, rudder and weapons — it does not
pitch or bank the aircraft. A gamepad works too if one is connected (left stick flies,
right trigger burner, left trigger brake, `A`/`RB` guns, `B`/`LB` missiles, `X` flares).

Every keyboard action above is rebindable: open the panel, click the key next to an
action, press the new one. `Esc` cancels. Binding a key that is already in use takes
it from the other action, which then shows as `UNBOUND` until you give it a key.

## Sound

Everything is synthesised at runtime — there are no audio files to license, host or
load, which is part of why the whole game is one 150 KB bundle.

The engine is built from filtered noise rather than oscillators: a resonant low
rumble, a broadband roar whose cutoff opens with throttle, three *inharmonic* sine
partials for the turbine whine, and a separate afterburner layer with an irregular
crackle. Stacked sawtooths are the usual shortcut here and they are exactly what
makes browser games sound like a motorbike.

Positional sounds lose their high frequencies with distance (air absorption) and
feed a small convolution reverb built from a synthesised impulse, which is most of
what stops synthesised effects sitting on top of the world rather than in it. A
compressor on the master bus keeps a busy furball from clipping — measured at 3 dB
of headroom with the burner lit and half a dozen effects firing at once.

Volume and mute are behind the gear.

## Screens

The game opens on a **title screen** — `ENTER BATTLE` starts a match, and the **gear
in the corner** opens settings and key bindings. `Esc` mid-match pauses to the same
screen with `RESUME` and `LEAVE MATCH`, and the gear is there too.

## Settings

Behind the gear on the title or pause screen. Everything is saved to `localStorage`,
so it survives a reload:

- **Invert pitch** / **Invert roll**
- **Flight assist** — see below
- **Mouse sensitivity**
- **Mute** and **Volume**
- **Reset to defaults**

Pausing with `Esc` also offers **Leave match**, which drops you back to the title
screen; `ENTER BATTLE` there starts a completely fresh match with re-rolled AI pilots.

## Rearm zones

Four neutral zones ringed with cyan cages hang over the map. Fly into one and it
tops up **missiles, flares, afterburner fuel and hull**, and cools the cannon —
faster the closer to the centre, so a lazy pass gives less than an orbit. A few
seconds inside takes a shot-up jet from 30% hull and no missiles back to fighting
condition.

They are shared by both teams and permanently lit, which is the point: loitering in
a fixed, well-marked volume is exactly as risky as it sounds. Diamonds on the HUD and
the radar show where they are, and `REARMING` appears while you are inside one.

The AI uses them too, breaking off when it is below 45% hull or out of missiles.

## Scoreboard

Hold **`Tab`** during a match for the full scoreboard: both teams sorted by score,
kills / deaths / assists, the top three across both teams badged, downed pilots
marked with their respawn timer, and your own row highlighted. The same board is
shown at the end of a match.

Score is `250` per kill, `100` per assist, and `2` per point of damage dealt, so
softening a target up still counts for something when a wingman finishes it.

## Thrust and the afterburner

There is no throttle to trim. The engine sits at cruise on its own, and you have two
pedals:

- **`W` — afterburner.** Lights while held and burns fuel, pushing you from about
  320 m/s to 430. Roughly **4 seconds** of burn from full.
- **`S` — brake.** Pulls the engine back to idle, bleeding down to about 140 m/s —
  useful to force an overshoot when someone is on your tail.

Burner fuel refills **empty to full in about 5.5 seconds**, and only once you release
`W`. Holding a dry burner gets you nothing and refills nothing: that is deliberate, as
refilling under a held button just relights the engine for a fraction of a second at a
time and stutters. The `AB` gauge on the HUD pulses while burning and while dry.

The AI plays by the same rule, which is why bandits commit to a fight instead of
running away forever — nobody can hold 430 m/s indefinitely.

## How turning works

**Flight assist on (default).** Roll input commands a *bank angle*, not a roll rate.
Bank over and the jet carves a coordinated level turn — the nose tracks round the
horizon and altitude holds instead of the jet knife-edging and falling out of the
sky. Let go and it rolls back to wings-level and puts the nose on the horizon by
itself. Hold pitch while banked to tighten the turn, or to climb and dive; releasing
pitch hands the nose back to the auto-level.

Hands off, a full-bank turn comes round at about 59°/s — a 360 in roughly six
seconds. Pulling as well takes it to the same limit the AI flies to, so assist is
never an advantage in a fight, only easier to fly.

**Flight assist off.** The stick commands roll and pitch *rates* directly: the jet
holds whatever attitude you leave it in and rolls continuously while you hold the
key. Bank, then pull to turn, and roll out by hand. This is what the AI pilots fly.

## How a fight works

- **Guns never run out of ammunition.** Heat is the only limit: sustained fire cooks
  the barrels after about 9 seconds and locks them out until they cool. The arc around
  the reticle and the `CANNON` readout both show heat.
- **Missiles** need a held lock: the yellow brackets shrink onto the target and turn
  red at 1.5 s. Six per aircraft, 6 s between launches.
- **Flares** decoy incoming missiles — around a third of launches get spoofed. Deploy
  *early*: a missile still well out has time to be pulled off, while one about to
  arrive is committed. Each seeker gets exactly one chance to be fooled, so dumping
  your whole load at one missile is no better than a single well-timed salvo. Eight
  salvos of four, three quarters of a second apart.
- **The afterburner is a limited resource, not a throttle.** See below.
- **Terrain kills.** The `PULL UP` warning is not decorative.
- The **bank scale** above the reticle shows true bank; the `G` reading is a load
  gauge (1 g relaxed, 9 g at the manoeuvring limit), not a physical load factor —
  the turn rates here are arcade, not aerodynamic.
- First team to **20 kills** wins, or highest score at 12 minutes. Respawn is 5 s.
  AI-only matches run about 7–8 minutes; with you flying it is shorter. If that feels
  long, `match.scoreLimit` in the config is the dial.
- Leaving the 9 km combat area gives you 8 seconds before the hull starts taking damage.

## Layout

```
src/
  core/     config (all tuning), game loop & match state, input, settings,
            key bindings, math helpers
  world/    procedural island terrain + shader ocean, sky dome & cloud layer,
            rearm zones
  entities/ aircraft (flight model, damage, lock state), procedural jet mesh
  combat/   cannon rounds, guided missiles, decoy flares, particle FX
  audio/    synthesised engine, weapons and warning tones — no sample files
  ai/       AI pilot state machine (pursue / attack / evade / extend / recover)
  ui/       canvas HUD, scoreboard, menu / settings / end-of-match overlay
```

Every gameplay number lives in [`src/core/config.ts`](src/core/config.ts) — turn
rates, damage, lock times, AI skill, match rules — so the feel can be retuned
without touching the systems.

### Tuning without flying

The game exposes itself on `window.game`, and `game.step(dt)` advances the
simulation without rendering. To fast-forward a whole match in the console:

```js
game.paused = true;
for (let i = 0; i < 60 * 300 && !game.over; i++) game.step(1 / 60);
console.log(game.score, game.standings());
```

Useful for checking balance changes: kill rate, match length, how often the AI
flies into a hill.

## Built so far

- [x] Vite + TypeScript + Three.js scaffold
- [x] Procedural island map, shader ocean, sky and cloud layer
- [x] Afterburner with a fuel budget, and an air brake, in place of a throttle axis
- [x] Arcade flight model: bank-to-turn coordinated turns with auto-levelling,
      plus a raw rate-control mode, afterburner, stall-mushy controls, terrain crashes
- [x] Settings panel (inverted pitch/roll, assist, sensitivity, audio), persisted
- [x] Rebindable keyboard actions
- [x] Procedural audio: noise-based engine (rumble / roar / turbine whine / burner),
      airflow, layered cannon and explosions, missiles, flares, flyby whooshes, lock
      and missile-warning tones — positioned by distance and stereo pan, with air
      absorption and a convolution reverb
- [x] Decoy flares, used by the AI as well as the player
- [x] Chase and cockpit cameras with offset-based smoothing
- [x] Keyboard / mouse / gamepad input with a no-pointer-lock fallback
- [x] Cannon with tracers, heat and lead solutions
- [x] Lock-on and guided missiles with proximity fuze and blast falloff
- [x] AI pilots: target assignment across the squadron, gun/missile discipline,
      missile evasion, terrain and ceiling recovery
- [x] 5v5 match: scoring, kill feed, respawns, out-of-bounds, win/lose screen
- [x] Neutral rearm zones restoring missiles, flares, burner fuel and hull
- [x] Hold-Tab scoreboard with kills / deaths / assists / score, shared with the
      end-of-match panel
- [x] Leave a match mid-fight and start a fresh one from the title screen
- [x] Title screen with settings and key bindings behind a gear
- [x] Full HUD: tapes, compass, radar, contacts, lock brackets, warnings

## Not built yet

Roughly in the order that would add the most:

1. **Hit feedback** — visible tracer impacts on the airframe, control damage, fire trails.
2. **More airframes** — an interceptor and a heavy, sharing the flight model with
   different numbers in config.
3. **Multiplayer** — everything today is single-player: you plus nine local AI.
   The useful groundwork is that `Controls` has exactly two producers, `ai/pilot.ts`
   and the player branch in `core/game.ts`, and the flight model reads that struct
   without caring who filled it — so remote input drops into the same seam.
   The sim is *not* deterministic, though: unseeded `Math.random()` drives gun
   spread, flare decoy rolls, AI evade choices and spawn jitter, so lockstep would
   need a seeded PRNG first. Server-authoritative with client interpolation avoids
   that and is the likelier route.
4. **Native Mac build** — wrap in Tauri (small binary, uses the system WebView) for
   a real `.app`. No engine changes required.
5. **Touch controls** — a virtual stick would make it work on a phone.
6. **Chaff and radar missiles** — a second countermeasure/weapon pairing.

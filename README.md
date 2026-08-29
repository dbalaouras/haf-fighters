# HAF Fighters

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

**No backend.** HAF Fighters is a pure static front end — the whole game runs in the
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
| Swap missile type | `Q` | yes |
| Free look (hold) | `Shift` | yes |
| Radar zoom | Scroll wheel | — |
| Afterburner | `W` | yes |
| Brake | `S` | yes |
| Flares (infrared) | `F` | yes |
| Chaff (radar) | `E` | yes |
| Rudder | `A` / `D` | yes |
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

Three cues carry most of the tension and are built as distinct events rather than
variations on a beep:

- **Missile warning** is a harsh radar-warning buzzer, not a chime, and it tightens
  as the round closes — 5 pulses a second at 2.6 km rising to 12 at knife range,
  with the pitch climbing from about 1.4 to 2.0 kHz. It tells you *how close*, not
  merely *that something is coming*.
- **Your own death** is a heavy hit, structure tearing downwards, a sub drop and a
  ringing that outlives it, with the whole mix ducking to 28% underneath and
  recovering over two and a half seconds. Another aircraft going up nearby is a
  plain explosion; yours is not.
- **Splash** — your kill — is a squelch click and a clipped two-note call through a
  narrow band, so it reads as a radio confirmation rather than another world sound.
  It is deliberately not positional.

Volume and mute are behind the gear.

## Screens

The game opens on a **title screen** — set your **callsign**, `ENTER BATTLE` starts a
match, and the **gear in the corner** opens settings and key bindings. The callsign is
saved with the rest of your settings and appears on the HUD, the kill feed and the
scoreboard. `Esc` mid-match pauses to the same
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

## Missiles

Two types, swapped with `Q`, with an honest trade rather than one being strictly
better:

| | **IR** — AIM-9 | **Radar** — AIM-120 |
| --- | --- | --- |
| Rounds | 6 | 4 |
| Lock cone / range | 22° / 4.5 km | 38° / 9 km |
| Lock time | 1.5 s | 2.6 s |
| Launch breaks lock | **yes** | no |
| Time between shots | ~1.5 s (re-lock) | 8.5 s (reload) |
| Seeker turn rate | 2.5 rad/s | 1.35 rad/s |
| Countered by | **Flares** (~30%) | **Chaff** (~30%) |

Each has exactly one counter — flares are an infrared decoy, chaff a radar one — so
neither missile is a universal answer and neither countermeasure is either. Measured
over 200 launches per pairing: flares spoof 31% of heat-seekers and **0%** of radar
rounds; chaff spoofs 30% of radar rounds and **0%** of heat-seekers.

The heat-seeker is quick to lock and agile enough to follow a hard turn, but flares
beat it. Firing one **breaks the lock**, so its rate of fire is set by how fast you
can re-acquire rather than by a reload timer — hold the target on your nose and you
can put all six away in about nine seconds; let it slide out of the seeker cone and
you get nothing. The radar round goes active on its own, so launching it keeps your
lock, but it is paced by a long reload instead. The radar missile reaches twice as far, locks over a much wider cone and
ignores flares entirely — flares are an infrared countermeasure — but its seeker is
sluggish, so a hard break turn inside its turn radius will defeat it. Swapping
restarts the lock, since the two seekers have different cones and dwell times.

The AI picks by range too, so expect radar shots coming at you from distance that
your flares will do nothing about.

## Free look

Hold `Shift` and the mouse swings the camera around the aircraft instead of flying
it — useful for checking your six mid-turn. The flight path is completely
unaffected: the look is applied to the camera offset, not the aircraft, and the
stick holds its position while you look. Releasing eases the view back.

## Radar zoom

The scroll wheel steps the radar through 2 / 4 / 6 / 10 / 16 km. The display sits in
the top-right corner with the current range printed under it, and the kill feed runs
below it.

## Airframes

Three, picked on the title screen, with an honest triangle between them rather than
one being strictly better:

| | **F-16** | **FA-9** | **F-22** |
| --- | --- | --- | --- |
| Role | Knife-fighter | All-rounder | Interceptor |
| Top speed / burner | 306 / 392 | 320 / 409 | 358 / 458 m/s |
| Pitch · roll rate | 84 · 209 | 72 · 175 | 64 · 150 °/s |
| Hull | 86 | 100 | 114 |
| Burner endurance | 3.2 s | 4.0 s | 4.9 s |
| Heat-seekers · radar | 8 · 2 | 6 · 4 | 4 · 6 |
| Flares · chaff | 40 · 16 | 32 · 24 | 24 · 32 |

The F-16 out-turns everything and carries the heat-seekers and flares to fight up
close; the F-22 outruns and out-ranges everything on a radar-heavy load; the FA-9
sits between with no weakness and no edge. Each is structurally different, not just scaled: the **F-16 is single-engine** with a
chin inlet and one upright fin, while the FA-9 and F-22 are twin-engine with shoulder
inlets and canted twin fins — the F-22's canted twice as hard. From behind, the F-16
burns one wide plume and the others two.

Measured over four matches with the AI flying all three, and excluding the player:
K/D lands at 1.06, 1.25 and 1.21 respectively, so the triangle holds.

## Difficulty

Three settings on the title screen, changing how dangerous bandits are **to you**
rather than how skilful they are in the abstract:

| | Rookie | Regular | Ace |
| --- | --- | --- | --- |
| Missile lock time | 1.6× | 1× | 0.62× |
| Missile reload | 1.6× | 1× | 0.6× |
| How hard they single you out | never | some | strongly |
| Flare reaction | 2.1× slower | baseline | 1.8× faster |

Measured over three matches each: missiles fired **at the player** per minute goes
2.4 → 3.0 → 4.9, and a match finishes in 495 s → 310 s → 179 s.

That framing is deliberate, and it came out of the measurements. Scaling pilot
"skill" does not work in this game: every competence behaviour — evading, flaring,
breaking off a bad attack — takes a pilot out of the fight, and with a five second
respawn the scoring rewards aggression over survival. Bandits given *more* skill
measurably scored *worse* (a low-skill team took 56.4% of kills against a high-skill
team's 53.7%, and sluggish flare reaction beat snappy reaction 65% to 53.5%). So
difficulty is built from purely offensive levers, which measure monotonic.

## Maps

Two, picked on the title screen. The choice is saved, and switching rebuilds the
world in place rather than reloading.

**Coral Range — Dawn.** Open water, islands, long sightlines — and a **hollow
volcano** in the middle that you can fly inside. Three bored tunnels punch through
the shell at 700 m, and the crater is open, so you can enter level through an
opening or dive in over the rim. Inside is a chamber roughly 2.5 km across with a
lava floor that lights it, and the tunnel mouths glow orange from outside.

It is a good place to break a lock: a missile that follows you into a tunnel and
does not turn as well as you do hits rock.

A heightmap cannot describe this — `height(x, z)` is single-valued, so it has no way
to say "rock here, open air beneath it". The volcano is therefore its own mesh with
an analytic 3D solidity test behind it, registered with the terrain as a
`SolidVolume`. Collision, the camera floor and AI avoidance all defer to it inside
its footprint, so missiles, bullets and the chase camera all behave correctly in the
chamber without any of them knowing what a volcano is.

**Neon Delta — Night.** A river city after dark. Around 3,300 lit towers on both
banks, a meandering river, and a suspension bridge you can fly under — the deck sits
78 m over the water. Buildings are solid: they collide, stop the camera clipping
through them, and the AI avoids them, without the terrain mesh having to model them.
The towers are drawn as three instanced meshes grouped by height, so the whole
skyline costs a handful of draw calls rather than thousands.

Adding a third map means writing a `MapSpec` in [`src/world/maps.ts`](src/world/maps.ts)
— ground height, ground colour, sky and water palette, lighting and fog — rather than
touching the world code.

## Rearm rings

Four neutral rings hang over the map, oriented tangentially so they chain into a
circuit you can fly. **Fly through the hoop** and everything is restored at once —
hull, missiles, flares, afterburner fuel, and the cannon's heat. The ring then goes
**cold for 5 seconds**, turning amber on the HUD and in the world with the remaining
time shown, before coming back up.

You have to actually go through it: the check is whether your path crossed the ring's
plane *inside* the 170 m hoop between one frame and the next, not merely whether you
came close. Passing through from either side counts.

Both teams share the rings and the cooldown is per-ring rather than per-pilot, so a
bandit who just used one has denied it to you for five seconds. The AI uses them too,
breaking off when it is below 45% hull or out of missiles, and it will only commit to
a ring that is currently up.

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

- **The gunsight solves your lead for you.** A pipper marks where your rounds would
  actually arrive, with a dashed line back to the boresight and a ring that closes as
  the target runs out of range. It fills in amber when the solution is good — that is
  your cue to fire. Aiming at it lands **92%** of rounds against a target flying
  straight and **78%** against one turning hard; without it the lead angle runs to a
  dozen degrees and the cannon is guesswork.
- **Guns never run out of ammunition.** Heat is the only limit: sustained fire cooks
  the barrels after about 9 seconds and locks them out until they cool. The arc around
  the reticle and the `CANNON` readout both show heat.
- **Missiles** need a held lock: the yellow brackets shrink onto the target and turn
  red at 1.5 s. Six per aircraft, 6 s between launches.
- **Countermeasures** decoy incoming missiles — around a third get spoofed. `F` drops
  flares against heat-seekers, `E` drops chaff against radar rounds, and each is inert
  against the other seeker, so read the missile warning before you reach for one.
  Deploy *early*: a missile still well out has time to be pulled off, while one about
  to arrive is committed. Each seeker gets exactly one chance per type, so dumping
  your whole load at one missile is no better than a single well-timed salvo.
- **The afterburner is a limited resource, not a throttle.** See below.
- **Hits break things, not just the hull.** Rounds into the tail wreck the engine,
  into the wings the controls, into the belly the fuel. A wrecked engine costs you
  nearly half your top speed and locks out the burner; wrecked controls halve your
  turn rate; a holed tank bleeds burner reserve. The three bars under HULL show
  what is broken, and fly through a rearm ring to fix it.
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
  world/    map specs, procedural terrain + shader ocean, sky dome / stars /
            clouds, the night city and its bridge, rearm rings
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
- [x] Three airframes with distinct flight models, loadouts and silhouettes
- [x] Two maps — day islands with a fly-through hollow volcano, and a night river
      city with a flyable-under bridge — switchable from the title screen
- [x] AI terrain lookahead, so it pulls up for steep ground ahead of it rather than
      only reacting to what is directly beneath
- [x] Procedural terrain, shader ocean, sky, stars and cloud layer
- [x] Subsystem damage — engine, controls and fuel degrade by where you were hit
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
- [x] Neutral fly-through rearm rings: full restock on a pass, 5 s per-ring cooldown
- [x] Player callsign, set on the title screen and shown on the HUD and scoreboard
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
6. **Chaff** — a countermeasure for radar missiles, which currently have none.

import * as THREE from 'three';
import { CFG, DifficultyId, DIFFICULTIES, TEAM, TeamId, WEAPONS, other } from './config';
import { clamp, clamp01, damp, lerp, rand } from './mathx';
import { Input } from './input';
import { Terrain } from '../world/terrain';
import { Sky } from '../world/sky';
import { WaypointSystem } from '../world/waypoints';
import { City } from '../world/city';
import { Volcano } from '../world/volcano';
import { MapId, MAPS, MapSpec } from '../world/maps';
import { Aircraft } from '../entities/aircraft';
import { Pilot } from '../ai/pilot';
import { Fx } from '../combat/particles';
import { BulletSystem } from '../combat/bullets';
import { MissileSystem } from '../combat/missiles';
import { CountermeasureSystem } from '../combat/countermeasures';
import { Hud, FeedLine } from '../ui/hud';
import { Sound } from '../audio/sound';
import { Settings } from './settings';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _tmpQ = new THREE.Quaternion();

const CALLSIGNS: Record<TeamId, readonly string[]> = {
  BLUE: ['VIPER', 'HAWK', 'RAZOR', 'ECHO', 'SABRE'],
  RED: ['FANG', 'WRAITH', 'TALON', 'ONYX', 'VULTURE'],
};

export type MatchResult = { winner: TeamId | 'DRAW'; score: Record<TeamId, number> };

type CameraMode = 'chase' | 'cockpit';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private terrain!: Terrain;
  private sky!: Sky;
  private waypoints!: WaypointSystem;
  private city: City | null = null;
  private volcano: Volcano | null = null;
  private mapLights: THREE.Light[] = [];
  mapId!: MapId;
  private fx = new Fx();
  private bullets = new BulletSystem();
  private missiles = new MissileSystem();
  private cm = new CountermeasureSystem();
  private hud: Hud;
  readonly audio: Sound;

  aircraft: Aircraft[] = [];
  player!: Aircraft;
  private pilots: Pilot[] = [];
  private slot = new Map<Aircraft, number>();

  private difficulty: DifficultyId;
  score: Record<TeamId, number> = { BLUE: 0, RED: 0 };
  timeLeft = CFG.match.timeLimit;
  time = 0;
  paused = true;
  over = false;

  private feed: FeedLine[] = [];
  private damageFlash = 0;
  /** counts down after the player flies a rearm ring, for the HUD banner */
  private rearmFlash = 0;
  private shake = 0;
  private cameraMode: CameraMode = 'chase';
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  /** camera pose is smoothed as an offset from the jet, never as an absolute point —
   *  smoothing an absolute target lags by speed/stiffness, which at 300 m/s is 45 m */
  private camOffset = new THREE.Vector3();
  private lookOffset = new THREE.Vector3();
  private lookYaw = 0;
  private lookPitch = 0;
  private freeLook = false;
  private _lookQ = new THREE.Quaternion();
  private _lookAxis = new THREE.Vector3();
  private fps = 60;
  private last = 0;
  private raf = 0;

  onMatchEnd?: (r: MatchResult) => void;
  /** ticked every rendered frame, for UI that needs to refresh itself */
  onFrame?: (dt: number) => void;

  private _v = new THREE.Vector3();
  private _w = new THREE.Vector3();
  private _up = new THREE.Vector3();
  private _gun = new THREE.Vector3();
  private _gunDir = new THREE.Vector3();

  constructor(
    sceneCanvas: HTMLCanvasElement,
    hudCanvas: HTMLCanvasElement,
    readonly input: Input,
    private settings: Settings,
  ) {
    this.audio = new Sound(settings);
    this.difficulty = settings.data.difficulty;
    this.renderer = new THREE.WebGLRenderer({
      canvas: sceneCanvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(0x8fb0cf);

    this.camera = new THREE.PerspectiveCamera(CFG.camera.fov, innerWidth / innerHeight, CFG.camera.near, CFG.camera.far);

    this.scene.add(this.fx.group, this.bullets.object, this.missiles.group);
    this.applyMap(settings.data.mapId);

    this.hud = new Hud(hudCanvas);
    this.spawnTeams();
    settings.onChange((d) => {
      if (d.mapId !== this.mapId) this.applyMap(d.mapId);
      if (d.difficulty !== this.difficulty) {
        this.difficulty = d.difficulty;
        this.configurePilots();
      }
    });
    this.player.name = settings.data.pilotName;
    settings.onChange((d) => { this.player.name = d.pilotName; });

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }

  /* ---------------- maps ---------------- */

  /** Tear down the current world and build the chosen one in its place. */
  applyMap(id: MapId) {
    const spec: MapSpec = MAPS[id];
    this.mapId = id;

    if (this.terrain) {
      this.scene.remove(this.terrain.mesh, this.terrain.water, this.sky.group, this.waypoints.group);
      this.terrain.mesh.geometry.dispose();
      (this.terrain.mesh.material as THREE.Material).dispose();
      this.terrain.water.geometry.dispose();
      (this.terrain.water.material as THREE.Material).dispose();
      for (const l of this.mapLights) this.scene.remove(l);
      this.mapLights = [];
    }
    if (this.city) {
      this.scene.remove(this.city.group);
      this.city.dispose();
      this.city = null;
    }
    if (this.volcano) {
      this.scene.remove(this.volcano.group);
      this.volcano.dispose();
      this.volcano = null;
    }

    this.terrain = new Terrain(spec);
    this.sky = new Sky(spec);
    this.mapLights = this.sky.addLights(this.scene);
    this.scene.fog = new THREE.Fog(spec.fog.color, spec.fog.near, spec.fog.far);
    this.renderer.setClearColor(spec.fog.color);

    if (spec.scenery === 'city') {
      this.city = new City(spec);
      this.terrain.setObstacles(this.city.solidHeight);
      this.scene.add(this.city.group);
    } else if (spec.scenery === 'volcano') {
      this.volcano = new Volcano();
      this.terrain.setVolume(this.volcano);
      this.scene.add(this.volcano.group);
    }

    this.waypoints = new WaypointSystem(this.terrain);
    this.scene.add(this.sky.group, this.terrain.mesh, this.terrain.water, this.waypoints.group);

    if (this.player) this.reset();
  }

  get mapName(): string { return MAPS[this.mapId].name; }

  /* ---------------- setup ---------------- */

  private spawnTeams() {
    for (const team of ['BLUE', 'RED'] as TeamId[]) {
      for (let i = 0; i < CFG.match.teamSize; i++) {
        const isPlayer = team === 'BLUE' && i === 0;
        const a = new Aircraft(team, CALLSIGNS[team][i], isPlayer);
        this.slot.set(a, i);
        a.respawn(i);
        this.scene.add(a.object);
        this.aircraft.push(a);
        if (isPlayer) {
          this.player = a;
          a.object.visible = true;
        } else {
          this.pilots.push(new Pilot(a, DIFFICULTIES[this.settings.data.difficulty], i));
        }
      }
    }
    // start the player slightly astern of the formation, nose towards the fight
    this.player.pos.y = 1600;
    this.resetCamera();
    this.pushFeed('MATCH START — 5v5 DOGFIGHT', null);
  }

  /** Start a completely fresh match: scores, pilots and all carried stores. */
  reset() {
    this.score = { BLUE: 0, RED: 0 };
    this.timeLeft = CFG.match.timeLimit;
    this.over = false;
    this.feed = [];
    this.configurePilots();
    this.cm.reset();
    this.waypoints.reset();
    this.audio.reset();
    for (const a of this.aircraft) {
      a.kills = 0; a.deaths = 0; a.assists = 0; a.score = 0; a.damageDealt = 0;
      a.alive = true;
      a.respawn(this.slot.get(a) ?? 0);
    }
    this.resetCamera();
    this.pushFeed('MATCH START — 5v5 DOGFIGHT', null);
  }

  /* ---------------- loop ---------------- */

  start() {
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      let dt = (now - this.last) / 1000;
      this.last = now;
      dt = clamp(dt, 0.0005, 0.05);
      this.fps = lerp(this.fps, 1 / dt, 0.06);

      if (!this.paused && !this.over) this.update(dt);
      else this.fx.update(dt * 0.2);

      this.updateCamera(this.paused ? dt * 0.15 : dt);
      this.audio.setListener(this.camera.position, this.camera.quaternion);
      this.audio.update(dt, this.player, !this.paused && !this.over, this.aircraft);
      this.terrain.update(dt, this.camera.position);
      this.renderer.render(this.scene, this.camera);
      this.hud.draw(this.hudState(), dt);
      this.onFrame?.(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() { cancelAnimationFrame(this.raf); }

  /** Re-roll every AI pilot for the currently selected difficulty. */
  private configurePilots() {
    const diff = DIFFICULTIES[this.settings.data.difficulty];
    for (let i = 0; i < this.pilots.length; i++) {
      this.pilots[i].configure(diff, i % CFG.match.teamSize);
    }
  }

  /** Abandon the current match and sit paused on the menu. */
  leaveMatch() {
    this.paused = true;
    this.over = false;
    this.reset();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Advance the simulation without rendering — used by the headless sim check. */
  step(dt: number) { this.update(dt); }

  private update(dt: number) {
    this.time += dt;
    this.timeLeft -= dt;

    // --- player controls ---
    const s = this.input.sample(dt);
    if (this.input.consumeCameraToggle()) this.cameraMode = this.cameraMode === 'chase' ? 'cockpit' : 'chase';
    if (this.input.consumeWeaponSwap() && this.player.alive) {
      const w = this.player.cycleWeapon();
      this.pushFeed(`${WEAPONS[w].label}`, this.player.team, 1.4);
    }
    this.lookYaw = s.lookYaw;
    this.lookPitch = s.lookPitch;
    this.freeLook = s.freeLook;
    const pc = this.player.controls;
    if (this.player.alive) {
      pc.pitch = s.pitch; pc.roll = s.roll; pc.yaw = s.yaw;
      pc.throttle = s.throttle; pc.burner = s.burner;
      pc.gun = s.gun; pc.missile = s.missile; pc.flares = s.flares; pc.chaff = s.chaff;
    } else {
      pc.gun = pc.missile = pc.flares = pc.chaff = pc.burner = false;
    }

    // --- AI ---
    for (const p of this.pilots) p.update(dt, this.time, this.aircraft, this.pilots, this.terrain, this.waypoints);

    // --- flight + per-aircraft systems ---
    for (const a of this.aircraft) {
      a.threatRange = Infinity;
      if (a.threat <= 0) a.threatKind = null;
      a.update(dt);
      if (!a.alive) {
        if (a.respawnTimer <= 0) a.respawn(this.slot.get(a) ?? 0);
        continue;
      }
      this.updateLock(a, dt);
      this.handleWeapons(a, dt);
      this.checkTerrain(a);
      this.checkBounds(a, dt);
      // trail smoke for a wrecked system as well as a wrecked hull
      const hurt = Math.max(1 - a.hp / 45, a.worstSystem < 0.6 ? 1 - a.worstSystem : 0);
      if (hurt > 0) this.fx.damageSmoke(a.pos, a.velocity(this._v), Math.min(1, hurt));
    }

    // --- projectiles ---
    this.bullets.update(dt, this.aircraft, this.terrain, this.fx,
      (victim, shooter, dmg, at) => this.applyDamage(victim, shooter, dmg, at));
    this.missiles.update(dt, this.aircraft, this.terrain, this.fx,
      (hit) => this.applyDamage(hit.victim, hit.shooter, hit.damage, hit.at),
      (at) => this.audio.explosion(at, 1));

    this.volcano?.update(dt);
    this.waypoints.update(dt, this.aircraft, (a) => {
      a.restock();
      this.audio.rearm(a.pos);
      if (a === this.player) {
        this.rearmFlash = 1.6;
        this.pushFeed('REARMED', a.team, 2);
      }
    });
    this.cm.update(dt, this.fx);
    this.fx.update(dt);

    // --- match state ---
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
    this.rearmFlash = Math.max(0, this.rearmFlash - dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    for (const f of this.feed) f.t -= dt;
    this.feed = this.feed.filter((f) => f.t > 0);

    if (this.score.BLUE >= CFG.match.scoreLimit || this.score.RED >= CFG.match.scoreLimit || this.timeLeft <= 0) {
      this.endMatch();
    }
  }

  /* ---------------- combat pipeline ---------------- */

  private updateLock(a: Aircraft, dt: number) {
    const M = a.weaponSpec;
    let best: Aircraft | null = null;
    let bestAngle = Infinity;

    for (const t of this.aircraft) {
      if (!t.alive || t.team === a.team) continue;
      this._v.copy(t.pos).sub(a.pos);
      const d = this._v.length();
      if (d > M.lockRange) continue;
      const ang = a.forward(this._w).angleTo(this._v.normalize());
      if (ang > M.lockAngle) continue;
      if (ang < bestAngle) { bestAngle = ang; best = t; }
    }

    if (!best) {
      a.lockProgress = Math.max(0, a.lockProgress - dt * 1.5);
      a.locked = false;
      if (a.lockProgress <= 0) a.lockTarget = null;
      return;
    }
    if (best !== a.lockTarget) {
      a.lockTarget = best;
      a.lockProgress = 0;
      a.locked = false;
      return;
    }
    a.lockProgress = clamp01(a.lockProgress + dt / (M.lockTime * a.lockScale));
    const wasLocked = a.locked;
    a.locked = a.lockProgress >= 1;
    if (a.locked && !wasLocked && a.isPlayer) {
      this.pushFeed(`${a.weaponSpec.tag} LOCK — ${best.name}`, null, 1.6);
    }
  }

  private handleWeapons(a: Aircraft, dt: number) {
    const c = a.controls;

    // cannon — accumulator loop so the rate is frame-rate independent
    const interval = 60 / CFG.gun.rpm;
    if (c.gun && !a.gunOverheated) {
      if (a.gunCooldown < -interval) a.gunCooldown = 0;
      while (a.gunCooldown <= 0) {
        a.gunCooldown += interval;
        a.gunHeat = Math.min(1, a.gunHeat + CFG.gun.heatPerShot);
        if (a.gunHeat >= 1) a.gunOverheated = true;
        const origin = this._v.copy(a.pos).addScaledVector(a.forward(this._w), 7.5);
        this.bullets.spawn(a, origin, a.forward(this._w));
        this.fx.muzzleFlash(origin, this._w.multiplyScalar(CFG.gun.speed));
        this.audio.gun(a.pos, a);
      }
    } else if (a.gunCooldown < 0) {
      a.gunCooldown = 0;
    }

    // countermeasures: one salvo per press, and every live missile chasing this jet
    // that the type can actually fool gets a single roll
    if (c.flares && a.flares >= CFG.flare.salvo && a.flareCooldown <= 0) {
      a.flares -= CFG.flare.salvo;
      a.flareCooldown = CFG.flare.cooldown;
      this.missiles.onDecoySalvo(this.cm.deploy(a, 'FLARE'), a);
      this.audio.flares(a.pos);
      if (a.isPlayer) this.pushFeed('FLARES', a.team, 1.4);
    }
    if (c.chaff && a.chaff >= CFG.chaff.salvo && a.chaffCooldown <= 0) {
      a.chaff -= CFG.chaff.salvo;
      a.chaffCooldown = CFG.chaff.cooldown;
      this.missiles.onDecoySalvo(this.cm.deploy(a, 'CHAFF'), a);
      this.audio.flares(a.pos);
      if (a.isPlayer) this.pushFeed('CHAFF', a.team, 1.4);
    }

    // missiles need a completed lock
    if (c.missile && a.missiles > 0 && a.missileCooldown <= 0 && a.locked && a.lockTarget) {
      const spec = a.weaponSpec;
      a.ammo[a.weapon]--;
      a.missileCooldown = spec.reload * a.reloadScale;
      this.missiles.fire(a, a.lockTarget);
      this.audio.missileLaunch(a.pos);
      // a heat-seeker launch breaks the lock: fire again as soon as you re-acquire
      if (spec.dropsLockOnFire) a.breakLock();
      if (a.isPlayer) {
        // FOX 2 is the infrared call, FOX 3 the active-radar one
        const call = spec.id === 'RADAR' ? 'FOX 3' : 'FOX 2';
        this.pushFeed(`${call} — ${a.lockTarget.name}`, a.team, 2.2);
      }
      c.missile = false;
    }
    void dt;
  }

  private applyDamage(victim: Aircraft, shooter: Aircraft | null, dmg: number, at?: THREE.Vector3) {
    const lethal = victim.damage(dmg, shooter, this.time, at);
    if (victim === this.player) {
      this.damageFlash = Math.min(1, this.damageFlash + dmg / 40);
      this.shake = Math.min(1, this.shake + dmg / 60);
      this.audio.hullHit();
    }
    if (lethal) this.destroy(victim, shooter);
  }

  private destroy(victim: Aircraft, killer: Aircraft | null) {
    this.fx.explosion(victim.pos, 2.4);
    // your own aircraft coming apart is a different event from one going up nearby
    if (victim === this.player) this.audio.playerDeath(victim.pos);
    else this.audio.explosion(victim.pos, 1.5);
    victim.die();

    if (killer && killer !== victim && killer.team !== victim.team) {
      killer.kills++;
      killer.score += CFG.scoring.kill;
      this.score[killer.team]++;
      this.pushFeed(`${killer.name} ▸ ${victim.name}`, killer.team, 5);
      if (killer === this.player) {
        this.shake = Math.min(1, this.shake + 0.25);
        this.audio.splash();
      }
    } else {
      this.pushFeed(`${victim.name} went down`, null, 5);
    }

    // everyone else who put rounds into them recently gets an assist
    for (const [attacker, at] of victim.damagedBy) {
      if (attacker === killer || attacker === victim) continue;
      if (attacker.team === victim.team) continue;
      if (this.time - at > CFG.scoring.assistWindow) continue;
      attacker.assists++;
      attacker.score += CFG.scoring.assist;
    }
    victim.damagedBy.clear();
  }

  private checkTerrain(a: Aircraft) {
    if (!this.terrain.collides(a.pos, CFG.hull.crashClearance)) return;
    // credit the last attacker if they hit recently — otherwise it is a plain crash
    const recent = a.lastHitBy && this.time - a.lastHitAt < 6 ? a.lastHitBy : null;
    a.hp = 0;
    this.destroy(a, recent);
  }

  private checkBounds(a: Aircraft, dt: number) {
    const r = Math.hypot(a.pos.x, a.pos.z);
    if (r < CFG.match.arenaRadius) { a.oobTimer = 0; return; }
    a.oobTimer += dt;
    if (a.oobTimer > CFG.match.outOfBoundsGrace) {
      this.applyDamage(a, null, CFG.match.outOfBoundsDps * dt);
    }
  }

  private endMatch() {
    this.over = true;
    const winner: TeamId | 'DRAW' =
      this.score.BLUE === this.score.RED ? 'DRAW' : this.score.BLUE > this.score.RED ? 'BLUE' : 'RED';
    this.onMatchEnd?.({ winner, score: { ...this.score } });
  }

  pushFeed(text: string, team: TeamId | null, t = 4) {
    this.feed.push({ text, team, t });
    if (this.feed.length > 12) this.feed.shift();
  }

  /* ---------------- camera ---------------- */

  private resetCamera() {
    const p = this.player;
    const fwd = p.forward(this._v);
    this.camOffset.copy(fwd).multiplyScalar(-CFG.camera.chaseBack);
    this.camOffset.y += CFG.camera.chaseUp;
    this.lookOffset.copy(fwd).multiplyScalar(CFG.camera.lookAhead);
    this.camPos.copy(p.pos).add(this.camOffset);
    this.camLook.copy(p.pos).add(this.lookOffset);
    this.camera.position.copy(this.camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLook);
  }

  private updateCamera(dt: number) {
    const p = this.player;
    const C = CFG.camera;
    const fwd = p.forward(this._v);

    if (this.cameraMode === 'cockpit' && p.alive) {
      this.camPos.copy(p.pos).addScaledVector(fwd, 4.2).addScaledVector(p.up(this._w), 1.15);
      this.camera.position.copy(this.camPos);
      this.camera.quaternion.copy(p.quat);
    } else {
      // blend world-up with the aircraft's up so the camera rolls, but only partly
      this._up.set(0, 1, 0).lerp(p.up(this._w), 0.42).normalize();
      const back = C.chaseBack + clamp01((p.speed - 200) / 240) * 10;

      if (p.alive) {
        const wanted = this._w.set(0, 0, 0)
          .addScaledVector(fwd, -back)
          .addScaledVector(this._up, C.chaseUp);
        this.camOffset.lerp(wanted, 1 - Math.exp(-C.stiffness * dt));
        this.camPos.copy(p.pos).add(this.camOffset);

        this.lookOffset.lerp(this._w.copy(fwd).multiplyScalar(C.lookAhead), 1 - Math.exp(-9 * dt));
        this.camLook.copy(p.pos).add(this.lookOffset);
      } else {
        // hold position on the wreck instead of chasing it down
        this.camLook.lerp(p.pos, 1 - Math.exp(-4 * dt));
      }

      // Free look swings the camera around the jet while it keeps flying itself.
      // Applied to the offset rather than the aircraft, so the flight path is
      // completely unaffected by where the pilot happens to be looking.
      const looking = Math.abs(this.lookYaw) > 1e-3 || Math.abs(this.lookPitch) > 1e-3;
      if (looking && p.alive) {
        this._lookQ.setFromAxisAngle(WORLD_UP, this.lookYaw);
        this._lookAxis.crossVectors(this.camOffset, WORLD_UP).normalize();
        this._lookQ.multiply(_tmpQ.setFromAxisAngle(this._lookAxis, this.lookPitch));
        const off = this._w.copy(this.camOffset).applyQuaternion(this._lookQ);
        this.camPos.copy(p.pos).add(off);
        this.camLook.copy(p.pos);
      }

      // never let the camera sink into the ground
      const floor = Math.max(6, this.terrain.floorAt(this.camPos) + 14);
      if (this.camPos.y < floor) this.camPos.y = floor;

      this.camera.position.copy(this.camPos);
      this.camera.up.copy(this._up);
      this.camera.lookAt(this.camLook);
    }

    if (this.shake > 0.001) {
      const k = this.shake * this.shake * 2.2;
      this.camera.position.x += rand(-k, k);
      this.camera.position.y += rand(-k, k);
      this.camera.position.z += rand(-k, k);
    }

    const burnerBlend = clamp01((p.speed - CFG.flight.speedMax * 0.8) / (CFG.flight.speedBurner - CFG.flight.speedMax * 0.8));
    const targetFov = lerp(CFG.camera.fov, CFG.camera.fovBurner, burnerBlend);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, targetFov, 3, dt);
      this.camera.updateProjectionMatrix();
    }

    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
  }

  /**
   * Where the player's rounds would arrive, for the gunsight.
   *
   * Same solution the AI flies: extrapolate the target's current turn over the
   * bullet's flight time. Solved twice, because the flight time depends on the
   * distance to the predicted point rather than to the target's present position.
   */
  private gunSolution() {
    const p = this.player;
    if (!p.alive) return null;

    // prefer whatever is locked, else the closest enemy near the nose
    let target: Aircraft | null = null;
    let bestScore = Infinity;
    for (const t of this.aircraft) {
      if (!t.alive || t.team === p.team) continue;
      const d = t.pos.distanceTo(p.pos);
      if (d > CFG.gun.pipperRange) continue;
      const ang = p.forward(this._w).angleTo(this._v.copy(t.pos).sub(p.pos).normalize());
      if (ang > 0.9) continue;                       // roughly ahead only
      const score = d + ang * 1400 - (t === p.lockTarget ? 600 : 0);
      if (score < bestScore) { bestScore = score; target = t; }
    }
    if (!target) return null;

    const bulletSpeed = CFG.gun.speed + p.speed * 0.35;
    let t = target.pos.distanceTo(p.pos) / bulletSpeed;
    for (let i = 0; i < 2; i++) {
      target.predictPosition(t, this._gun);
      t = this._gun.distanceTo(p.pos) / bulletSpeed;
    }

    const dist = this._gun.distanceTo(p.pos);
    const off = p.forward(this._w).angleTo(this._gunDir.copy(this._gun).sub(p.pos).normalize());
    const missBy = Math.tan(Math.min(off, 1.3)) * dist;
    return {
      point: this._gun,
      dist,
      missBy,
      hot: missBy < CFG.gun.pipperHotMiss && dist < CFG.gun.range,
      name: target.name,
    };
  }

  /* ---------------- hud ---------------- */

  private hudState() {
    const p = this.player;
    const agl = p.pos.y - Math.max(0, this.terrain.height(p.pos.x, p.pos.z));

    let banner: { text: string; sub?: string; color?: string } | null = null;
    if (!p.alive) {
      banner = {
        text: 'DESTROYED',
        sub: `RESPAWN IN ${Math.max(0, Math.ceil(p.respawnTimer))}`,
        color: '#ff6a58',
      };
    }

    return {
      player: p,
      aircraft: this.aircraft,
      camera: this.camera,
      score: this.score,
      timeLeft: this.timeLeft,
      feed: this.feed,
      banner,
      oobSeconds: p.oobTimer > 0 ? Math.max(0, CFG.match.outOfBoundsGrace - p.oobTimer) : 0,
      damageFlash: this.damageFlash,
      fps: this.fps,
      agl,
      assist: p.assist,
      invertPitch: this.input.invertPitch,
      waypoints: this.waypoints.points,
      rearmFlash: this.rearmFlash,
      radarRange: this.input.radarRange,
      freeLook: this.freeLook,
      gun: this.gunSolution(),
      muted: this.settings.effectiveVolume <= 0,
    };
  }

  /** Everything the scoreboard needs, for both the Tab overlay and the end panel. */
  matchInfo(result?: 'VICTORY' | 'DEFEAT' | 'DRAW') {
    return {
      score: this.score,
      timeLeft: Math.max(0, this.timeLeft),
      teams: this.standings(),
      mapName: this.mapName,
      result,
    };
  }

  /** Team summary for the end-of-match screen. */
  standings() {
    return (['BLUE', 'RED'] as TeamId[]).map((t) => ({
      team: t,
      css: TEAM[t].css,
      pilots: this.aircraft
        .filter((a) => a.team === t)
        .map((a) => ({
          name: a.name, kills: a.kills, deaths: a.deaths, assists: a.assists,
          score: a.score, isPlayer: a.isPlayer, alive: a.alive,
          respawnIn: a.alive ? 0 : Math.max(0, Math.ceil(a.respawnTimer)),
        }))
        .sort((x, y) => y.score - x.score),
    }));
  }

  get enemyTeam(): TeamId { return other(this.player.team); }
}

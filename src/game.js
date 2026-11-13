// Simulation shared by every stage: holes, things that fall into them, bots, traffic, pedestrians.
// A stage is one "world" (a city, a region, the Earth, the solar system, ...). The rules never
// change between stages, only the scenery and what the hole stands on:
//   ground - a flat world with a real pit cut into the floor
//   globe  - the same thing wrapped around a sphere (positions are longitude / latitude)
//   space  - no floor at all; the hole is a black hole and things spiral into it
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { uniforms, MAX_HOLES, CHARACTER_SCALE, makeGroundMaterial } from './assets.js';
import { NODES, nodePos } from './city.js';

const CELL = 10, ORIGIN = -200, CELLS = 40;
const FIT = 0.92;          // an object fits when its size <= radius * FIT
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const COLORS = [0x2f9bff, 0xff5a5f, 0xffb400, 0x69d84f, 0xb86bff, 0xff7ad9, 0x18c9c0, 0xff8a3d];
const BOT_NAMES = ['Munchy', 'Pothole Pete', 'Abyss', 'Nom Nom', 'Sinker', 'Gobbler', 'Crater Kate', 'Deep Dan',
  'Gulpzilla', 'Manhole Max', 'Void Vera', 'Big Dipper', 'Chomp', 'Drainpipe', 'Lil Pit', 'Sir Swallow'];

// Every stage runs through the same twelve sizes. LEVEL_XP is how much has to be eaten to reach
// each one (scaled per stage), FINISH_XP ends a stage that has no boss object.
export const LEVEL_R = [1, 1.4, 1.9, 2.5, 3.2, 4, 5, 6.2, 7.6, 9.2, 11, 13];
const LEVEL_XP = [0, 8, 20, 36, 58, 86, 122, 167, 222, 292, 382, 497];
const FINISH_XP = 640;
export const MAX_LEVEL = LEVEL_R.length - 1;

// Small holes are nimble, big ones lumber.
const speedFor = (r) => 13 / Math.pow(r, 0.18);
const cellOf = (v) => Math.max(0, Math.min(CELLS - 1, Math.floor((v - ORIGIN) / CELL)));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const _m = new THREE.Matrix4(), _f = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _axis = new THREE.Vector3();
const _color = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
let _dx = 0, _dz = 0;

let wallGeo, ringGeo, ringGeoPlayer, coreGeo, wallMat;

// In space the hole is a black ball with a bright edge, so it reads against a black sky.
function horizonMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 3.0);
        gl_FragColor = vec4(mix(vec3(0.0), uColor * 1.6 + 0.25, rim), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
function holeGeometry() {
  if (wallGeo) return;
  wallGeo = new THREE.CylinderGeometry(1, 1, 1, 56, 1, false).translate(0, -0.5, 0);
  const pos = wallGeo.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const top = pos.getY(i) > -0.01;
    col[i * 3] = top ? 0.10 : 0; col[i * 3 + 1] = top ? 0.095 : 0; col[i * 3 + 2] = top ? 0.13 : 0;
  }
  wallGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  wallMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  ringGeo = new THREE.RingGeometry(0.97, 1.1, 72).rotateX(-Math.PI / 2);
  ringGeoPlayer = new THREE.RingGeometry(1.0, 1.6, 96, 2).rotateX(-Math.PI / 2);
  coreGeo = new THREE.SphereGeometry(1, 40, 24);
}

// Ring around a hole. For the player it doubles as the level progress bar:
// it fills clockwise from the top, and flashes white on a level-up.
function ringMaterial(color, fill) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uFill: { value: new THREE.Color(fill) },
      uProgress: { value: 0 }, uFlash: { value: 0 }, uOuter: { value: 2 },
    },
    side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform vec3 uFill; uniform float uProgress; uniform float uFlash; uniform float uOuter; varying vec2 vP;
      void main() {
        if (length(vP) > uOuter) discard;
        float f = atan(vP.x, -vP.y) / 6.2831853;
        if (f < 0.0) f += 1.0;
        vec3 c = f < uProgress ? uFill : uColor;
        gl_FragColor = vec4(mix(c, vec3(1.0), uFlash), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

class Hole {
  constructor(index, name, color, isPlayer) {
    holeGeometry();
    this.index = index; this.name = name; this.color = color; this.isPlayer = isPlayer;
    this.x = 0; this.z = 0; this.vx = 0; this.vz = 0;
    this.score = 0; this.xp = 0; this.level = 0; this.r = LEVEL_R[0]; this.shown = this.r; this.grow = 0; this.flash = 0;
    this.alive = true; this.respawn = 0; this.eaten = 0;
    this.ai = { think: Math.random() * 0.5, tx: 0, tz: 0, obj: null, prey: null, chase: 0, skip: new Set(), skill: 0.38 + Math.random() * 0.24, aggro: 0.15 + Math.random() * 0.4, idle: 0 };
    this.group = new THREE.Group();
    this.wall = new THREE.Mesh(wallGeo, wallMat);
    this.core = new THREE.Mesh(coreGeo, horizonMaterial(color));
    this.ring = new THREE.Mesh(isPlayer ? ringGeoPlayer : ringGeo, ringMaterial(color, isPlayer ? 0xffd21f : color));
    this.group.add(this.wall, this.core, this.ring);
  }
}

function instancedGeometry(base, count, withFall) {
  const g = new THREE.BufferGeometry();
  for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
  if (base.index) g.setIndex(base.index);
  for (const grp of base.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  g.boundingBox = base.boundingBox; g.boundingSphere = base.boundingSphere;
  if (withFall) g.setAttribute('aFall', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
  return g;
}

export class Game {
  constructor(scene, assets) {
    this.scene = scene; this.assets = assets;
    this.on = { eat() {}, swallow() {}, sizeUp() {}, respawn() {}, stageDone() {}, lost() {}, bossReady() {} };
    this.root = null; this.globe = null; this.holes = []; this.objects = []; this.falling = []; this.people = [];
    this.cars = []; this.pets = []; this.tall = []; this.movers = []; this.named = [];
    this.grid = []; this.mode = 'idle'; this.player = null; this.stage = null; this.stageIndex = 0;
    this.kind = 'ground'; this.bound = 150; this.globeR = 1; this.wrapX = 0;
    this.input = { x: 0, z: 0, point: false, tx: 0, tz: 0 };
    this.focus = new THREE.Vector3(); this.viewRadius = 80; this.frameNo = 0; this.clock = 0;
    this.base = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), makeGroundMaterial({ color: 0x6fbf73 }));
    this.base.position.y = -0.04; this.base.receiveShadow = true;
    scene.add(this.base);
  }

  // ---- world construction ------------------------------------------------
  dispose() {
    if (!this.root) return;
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.isInstancedMesh) { o.geometry.dispose(); o.dispose(); }
      if (o.isSkinnedMesh) o.skeleton.dispose();
    });
    for (const h of this.holes) { h.ring.material.dispose(); h.core.material.dispose(); }
    if (this.stage && this.stage.dispose) this.stage.dispose();
    this.root = null; this.globe = null;
  }

  // `stage` is the description a stage builder returned (see stages.js).
  build(stage, stageIndex, playerName, carry) {
    this.dispose();
    const { models, characters } = this.assets;
    const rnd = this.rnd = stage.rnd;
    this.stage = stage; this.stageIndex = stageIndex; this.kind = stage.kind;
    this.bound = stage.bound || 150; this.globeR = stage.globeR || 1; this.wrapX = Math.PI * 2 * this.globeR;
    this.zMax = this.globeR * 1.3;                       // latitude limit on a globe (about 75 degrees)
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.objects = []; this.falling = []; this.people = []; this.cars = []; this.tall = []; this.pets = [];
    this.movers = []; this.named = []; this.leaning = new Set(); this.frameNo = 0; this.boss = null; this.bossTold = false;
    this.grid = Array.from({ length: CELLS * CELLS }, () => []);
    this.base.visible = this.kind === 'ground';
    if (stage.baseColor) this.base.material.color.copy(stage.baseColor);
    uniforms.uFade.value = this.kind === 'ground' ? 10 : 1e6;
    if (this.kind === 'globe') { this.globe = stage.globe; this.root.add(this.globe); this.globe.position.set(0, -this.globeR, 0); }
    if (stage.extra) (stage.extraOnGlobe ? this.globe : this.root).add(stage.extra);
    const parent = this.globe || this.root;

    const byModel = (list) => {
      const map = new Map();
      for (const p of list) { if (!map.has(p.model)) map.set(p.model, []); map.get(p.model).push(p); }
      return map;
    };

    for (const [name, list] of byModel(stage.ground || [])) {
      const model = models[name];
      if (!model) throw new Error(`Unknown ground model ${name}`);
      const mesh = new THREE.InstancedMesh(instancedGeometry(model.geometry, list.length, false), model.material, list.length);
      list.forEach((p, i) => {
        _q.setFromAxisAngle(UP, p.rot || 0);
        mesh.setMatrixAt(i, _m.compose(_p.set(p.x, p.y || 0, p.z), _q, _s.setScalar(p.s || 1)));
      });
      mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.root.add(mesh);
    }

    // Moving cars share the instanced meshes with parked ones.
    const traffic = (stage.traffic || []).map((t) => ({ model: t.model, x: 0, z: 0, rot: 0, y: t.y ?? 0.1, s: t.s || 1, car: t }));
    for (const [name, list] of byModel((stage.props || []).concat(traffic))) {
      const model = models[name];
      if (!model) throw new Error(`Unknown model ${name}`);
      const mesh = new THREE.InstancedMesh(instancedGeometry(model.geometry, list.length, true), model.material, list.length);
      mesh.castShadow = this.kind === 'ground'; mesh.receiveShadow = this.kind === 'ground'; mesh.frustumCulled = false;
      parent.add(mesh);
      list.forEach((p, idx) => {
        const s = p.s || 1;
        // nothing may be too big for a maxed-out hole, or a stage could never be cleared
        const rf = p.rf || Math.min(11.5, Math.max(0.3, model.footprint * s + 0.03 * model.height * s));
        const o = this.makeObject(p, rf, model.halfDiag * s, model.height * s, model.footprint * s);
        o.mesh = mesh; o.idx = idx; o.s = s;
        if (p.color !== undefined) mesh.setColorAt(idx, _color.set(p.color));
        if (p.boss) { o.boss = true; this.boss = o; }
        if (p.car) this.setupCar(o, p.car);
        else if (p.pet) { o.kind = 'pet'; o.area = p.pet; o.speed = 1.2 + rnd() * 1.2; o.tx = o.x; o.tz = o.z; o.hop = rnd() * 6; o.pts += 3; this.pets.push(o); }
        else if (o.h > 7 && this.kind === 'ground') this.tall.push(o);
        this.addObject(o);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // One-off objects with their own mesh: planets, galaxies, countries, landmarks.
    for (const p of stage.nodes || []) {
      const o = this.makeObject(p, p.rf, p.rf, p.h ?? p.rf * 1.6, p.rf);
      o.node = p.node; o.s = p.s ?? 1; o.kind = 'body';
      p.node.matrixAutoUpdate = false;
      parent.add(p.node);
      if (p.boss) { o.boss = true; this.boss = o; }
      this.addObject(o);
    }

    for (const spec of stage.people || []) {
      const cast = spec.cast || stage.cast;
      let pool = cast ? characters.filter((c) => cast.includes(c.name)) : characters.filter((c) => !c.special);
      if (!pool.length) pool = characters;
      const ch = pool[Math.floor(rnd() * pool.length)];
      const node = cloneSkinned(ch.scene);
      this.root.add(node);
      node.matrixAutoUpdate = false;
      // Skinned meshes are the only per-object draw calls, so let the renderer cull them.
      let part = 0;
      node.traverse((m) => { if (m.isSkinnedMesh) { m.boundingSphere = ch.bounds[part++].clone(); m.frustumCulled = true; } });
      const mixer = new THREE.AnimationMixer(node);
      const o = this.makeObject({ x: spec.x, z: spec.z, y: 0.15, rot: 0 }, 0.45, 0.5, 1.8, 0.45);
      Object.assign(o, {
        kind: 'person', node, mixer, s: CHARACTER_SCALE, pts: 6, speed: 1.1 + rnd() * 0.7, tx: spec.x, tz: spec.z, fleeing: false,
        walk: mixer.clipAction(ch.clips.walk), run: mixer.clipAction(ch.clips.sprint), fall: mixer.clipAction(ch.clips.fall),
      });
      if (spec.loop) {
        const half = spec.loop.half + (rnd() - 0.5) * 0.7;
        o.loop = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [spec.loop.cx + a * half, spec.loop.cz + b * half]);
        o.dir = spec.loop.dir;
        const k = Math.floor(rnd() * 4), n = (k + o.dir + 4) % 4, t = rnd();
        o.x = o.loop[k][0] + (o.loop[n][0] - o.loop[k][0]) * t;
        o.z = o.loop[k][1] + (o.loop[n][1] - o.loop[k][1]) * t;
        o.corner = n; o.tx = o.loop[n][0]; o.tz = o.loop[n][1];
      } else {
        o.area = spec.wander;
      }
      o.walk.play();
      mixer.update(rnd() * 2);
      this.people.push(o);
      this.addObject(o);
    }

    // How much there is to eat decides how fast levels come.
    this.xpScale = stage.xp || 1;
    this.starveT = 3;

    // holes: slot 0 is the player (absent while the menu is showing)
    const names = BOT_NAMES.slice().sort(() => rnd() - 0.5);
    this.holes = [];
    for (let i = 0; i < MAX_HOLES; i++) {
      const h = new Hole(i, i === 0 ? (playerName || 'You') : names[i], COLORS[i], i === 0);
      h.wall.visible = this.kind !== 'space'; h.core.visible = this.kind === 'space';
      this.holes.push(h);
      parent.add(h.group);
    }
    this.player = this.holes[0];
    if (carry) { this.player.score = carry.score; this.player.eaten = carry.eaten; }
    for (const h of this.holes) {
      // later stages start with a couple of rivals that already have a head start
      if (!h.isPlayer && stageIndex > 0) h.xp = Math.floor(LEVEL_XP[Math.floor(rnd() * 3)] * this.xpScale);
      this.placeHole(h);
    }
    if (stage.start && playerName) { this.player.x = stage.start[0]; this.player.z = stage.start[1]; }
    if (!playerName) { this.player.alive = false; this.player.shown = 0; this.player.respawn = Infinity; }
    this.mode = playerName ? 'playing' : 'idle';
    this.focus.set(this.player.x, 0, this.player.z);
    this.orient();
    for (const h of this.holes) this.syncHole(h);
    this.syncUniforms();
  }

  makeObject(p, rf, hd, h, foot) {
    return {
      kind: 'static', mesh: null, idx: 0, node: null, x: p.x, y: p.y || 0, z: p.z, y0: p.y || 0, rot: p.rot || 0, q0: p.q0 || null,
      s: 1, sxz: 1, fs: 1, fit: 1, tilt: 0, tiltMax: 0, tax: 1, taz: 0, spin: 0, g: 30, rf, hd, h, foot,
      pts: p.pts ?? Math.max(1, Math.round(2.2 * Math.pow(rf, 1.3))), state: 0, vy: 0, hole: null, cell: -1,
      ghost: false, lean: 0, leanR: 0, leanFrame: -1, name: p.name || null, boss: false,
      turn: p.turn || 0, drift: p.drift || null, orbit: p.orbit || null, bob: p.bob || 0, phase: Math.random() * 6.28,
    };
  }

  addObject(o) {
    this.objects.push(o);
    if (o.name) this.named.push(o);
    if (o.turn || o.drift || o.orbit || o.bob) this.movers.push(o);
    this.insert(o); this.write(o);
  }

  placeHole(h) {
    let best = null, bestD = -Infinity;
    for (let k = 0; k < 16; k++) {
      let x, z;
      if (this.kind === 'globe') { x = (this.rnd() - 0.5) * this.wrapX; z = (this.rnd() - 0.5) * this.zMax * 1.5; }
      else if (this.stage.spawn) [x, z] = this.stage.spawn(this.rnd);
      else { x = (this.rnd() * 2 - 1) * this.bound * 0.9; z = (this.rnd() * 2 - 1) * this.bound * 0.9; }
      let d = 1e9;
      for (const o of this.holes) if (o !== h && o.alive) { this.sep(o.x, o.z, x, z); d = Math.min(d, Math.hypot(_dx, _dz) - o.r * 3); }
      if (d > bestD) { bestD = d; best = [x, z]; }
    }
    h.x = best[0]; h.z = best[1]; h.vx = h.vz = 0;
    this.setLevel(h); h.shown = 0; h.grow = 0; h.alive = true; h.ai.obj = h.ai.prey = null; h.ai.think = 0;
  }

  // ---- geometry of the stage ----------------------------------------------
  // Offset from a to b in local metres. On a globe x is longitude, so it wraps and shrinks with latitude.
  sep(ax, az, bx, bz) {
    _dx = bx - ax; _dz = bz - az;
    if (this.kind === 'globe') {
      if (_dx > this.wrapX / 2) _dx -= this.wrapX; else if (_dx < -this.wrapX / 2) _dx += this.wrapX;
      _dx *= Math.cos(((az + bz) * 0.5) / this.globeR);
    }
    this.dx = _dx; this.dz = _dz;      // also readable from outside (HUD)
  }

  move(o, dx, dz) {
    if (this.kind === 'globe') {
      o.x += dx / Math.max(0.2, Math.cos(o.z / this.globeR));
      if (o.x > this.wrapX / 2) o.x -= this.wrapX; else if (o.x < -this.wrapX / 2) o.x += this.wrapX;
      o.z = clamp(o.z + dz, -this.zMax, this.zMax);
    } else {
      o.x = clamp(o.x + dx, -this.bound, this.bound);
      o.z = clamp(o.z + dz, -this.bound, this.bound);
    }
  }

  // Surface frame on the globe: columns are east, up, south and the surface point.
  frame(x, z) {
    const R = this.globeR, lon = x / R, lat = -z / R;
    const cl = Math.cos(lat), sl = Math.sin(lat), co = Math.cos(lon), so = Math.sin(lon);
    return _f.set(
      co, cl * so, sl * so, cl * so * R,
      0, sl, -cl, sl * R,
      -so, cl * co, sl * co, cl * co * R,
      0, 0, 0, 1);
  }

  // Turn the globe so the player's spot is on top, at the world origin, with north up the screen.
  orient() {
    if (this.kind !== 'globe') return;
    const p = this.player;
    this.globe.quaternion.setFromRotationMatrix(this.frame(p.x, p.z)).invert();
    this.globe.updateMatrixWorld(true);
  }

  // World position of a point given in stage coordinates.
  worldOf(x, z, y, out) {
    if (this.kind !== 'globe') return out.set(x, y, z);
    const f = this.frame(x, z).elements, k = 1 + y / this.globeR;
    return out.set(f[12] * k, f[13] * k, f[14] * k).applyMatrix4(this.globe.matrixWorld);
  }

  // The mouse points at a spot in the world; turn that into stage coordinates.
  pointAt(wx, wz) {
    const inp = this.input, p = this.player;
    inp.point = true;
    if (this.kind === 'globe') { inp.tx = p.x + wx / Math.max(0.2, Math.cos(p.z / this.globeR)); inp.tz = p.z + wz; }
    else { inp.tx = wx; inp.tz = wz; }
  }

  // ---- spatial grid ------------------------------------------------------
  insert(o) { if (this.kind === 'globe') { o.cell = 0; return; } o.cell = cellOf(o.x) + cellOf(o.z) * CELLS; this.grid[o.cell].push(o); }
  remove(o) {
    if (o.cell < 0) return;
    if (this.kind !== 'globe') {
      const c = this.grid[o.cell], i = c.indexOf(o);
      if (i >= 0) { c[i] = c[c.length - 1]; c.pop(); }
    }
    o.cell = -1;
  }
  moved(o) {
    if (this.kind === 'globe') return;
    const c = cellOf(o.x) + cellOf(o.z) * CELLS;
    if (c !== o.cell) { this.remove(o); o.cell = c; this.grid[c].push(o); }
  }

  // Calls fn for every standing object that could be within `reach` of (x, z).
  near(x, z, reach, fn) {
    if (this.kind === 'globe') {
      const list = this.objects;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].cell === 0) fn(list[i]);
      return;
    }
    const x0 = cellOf(x - reach), x1 = cellOf(x + reach), z0 = cellOf(z - reach), z1 = cellOf(z + reach);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const cell = this.grid[cx + cz * CELLS];
      for (let i = cell.length - 1; i >= 0; i--) fn(cell[i]);
    }
  }

  write(o) {
    _q.setFromAxisAngle(UP, o.rot);
    if (o.q0) _q.premultiply(o.q0);
    if (o.tilt) _q.premultiply(_q2.setFromAxisAngle(_axis.set(o.tax, 0, o.taz), o.tilt));
    const gone = o.state === 2, k = gone ? 0 : o.s * o.sxz * o.fs, ky = gone ? 0 : o.s * o.fs;
    if (this.kind === 'globe') _m.compose(_p.set(0, o.y, 0), _q, _s.set(k, ky, k)).premultiply(this.frame(o.x, o.z));
    else _m.compose(_p.set(o.x, o.y, o.z), _q, _s.set(k, ky, k));
    if (o.node) { o.node.matrix.copy(_m); o.node.visible = !gone; }
    else { o.mesh.setMatrixAt(o.idx, _m); o.mesh.instanceMatrix.needsUpdate = true; }
  }

  syncHole(h) {
    const r = Math.max(h.shown, 0.001), g = h.group;
    g.visible = h.shown > 0.02;
    let rr = r, drop = 0;
    if (this.kind === 'globe') {
      const th = Math.min(1.45, r / this.globeR);
      rr = this.globeR * Math.sin(th); drop = this.globeR * (1 - Math.cos(th));
      g.matrixAutoUpdate = false; g.matrix.copy(this.frame(h.x, h.z));
    } else g.position.set(h.x, 0, h.z);
    if (this.kind === 'space') {
      h.core.scale.setScalar(r * 0.9);
      h.ring.position.y = 0;
    } else {
      h.wall.position.y = -drop;
      h.wall.scale.set(rr * 1.02, Math.max(10, r * 3 + 6), rr * 1.02);
      h.ring.position.y = 0.3 - drop;
    }
    h.ring.scale.set(rr, 1, rr);
    const u = h.ring.material.uniforms;
    u.uProgress.value = h.isPlayer ? this.progress(h) : 0;
    u.uFlash.value = h.flash;
    u.uOuter.value = 1.2 + 0.24 / r;      // keep the player's ring readable while the hole is still tiny
  }

  // ---- levels ------------------------------------------------------------
  xpFor(level) { return LEVEL_XP[level] * this.xpScale; }
  setLevel(h) {
    let i = 0;
    while (i < MAX_LEVEL && h.xp >= this.xpFor(i + 1)) i++;
    h.level = i; h.r = LEVEL_R[i];
  }
  // 0..1 towards the next level (or towards finishing the stage on the last one)
  progress(h) {
    if (h.level === MAX_LEVEL && this.boss) return 1;
    const a = this.xpFor(h.level), b = h.level < MAX_LEVEL ? this.xpFor(h.level + 1) : FINISH_XP * this.xpScale;
    return clamp((h.xp - a) / (b - a), 0, 1);
  }

  addScore(h, pts, o) {
    h.score += pts; h.xp += pts;
    if (pts > 0) h.eaten++;
    // Rivals may get ahead of the player, but only by a few levels: no runaway giants.
    if (!h.isPlayer && this.mode === 'playing') h.xp = Math.min(h.xp, this.xpFor(Math.min(MAX_LEVEL, this.player.level + 3)) + 1);
    const before = h.level;
    this.setLevel(h);
    if (h.level > before) { h.flash = 1; if (h.isPlayer) this.on.sizeUp(h); }
    if (!h.isPlayer || this.mode !== 'playing') return;
    if (this.boss) {
      if (o === this.boss) this.finishStage();
      else if (h.level === MAX_LEVEL && !this.bossTold) { this.bossTold = true; this.on.bossReady(this.boss); }
    } else if (h.xp >= FINISH_XP * this.xpScale) this.finishStage();
  }

  // If rivals have eaten so much that the player could no longer finish, make the rest count for more.
  starveCheck() {
    const p = this.player, lim = LEVEL_R[MAX_LEVEL] * FIT;
    let avail = 0;
    for (const o of this.objects) if (o.state === 0 && !o.boss && o.rf <= lim) avail += o.pts;
    const base = this.boss ? LEVEL_XP[MAX_LEVEL] : FINISH_XP;
    if (base * this.xpScale - p.xp > avail * 0.8) {
      this.xpScale = Math.max(0.02, (p.xp + avail * 0.8) / base);
      for (const h of this.holes) if (h.alive && !h.isPlayer) this.setLevel(h);
      this.addScore(p, 0, null);
    }
  }

  finishStage() {
    this.mode = 'transition'; this.endT = 0;
    this.on.stageDone(this.stageIndex);
  }

  // ---- traffic -----------------------------------------------------------
  laneEntry(n, d) { const v = DIRS[d]; return [nodePos(n[0]) - v[0] * 5 - v[1] * 1.5, nodePos(n[1]) - v[1] * 5 + v[0] * 1.5]; }
  laneExit(n, d) { const v = DIRS[d]; return [nodePos(n[0]) + v[0] * 5 - v[1] * 1.5, nodePos(n[1]) + v[1] * 5 + v[0] * 1.5]; }
  validDir(n, d) { const a = n[0] + DIRS[d][0], b = n[1] + DIRS[d][1]; return a >= 0 && b >= 0 && a < NODES && b < NODES; }

  setupCar(o, spec) {
    let d = spec.dir;
    while (!this.validDir(spec.node, d)) d = (d + 1) % 4;
    const next = [spec.node[0] + DIRS[d][0], spec.node[1] + DIRS[d][1]];
    const a = this.laneExit(spec.node, d), b = this.laneEntry(next, d);
    o.x = a[0] + (b[0] - a[0]) * spec.t; o.z = a[1] + (b[1] - a[1]) * spec.t;
    o.rot = Math.atan2(DIRS[d][0], DIRS[d][1]);
    o.kind = 'car';
    o.car = { dir: d, next, wp: b, entering: true, v: 0, cruise: (spec.speed || 6.5) + this.rnd() * 4, stuck: 0, ignore: 0 };
    this.cars.push(o);
  }

  updateCars(dt) {
    const cars = this.cars;
    for (const o of cars) {
      if (o.state !== 0) continue;
      const c = o.car;
      let dx = c.wp[0] - o.x, dz = c.wp[1] - o.z;
      const v = DIRS[c.dir];
      if (dx * dx + dz * dz < 1.5 || dx * v[0] + dz * v[1] < 0) {
        if (c.entering) {
          const opts = [];
          for (const [turn, w] of [[0, 3], [1, 1], [3, 1]]) {
            const d = (c.dir + turn) % 4;
            if (this.validDir(c.next, d)) for (let k = 0; k < w; k++) opts.push(d);
          }
          c.dir = opts[Math.floor(this.rnd() * opts.length)];
          c.wp = this.laneExit(c.next, c.dir);
        } else {
          c.next = [c.next[0] + DIRS[c.dir][0], c.next[1] + DIRS[c.dir][1]];
          c.wp = this.laneEntry(c.next, c.dir);
        }
        c.entering = !c.entering;
        dx = c.wp[0] - o.x; dz = c.wp[1] - o.z;
      }
      const diff = wrapAngle(Math.atan2(dx, dz) - o.rot);
      o.rot += clamp(diff, -2.8 * dt, 2.8 * dt);
      const fx = Math.sin(o.rot), fz = Math.cos(o.rot);
      let want = c.cruise * (Math.abs(diff) > 0.4 ? 0.55 : 1);
      if (c.ignore > 0) c.ignore -= dt;
      else {
        for (const b of cars) {
          if (b === o || b.state !== 0) continue;
          const bx = b.x - o.x, bz = b.z - o.z;
          const ahead = bx * fx + bz * fz;
          if (ahead > 0 && ahead < 9 && Math.abs(bx * fz - bz * fx) < 1.7) { want = ahead < 6 ? 0 : Math.min(want, 3); break; }
        }
      }
      c.v += clamp(want - c.v, -14 * dt, 6 * dt);
      if (c.v < 0.3) { c.stuck += dt; if (c.stuck > 3) { c.stuck = 0; c.ignore = 2.5; } } else c.stuck = 0;
      o.x += fx * c.v * dt; o.z += fz * c.v * dt;
      this.moved(o); this.write(o);
    }
  }

  // ---- animals and pedestrians -------------------------------------------
  // Returns true and leaves the escape direction in _dx/_dz when a hole is close.
  scared(o, margin) {
    let fx = 0, fz = 0, flee = false;
    for (const h of this.holes) {
      if (!h.alive) continue;
      const dx = o.x - h.x, dz = o.z - h.z, d = Math.hypot(dx, dz);
      if (d < h.r + margin) { flee = true; const w = 1 / Math.max(d, 0.1); fx += dx * w; fz += dz * w; }
    }
    _dx = fx; _dz = fz;
    return flee;
  }

  updatePets(dt) {
    const B = this.bound - 1;
    for (const o of this.pets) {
      if (o.state !== 0) continue;
      const flee = this.scared(o, 4.5);
      let fx = _dx, fz = _dz;
      if (!flee) {
        fx = o.tx - o.x; fz = o.tz - o.z;
        if (fx * fx + fz * fz < 0.2) {
          o.tx = o.area.cx + (this.rnd() * 2 - 1) * o.area.half; o.tz = o.area.cz + (this.rnd() * 2 - 1) * o.area.half;
          continue;
        }
      }
      const len = Math.hypot(fx, fz) || 1, speed = flee ? 3.3 : o.speed;
      o.rot += wrapAngle(Math.atan2(fx, fz) - o.rot) * Math.min(1, dt * 8);
      o.x = clamp(o.x + (fx / len) * speed * dt, -B, B);
      o.z = clamp(o.z + (fz / len) * speed * dt, -B, B);
      o.hop += dt * (flee ? 16 : 9);
      o.y = o.y0 + Math.abs(Math.sin(o.hop)) * 0.28;
      this.moved(o); this.write(o);
    }
  }

  updatePeople(dt) {
    const near = this.viewRadius * 1.6 + 30, B = this.bound - 1;
    for (const o of this.people) {
      if (o.state !== 0) continue;
      const flee = this.scared(o, 5.5);
      let fx = _dx, fz = _dz, speed = o.speed;
      if (flee) speed = 4.3;
      else {
        fx = o.tx - o.x; fz = o.tz - o.z;
        if (fx * fx + fz * fz < 0.25) {
          if (o.loop) { o.corner = (o.corner + o.dir + 4) % 4; o.tx = o.loop[o.corner][0]; o.tz = o.loop[o.corner][1]; }
          else { o.tx = o.area.cx + (this.rnd() * 2 - 1) * o.area.half; o.tz = o.area.cz + (this.rnd() * 2 - 1) * o.area.half; }
          fx = o.tx - o.x; fz = o.tz - o.z;
        }
      }
      if (flee !== o.fleeing) {
        o.fleeing = flee;
        const a = flee ? o.run : o.walk, b = flee ? o.walk : o.run;
        b.stop(); a.reset().play();
      }
      const len = Math.hypot(fx, fz) || 1;
      o.rot += wrapAngle(Math.atan2(fx, fz) - o.rot) * Math.min(1, dt * 9);
      o.x = clamp(o.x + (fx / len) * speed * dt, -B, B);
      o.z = clamp(o.z + (fz / len) * speed * dt, -B, B);
      this.moved(o); this.write(o);
      if (Math.abs(o.x - this.focus.x) < near && Math.abs(o.z - this.focus.z) < near) o.mixer.update(dt);
    }
  }

  // Planets orbit, rocks drift, everything in space turns slowly.
  updateMovers(dt) {
    const B = this.bound;
    for (const o of this.movers) {
      if (o.state !== 0) continue;
      if (o.orbit) { const b = o.orbit; b.a += b.w * dt; o.x = b.cx + Math.cos(b.a) * b.r; o.z = b.cz + Math.sin(b.a) * b.r; }
      else if (o.drift) {
        if (this.kind === 'globe') this.move(o, o.drift[0] * dt, o.drift[1] * dt);
        else {
          o.x += o.drift[0] * dt; o.z += o.drift[1] * dt;
          if (Math.abs(o.x) > B) { o.drift[0] *= -1; o.x = clamp(o.x, -B, B); }
          if (Math.abs(o.z) > B) { o.drift[1] *= -1; o.z = clamp(o.z, -B, B); }
        }
      }
      if (o.turn) o.rot += o.turn * dt;
      if (o.bob) o.y = o.y0 + Math.sin(this.clock * 0.9 + o.phase) * o.bob;
      this.moved(o); this.write(o);
    }
  }

  // ---- swallowing --------------------------------------------------------
  capture(h, o, free) {
    o.state = 1; o.hole = h; o.vy = 0;
    this.remove(o);
    this.sep(o.x, o.z, h.x, h.z);
    let dx = _dx, dz = _dz;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { const a = this.rnd() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= d; dz /= d; }
    if (this.kind === 'ground') {
      o.tax = dz; o.taz = -dx;
      // Tall things can only lean as far as the opening allows; small things tumble right over.
      o.tiltMax = Math.min(1.4, Math.atan2(h.r * 1.15, o.h)) * (0.7 + this.rnd() * 0.3);
      o.spin = 0.5;                              // tilt speed, builds up as it topples
      o.g = 17 + 20 / (1 + o.h * 0.25);          // heavy things fall a little slower
      o.fit = Math.min(1, (h.r * 0.96) / o.hd);
    }
    if (o.kind === 'person') { o.walk.stop(); o.run.stop(); o.fall.reset().play(); o.tiltMax *= 0.5; }
    else if (o.mesh && o.mesh.geometry.attributes.aFall) { o.mesh.geometry.attributes.aFall.setX(o.idx, 1); o.mesh.geometry.attributes.aFall.needsUpdate = true; }
    this.falling.push(o);
    if (free) return;
    this.addScore(h, o.pts, o);
    this.on.eat(h, o);
  }

  eatObjects(h) {
    const R = h.r, lim = R * FIT, ground = this.kind === 'ground';
    this.near(h.x, h.z, R * 2.4 + 1, (o) => {
      if (o.state !== 0 || this.mode === 'transition') return;
      const fits = o.rf <= lim && (!o.boss || (h.isPlayer && h.level === MAX_LEVEL));
      this.sep(h.x, h.z, o.x, o.z);
      const reach = R - o.rf * 0.4, dx = _dx, dz = _dz, d2 = dx * dx + dz * dz;
      if (fits && d2 < reach * reach) { this.capture(h, o); return; }
      // Hanging over the rim: it tips into the opening. Things that are too big to go down
      // sag in and get stuck there until the hole moves on.
      const edge = R + o.rf * 0.6;
      if (!ground || o.kind === 'person' || o.kind === 'pet' || d2 >= edge * edge) return;
      const d = Math.sqrt(d2) || 0.001;
      let lean = Math.min(1, (edge - d) / o.rf) * Math.min(0.42, Math.atan2(R, o.h) * 0.7);
      if (!fits) lean *= Math.pow(lim / o.rf, 1.5);
      if (lean < 0.01) return;
      if (o.leanFrame !== this.frameNo || lean > o.lean) {
        o.lean = lean; o.leanFrame = this.frameNo; o.leanR = Math.min(R, o.rf); o.tax = -dz / d; o.taz = dx / d;
        this.leaning.add(o);
      }
    });
  }

  updateLeaning(dt) {
    const k = 1 - Math.exp(-9 * dt);
    for (const o of this.leaning) {
      if (o.state !== 0) { this.leaning.delete(o); continue; }
      const want = o.leanFrame === this.frameNo ? o.lean : 0;
      o.tilt += (want - o.tilt) * k;
      o.y = o.y0 - o.tilt * o.leanR * 0.9;      // the low side dips below the rim
      if (want === 0 && o.tilt < 0.004) { o.tilt = 0; o.y = o.y0; this.leaning.delete(o); }
      this.write(o);
    }
  }

  updateFalling(dt) {
    const end = -(uniforms.uFade.value + 1), ground = this.kind === 'ground';
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const o = this.falling[i], h = o.hole;
      let done = false;
      if (ground) {
        if (h.alive && o.y > -o.h) {
          // Drift towards the middle, but never snap. While part of it still pokes out of the
          // ground it has to stay inside the opening, so a moving hole carries it along.
          let dx = o.x - h.x, dz = o.z - h.z;
          const k = Math.exp(-1.6 * dt), reach = Math.max(0, h.r - o.rf * 0.4), d = Math.hypot(dx, dz) * k;
          dx *= k; dz *= k;
          if (d > reach && d < h.r + 8) { dx *= reach / d; dz *= reach / d; }
          if (d < h.r + 8) { o.x = h.x + dx; o.z = h.z + dz; }
        }
        o.vy -= o.g * dt; o.y += o.vy * dt;
        o.spin += (2 + 7 / (1 + o.h * 0.2)) * dt;
        o.tilt = Math.min(o.tiltMax, o.tilt + o.spin * dt);
        // squeeze through the opening gradually as it sinks, not all at once
        const sink = clamp(-o.y / Math.max(1.5, o.h * 0.4), 0, 1);
        o.sxz = 1 + (o.fit - 1) * sink * sink * (3 - 2 * sink);
        done = o.y < end - o.h;
      } else {
        // No floor to fall through: spiral into the hole and shrink away.
        if (h.alive) {
          this.sep(h.x, h.z, o.x, o.z);
          const k = Math.exp(-3 * dt), c = Math.cos(3.5 * dt), s = Math.sin(3.5 * dt);
          const nx = (_dx * c - _dz * s) * k, nz = (_dx * s + _dz * c) * k;
          const m = this.kind === 'globe' ? Math.max(0.2, Math.cos(h.z / this.globeR)) : 1;
          o.x = h.x + nx / m; o.z = h.z + nz;
        }
        o.fs = Math.max(0, o.fs - dt * 1.15);
        o.rot += dt * 5;
        if (this.kind === 'globe') o.y -= dt * (o.h * 0.6 + 0.4);
        done = o.fs <= 0.02;
      }
      if (o.kind === 'person') o.mixer.update(dt);
      if (done) {
        o.state = 2;
        this.falling[i] = this.falling[this.falling.length - 1]; this.falling.pop();
      }
      this.write(o);
    }
  }

  eatHoles() {
    const hs = this.holes;
    for (const a of hs) {
      if (!a.alive) continue;
      for (const b of hs) {
        if (a === b || !b.alive || a.r < b.r * 1.12) continue;
        this.sep(a.x, a.z, b.x, b.z);
        if (Math.hypot(_dx, _dz) < a.r - b.r * 0.35) {
          const loot = Math.floor(b.xp * 0.4) + 10;
          b.alive = false; b.respawn = 4; b.xp = 0;
          this.on.swallow(a, b, loot);
          if (b.isPlayer) { if (this.mode === 'playing') { this.mode = 'lost'; this.on.lost(a); } return; }
          this.addScore(a, loot, null);
          if (this.mode === 'transition') return;
        }
      }
    }
  }

  // ---- bots --------------------------------------------------------------
  think(h) {
    const ai = h.ai, last = ai.obj;
    ai.obj = null; ai.prey = null;
    let fx = 0, fz = 0, flee = false, prey = null, preyD = 1e9;
    for (const o of this.holes) {
      if (o === h || !o.alive) continue;
      this.sep(o.x, o.z, h.x, h.z);
      const d = Math.hypot(_dx, _dz) || 0.01;
      if (o.r > h.r * 1.1) {
        const danger = o.r + h.r + 7;
        if (d < danger) { flee = true; const w = (danger - d) / danger / d; fx += _dx * w; fz += _dz * w; }
      } else if (h.r > o.r * 1.15 && d < 26 + h.r * 2 && d < preyD) { prey = o; preyD = d; }
    }
    if (flee) {
      const l = Math.hypot(fx, fz) || 1;
      ai.tx = h.x + (fx / l) * 40; ai.tz = h.z + (fz / l) * 40; ai.think = 0.3;
      return;
    }
    if (prey && this.rnd() < ai.aggro) { ai.prey = prey; ai.think = 0.8; return; }
    // Bots are easily distracted: now and then they just drift for a moment.
    if (this.rnd() < 0.3) { ai.idle = 0.6 + this.rnd() * 1.4; ai.think = ai.idle; return; }

    const R = 12 + h.r * 3, lim = h.r * FIT;
    let best = null, bestV = 0;
    this.near(h.x, h.z, R, (o) => {
      if (o.state !== 0 || o.rf > lim || o.boss || ai.skip.has(o)) return;
      this.sep(h.x, h.z, o.x, o.z);
      const d = Math.hypot(_dx, _dz);
      if (d > R) return;
      const v = (o.pts / Math.pow(d + 1.5 + h.r, 1.35)) * (0.75 + this.rnd() * 0.5);
      if (v > bestV) { bestV = v; best = o; }
    });
    if (best) { if (best !== last) ai.chase = 0; ai.obj = best; ai.think = 0.9 + this.rnd() * 0.8; return; }
    // nothing edible nearby: roam
    ai.tx = h.x + (this.rnd() * 2 - 1) * 90; ai.tz = h.z + (this.rnd() * 2 - 1) * 90;
    if (this.kind !== 'globe') { ai.tx = clamp(ai.tx, -this.bound, this.bound); ai.tz = clamp(ai.tz, -this.bound, this.bound); }
    ai.think = 1.5;
  }

  steer(h, dt) {
    const ai = h.ai;
    ai.think -= dt;
    if (ai.obj && ai.obj.state !== 0) { ai.obj = null; ai.think = 0; }
    if (ai.prey && (!ai.prey.alive || ai.prey.r * 1.12 > h.r)) { ai.prey = null; ai.think = 0; }
    if (ai.think <= 0) { ai.idle = 0; this.think(h); }
    if (ai.idle > 0) return [0, 0];
    if (ai.obj) {
      ai.tx = ai.obj.x; ai.tz = ai.obj.z;
      // give up on anything that refuses to be eaten (e.g. a pedestrian that keeps outrunning us)
      if ((ai.chase += dt) > 4) { ai.skip.add(ai.obj); ai.obj = null; ai.chase = 0; ai.think = 0; if (ai.skip.size > 40) ai.skip.clear(); }
    }
    if (ai.prey) { ai.tx = ai.prey.x; ai.tz = ai.prey.z; }
    this.sep(h.x, h.z, ai.tx, ai.tz);
    const d = Math.hypot(_dx, _dz);
    if (d < 0.4) { ai.think = 0; return [0, 0]; }
    return [(_dx / d) * ai.skill, (_dz / d) * ai.skill];
  }

  // ---- frame -------------------------------------------------------------
  update(dt) {
    this.frameNo++; this.clock += dt;
    if (this.mode === 'transition') this.collapse(dt);
    for (const h of this.holes) {
      const active = this.mode === 'playing' || this.mode === 'idle';
      if (!h.alive) {
        h.shown = Math.max(0, h.shown - dt * Math.max(4, h.shown * 6)); h.grow = 0;
        if (active && !h.isPlayer && (h.respawn -= dt) <= 0) { this.placeHole(h); this.on.respawn(h); }
        this.syncHole(h);
        continue;
      }
      // springy growth so a level-up visibly pops
      h.grow += ((h.r - h.shown) * 150 - h.grow * 13) * dt;
      h.shown = Math.max(0.05, h.shown + h.grow * dt);
      h.flash = Math.max(0, h.flash - dt * 2.2);
      if (active) {
        const sp = speedFor(h.r) * (this.stage.speed || 1);
        if (h.isPlayer && !this.autopilot) {
          // The player's hole answers the controls immediately: no easing.
          const inp = this.input;
          if (inp.point) {
            this.sep(h.x, h.z, inp.tx, inp.tz);
            const d = Math.hypot(_dx, _dz);
            // On a globe the view is locked to the hole, so distance from the cursor sets the speed.
            const step = this.kind === 'globe' ? sp * dt * Math.min(1, d / (h.r * 2.5 + 2)) : Math.min(sp * dt, d);
            h.vx = d > 1e-4 ? (_dx / d) * step / dt : 0; h.vz = d > 1e-4 ? (_dz / d) * step / dt : 0;
          } else { h.vx = inp.x * sp; h.vz = inp.z * sp; }
        } else {
          const [ix, iz] = this.steer(h, dt), k = 1 - Math.exp(-6 * dt);
          h.vx += (ix * sp - h.vx) * k; h.vz += (iz * sp - h.vz) * k;
        }
        this.move(h, h.vx * dt, h.vz * dt);
        this.eatObjects(h);
      }
      this.syncHole(h);
    }
    if (this.mode === 'playing' || this.mode === 'idle') this.eatHoles();
    if (this.mode === 'playing' && (this.starveT -= dt) <= 0) { this.starveT = 3; this.starveCheck(); }
    this.updateLeaning(dt);
    this.updateFalling(dt);
    if (this.cars.length) this.updateCars(dt);
    if (this.pets.length) this.updatePets(dt);
    if (this.people.length) this.updatePeople(dt);
    if (this.movers.length) this.updateMovers(dt);
    if (this.stage.update) this.stage.update(dt, this);
    this.orient();
    this.syncUniforms();
  }

  // End of a stage: the hole swells until it has swallowed everything that is left.
  collapse(dt) {
    const p = this.player;
    this.endT += dt;
    const limit = this.kind === 'globe' ? this.globeR * 1.45 : this.bound * 2.4;
    p.r = Math.min(limit, p.r * Math.exp(1.9 * dt) + dt * 6);
    const R = p.r;
    for (const o of this.objects) {
      if (o.state !== 0) continue;
      this.sep(p.x, p.z, o.x, o.z);
      if (_dx * _dx + _dz * _dz < R * R) this.capture(p, o, true);
    }
    for (const h of this.holes) {
      if (h.isPlayer || !h.alive) continue;
      this.sep(p.x, p.z, h.x, h.z);
      if (Math.hypot(_dx, _dz) < R) { h.alive = false; h.respawn = 1e9; }
    }
  }

  // Anything tall standing between the camera and the player's hole is drawn see-through.
  updateGhosts(cam) {
    if (!this.tall.length) return;
    const p = this.player, on = p.alive && this.mode === 'playing';
    const dx = cam.x - p.x, dz = cam.z - p.z, len2 = dx * dx + dz * dz || 1;
    for (const o of this.tall) {
      let g = false;
      if (on && o.state === 0) {
        const tu = ((o.x - p.x) * dx + (o.z - p.z) * dz) / len2, t = clamp(tu, 0, 1);
        const ex = p.x + dx * t - o.x, ez = p.z + dz * t - o.z, d2 = ex * ex + ez * ez;
        const rad = o.foot + p.r * 0.5 + 0.8;
        g = d2 < rad * rad && (tu > 0.02 ? o.h > t * cam.y * 0.7 : d2 < o.foot * o.foot * 0.8);
      }
      if (g === o.ghost) continue;
      o.ghost = g;
      if (o.state !== 0) continue;
      const attr = o.mesh.geometry.attributes.aFall;
      attr.setX(o.idx, g ? 2 : 0); attr.needsUpdate = true;
    }
  }

  syncUniforms() {
    const p = this.player, flat = this.kind === 'ground', globe = this.kind === 'globe';
    for (const h of this.holes) {
      const open = h.shown > 0.02 ? h.shown : 0;
      uniforms.uHoles.value[h.index].set(h.x, h.z, flat ? open : 0);
      const d = uniforms.uHoleDirs.value[h.index];
      if (globe && open) {
        const f = this.frame(h.x, h.z).elements;
        _p.set(f[4], f[5], f[6]).applyQuaternion(this.globe.quaternion);
        d.set(_p.x, _p.y, _p.z, Math.cos(Math.min(1.45, open / this.globeR)));
      } else d.set(0, 1, 0, 2);
    }
    uniforms.uGlobeC.value.set(0, -this.globeR, 0);
    uniforms.uPlayer.value.set(p.x, 0, p.z);
    uniforms.uReveal.value = flat && p.alive && this.mode === 'playing' ? p.shown * 1.1 + 1.8 : 0;
  }

  ranking() { return this.holes.filter((h) => (h.isPlayer ? this.mode !== 'idle' : true)).sort((a, b) => b.xp - a.xp); }
}

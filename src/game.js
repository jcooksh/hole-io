// Simulation: holes, things that fall into them, bots, traffic and pedestrians.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { uniforms, MAX_HOLES, CHARACTER_SCALE, makeGroundMaterial } from './assets.js';
import { generateCity, NODES, BOUND, nodePos } from './city.js';

export const ROUND_TIME = 120;

const CELL = 10, ORIGIN = -200, CELLS = 40;
const FIT = 0.92;          // an object fits when its size <= radius * FIT
const GRAVITY = 45;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const COLORS = [0x2f9bff, 0xff5a5f, 0xffb400, 0x69d84f, 0xb86bff, 0xff7ad9, 0x18c9c0, 0xff8a3d];
const BOT_NAMES = ['Munchy', 'Pothole Pete', 'Abyss', 'Nom Nom', 'Sinker', 'Gobbler', 'Crater Kate', 'Deep Dan',
  'Gulpzilla', 'Manhole Max', 'Void Vera', 'Big Dipper', 'Chomp', 'Drainpipe', 'Lil Pit', 'Sir Swallow'];

// Holes grow in steps. LEVEL_R[i] is the radius at level i + 1, LEVEL_AT[i] the score that unlocks it.
export const LEVEL_R = [1, 1.4, 1.9, 2.5, 3.2, 4, 5, 6.2, 7.6, 9.2, 11, 13, 15.5, 18, 21];
export const LEVEL_AT = [0, 12, 30, 60, 100, 160, 240, 340, 480, 760, 1250, 2000, 3000, 4200, 5600];
export function levelFor(score) {
  let i = 0;
  while (i + 1 < LEVEL_AT.length && score >= LEVEL_AT[i + 1]) i++;
  return i;
}
const speedFor = (r) => 9 + 1.4 * r;
const cellOf = (v) => Math.max(0, Math.min(CELLS - 1, Math.floor((v - ORIGIN) / CELL)));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

let wallGeo, ringGeo, ringGeoPlayer, wallMat;
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
}

// Ring around a hole. For the player it doubles as the level progress bar:
// it fills clockwise from the top, and flashes white on a level-up.
function ringMaterial(color, fill) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uFill: { value: new THREE.Color(fill) },
      uProgress: { value: 0 }, uFlash: { value: 0 }, uOuter: { value: 2 },
    },
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
    this.score = 0; this.level = 0; this.r = LEVEL_R[0]; this.shown = this.r; this.grow = 0; this.flash = 0;
    this.alive = true; this.respawn = 0; this.eaten = 0;
    this.ai = { think: Math.random() * 0.5, tx: 0, tz: 0, obj: null, prey: null, chase: 0, skip: new Set(), skill: 0.72 + Math.random() * 0.2, aggro: 0.3 + Math.random() * 0.6 };
    this.group = new THREE.Group();
    this.wall = new THREE.Mesh(wallGeo, wallMat);
    this.ring = new THREE.Mesh(isPlayer ? ringGeoPlayer : ringGeo, ringMaterial(color, isPlayer ? 0xffd21f : color));
    this.ring.position.y = 0.24;
    this.group.add(this.wall, this.ring);
  }
  // 0..1 towards the next level
  get progress() {
    const i = this.level;
    return i + 1 >= LEVEL_AT.length ? 1 : Math.max(0, (this.score - LEVEL_AT[i]) / (LEVEL_AT[i + 1] - LEVEL_AT[i]));
  }
  setLevel() { this.level = levelFor(this.score); this.r = LEVEL_R[this.level]; }
  sync() {
    const r = Math.max(this.shown, 0.001);
    this.group.visible = this.shown > 0.02;
    this.group.position.set(this.x, 0, this.z);
    this.wall.scale.set(r * 1.02, Math.max(10, r * 3 + 6), r * 1.02);
    this.ring.scale.set(r, 1, r);
    this.ring.material.uniforms.uProgress.value = this.isPlayer ? this.progress : 0;
    this.ring.material.uniforms.uFlash.value = this.flash;
    // keep the player's ring readable while the hole is still tiny
    this.ring.material.uniforms.uOuter.value = 1.2 + 0.24 / r;
  }
}

function instancedGeometry(base, count, withFall) {
  const g = new THREE.BufferGeometry();
  for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
  g.boundingBox = base.boundingBox; g.boundingSphere = base.boundingSphere;
  if (withFall) g.setAttribute('aFall', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
  return g;
}

export class Game {
  constructor(scene, assets) {
    this.scene = scene; this.assets = assets;
    this.on = { eat() {}, swallow() {}, sizeUp() {}, over() {}, respawn() {} };
    this.root = null; this.holes = []; this.objects = []; this.falling = []; this.people = []; this.cars = [];
    this.grid = []; this.mode = 'idle'; this.time = ROUND_TIME; this.player = null;
    this.input = { x: 0, z: 0, point: false, tx: 0, tz: 0 };
    this.focus = new THREE.Vector3(); this.viewRadius = 80;
    // The lawn tiles and the land around the city share one colour (the kit's grass, toned down a little).
    const grass = assets.models['nature/ground_grass'].geometry.attributes.color;
    const tint = assets.materials.nature.ground.color.setRGB(0.8, 0.74, 0.44);
    this.base = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      makeGroundMaterial({ color: new THREE.Color(grass.getX(0), grass.getY(0), grass.getZ(0)).multiply(tint) }));
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
    for (const h of this.holes) h.ring.material.dispose();
    this.root = null;
  }

  build(seed, playerName) {
    this.dispose();
    const { models, characters } = this.assets;
    const city = generateCity(seed);
    const rnd = this.rnd = city.rnd;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.objects = []; this.falling = []; this.people = []; this.cars = []; this.tall = [];
    this.grid = Array.from({ length: CELLS * CELLS }, () => []);

    const byModel = (list) => {
      const map = new Map();
      for (const p of list) { if (!map.has(p.model)) map.set(p.model, []); map.get(p.model).push(p); }
      return map;
    };

    for (const [name, list] of byModel(city.ground)) {
      const model = models[name];
      const mesh = new THREE.InstancedMesh(instancedGeometry(model.geometry, list.length, false), model.material, list.length);
      list.forEach((p, i) => {
        _q.setFromAxisAngle(UP, p.rot);
        mesh.setMatrixAt(i, _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(1, 1, 1)));
      });
      mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.root.add(mesh);
    }

    // Moving cars share the instanced meshes with parked ones.
    const traffic = city.traffic.map((t) => ({ model: t.model, x: 0, z: 0, rot: 0, y: 0.1, s: 1, car: t }));
    for (const [name, list] of byModel(city.props.concat(traffic))) {
      const model = models[name];
      const mesh = new THREE.InstancedMesh(instancedGeometry(model.geometry, list.length, true), model.material, list.length);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.root.add(mesh);
      list.forEach((p, idx) => {
        const s = p.s || 1;
        const rf = Math.max(0.3, model.footprint * s + 0.03 * model.height * s);
        const o = {
          kind: p.car ? 'car' : 'static', mesh, idx, x: p.x, y: p.y || 0, z: p.z, rot: p.rot, s, sxz: 1, fit: 1,
          tilt: 0, tiltMax: 0, tax: 1, taz: 0, rf, hd: model.halfDiag * s, h: model.height * s,
          pts: Math.max(1, Math.round(2 * Math.pow(rf, 1.8))), state: 0, vy: 0, hole: null, cell: -1,
          foot: model.footprint * s, ghost: false,
        };
        if (p.car) this.setupCar(o, p.car);
        else if (o.h > 7) this.tall.push(o);
        this.objects.push(o); this.insert(o); this.write(o);
      });
    }

    for (const spec of city.people) {
      const ch = characters[Math.floor(rnd() * characters.length)];
      const mesh = cloneSkinned(ch.scene);
      mesh.scale.setScalar(CHARACTER_SCALE);
      this.root.add(mesh);
      // Skinned meshes are the only per-object draw calls, so let the renderer cull them.
      let part = 0;
      mesh.traverse((m) => { if (m.isSkinnedMesh) { m.boundingSphere = ch.bounds[part++].clone(); m.frustumCulled = true; } });
      const mixer = new THREE.AnimationMixer(mesh);
      const o = {
        kind: 'person', mesh, mixer, x: spec.x, y: 0.15, z: spec.z, rot: 0, s: 1, sxz: 1, fit: 1, tilt: 0, tiltMax: 0,
        tax: 1, taz: 0, rf: 0.45, hd: 0.5, h: 1.8, pts: 2, state: 0, vy: 0, hole: null, cell: -1,
        speed: 1.1 + rnd() * 0.7, tx: spec.x, tz: spec.z, wait: 0, fleeing: false,
        walk: mixer.clipAction(ch.clips.walk), run: mixer.clipAction(ch.clips.sprint), fall: mixer.clipAction(ch.clips.fall),
      };
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
      this.objects.push(o); this.people.push(o); this.insert(o); this.write(o);
    }

    // holes: slot 0 is the player (absent while the menu is showing)
    const names = BOT_NAMES.slice().sort(() => rnd() - 0.5);
    this.holes = [];
    for (let i = 0; i < MAX_HOLES; i++) {
      const h = new Hole(i, i === 0 ? (playerName || 'You') : names[i], COLORS[i], i === 0);
      this.holes.push(h);
      this.root.add(h.group);
    }
    this.player = this.holes[0];
    for (const h of this.holes) this.placeHole(h);
    if (!playerName) { this.player.alive = false; this.player.shown = 0; this.player.respawn = Infinity; }
    this.mode = playerName ? 'playing' : 'idle';
    this.time = ROUND_TIME;
    this.focus.set(this.player.x, 0, this.player.z);
    this.syncUniforms();
  }

  placeHole(h) {
    let best = null, bestD = -1;
    for (let k = 0; k < 14; k++) {
      const x = nodePos(Math.floor(this.rnd() * NODES)), z = nodePos(Math.floor(this.rnd() * NODES));
      let d = 1e9;
      for (const o of this.holes) if (o !== h && o.alive) d = Math.min(d, Math.hypot(o.x - x, o.z - z) - o.r * 3);
      if (d > bestD) { bestD = d; best = [x, z]; }
    }
    h.x = best[0]; h.z = best[1]; h.vx = h.vz = 0;
    h.setLevel(); h.shown = 0; h.grow = 0; h.alive = true; h.ai.obj = h.ai.prey = null; h.ai.think = 0;
  }

  // ---- spatial grid ------------------------------------------------------
  insert(o) { o.cell = cellOf(o.x) + cellOf(o.z) * CELLS; this.grid[o.cell].push(o); }
  remove(o) {
    if (o.cell < 0) return;
    const c = this.grid[o.cell], i = c.indexOf(o);
    if (i >= 0) { c[i] = c[c.length - 1]; c.pop(); }
    o.cell = -1;
  }
  moved(o) {
    const c = cellOf(o.x) + cellOf(o.z) * CELLS;
    if (c !== o.cell) { this.remove(o); o.cell = c; this.grid[c].push(o); }
  }

  write(o) {
    _q.setFromAxisAngle(UP, o.rot);
    if (o.tilt) _q.premultiply(_q2.setFromAxisAngle(_axis.set(o.tax, 0, o.taz), o.tilt));
    const k = o.state === 2 ? 0 : o.s * o.sxz;
    if (o.kind === 'person') {
      o.mesh.position.set(o.x, o.y, o.z);
      o.mesh.quaternion.copy(_q);
      o.mesh.scale.setScalar(CHARACTER_SCALE * k);
      o.mesh.visible = o.state !== 2;
    } else {
      o.mesh.setMatrixAt(o.idx, _m.compose(_p.set(o.x, o.y, o.z), _q, _s.set(k, o.state === 2 ? 0 : o.s, k)));
      o.mesh.instanceMatrix.needsUpdate = true;
    }
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
    o.car = { dir: d, next, wp: b, entering: true, v: 0, cruise: 6.5 + this.rnd() * 4, stuck: 0, ignore: 0 };
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
      o.rot += Math.max(-2.8 * dt, Math.min(2.8 * dt, diff));
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
      c.v += Math.max(-14 * dt, Math.min(6 * dt, want - c.v));
      if (c.v < 0.3) { c.stuck += dt; if (c.stuck > 3) { c.stuck = 0; c.ignore = 2.5; } } else c.stuck = 0;
      o.x += fx * c.v * dt; o.z += fz * c.v * dt;
      this.moved(o); this.write(o);
    }
  }

  // ---- pedestrians -------------------------------------------------------
  updatePeople(dt) {
    const holes = this.holes;
    const near = this.viewRadius * 1.6 + 30;
    for (const o of this.people) {
      if (o.state !== 0) continue;
      let fx = 0, fz = 0, flee = false;
      for (const h of holes) {
        if (!h.alive) continue;
        const dx = o.x - h.x, dz = o.z - h.z, d = Math.hypot(dx, dz);
        if (d < h.r + 5.5) { flee = true; const w = 1 / Math.max(d, 0.1); fx += dx * w; fz += dz * w; }
      }
      let speed = o.speed;
      if (flee) { speed = 3.9; }
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
      const want = Math.atan2(fx, fz);
      o.rot += wrapAngle(want - o.rot) * Math.min(1, dt * 9);
      o.x = Math.max(1 - BOUND, Math.min(BOUND - 1, o.x + (fx / len) * speed * dt));
      o.z = Math.max(1 - BOUND, Math.min(BOUND - 1, o.z + (fz / len) * speed * dt));
      this.moved(o); this.write(o);
      if (Math.abs(o.x - this.focus.x) < near && Math.abs(o.z - this.focus.z) < near) o.mixer.update(dt);
    }
  }

  // ---- swallowing --------------------------------------------------------
  capture(h, o) {
    o.state = 1; o.hole = h; o.vy = 0;
    this.remove(o);
    let dx = h.x - o.x, dz = h.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { const a = this.rnd() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= d; dz /= d; }
    o.tax = dz; o.taz = -dx;
    o.tiltMax = Math.min(1.25, Math.atan2(h.r, o.h)) * (0.55 + this.rnd() * 0.45);
    o.fit = Math.min(1, (h.r * 0.96) / o.hd);
    if (o.kind === 'person') { o.walk.stop(); o.run.stop(); o.fall.reset().play(); o.tiltMax *= 0.5; }
    else { o.mesh.geometry.attributes.aFall.setX(o.idx, 1); o.mesh.geometry.attributes.aFall.needsUpdate = true; }
    this.falling.push(o);
    this.addScore(h, o.pts);
    this.on.eat(h, o);
  }

  addScore(h, pts) {
    h.score += pts; h.eaten++;
    const before = h.level;
    h.setLevel();
    if (h.level > before) { h.flash = 1; if (h.isPlayer) this.on.sizeUp(h); }
  }

  eatObjects(h) {
    const R = h.r, lim = R * FIT;
    const x0 = cellOf(h.x - R), x1 = cellOf(h.x + R), z0 = cellOf(h.z - R), z1 = cellOf(h.z + R);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const cell = this.grid[cx + cz * CELLS];
      for (let i = cell.length - 1; i >= 0; i--) {
        const o = cell[i];
        if (o.rf > lim) continue;
        const reach = R - o.rf * 0.4, dx = o.x - h.x, dz = o.z - h.z;
        if (dx * dx + dz * dz < reach * reach) this.capture(h, o);
      }
    }
  }

  updateFalling(dt) {
    const end = -(uniforms.uFade.value + 1);
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const o = this.falling[i], h = o.hole;
      if (h.alive && Math.abs(h.x - o.x) < h.r + 6 && Math.abs(h.z - o.z) < h.r + 6) {
        const k = 1 - Math.exp(-5 * dt);
        o.x += (h.x - o.x) * k; o.z += (h.z - o.z) * k;
      }
      o.vy -= GRAVITY * dt; o.y += o.vy * dt;
      o.tilt = Math.min(o.tiltMax, o.tilt + dt * 2.4);
      o.sxz += (o.fit - o.sxz) * (1 - Math.exp(-9 * dt));
      if (o.kind === 'person') o.mixer.update(dt);
      if (o.y < end - o.h) {
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
        if (Math.hypot(a.x - b.x, a.z - b.z) < a.r - b.r * 0.35) {
          const loot = Math.floor(b.score * 0.4);
          b.score -= loot; b.alive = false; b.respawn = 3;
          this.addScore(a, loot + 10);
          this.on.swallow(a, b, loot + 10);
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
      const dx = h.x - o.x, dz = h.z - o.z, d = Math.hypot(dx, dz) || 0.01;
      if (o.r > h.r * 1.1) {
        const danger = o.r + h.r + 13;
        if (d < danger) { flee = true; const w = (danger - d) / danger / d; fx += dx * w; fz += dz * w; }
      } else if (h.r > o.r * 1.15 && d < 26 + h.r * 2 && d < preyD) { prey = o; preyD = d; }
    }
    if (flee) {
      const l = Math.hypot(fx, fz) || 1;
      ai.tx = h.x + (fx / l) * 40; ai.tz = h.z + (fz / l) * 40; ai.think = 0.3;
      return;
    }
    if (prey && this.rnd() < ai.aggro) { ai.prey = prey; ai.think = 0.5; return; }

    const R = 24 + h.r * 4, lim = h.r * FIT;
    const x0 = cellOf(h.x - R), x1 = cellOf(h.x + R), z0 = cellOf(h.z - R), z1 = cellOf(h.z + R);
    let best = null, bestV = 0;
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      for (const o of this.grid[cx + cz * CELLS]) {
        if (o.rf > lim || ai.skip.has(o)) continue;
        const d = Math.hypot(o.x - h.x, o.z - h.z);
        if (d > R) continue;
        const v = (o.pts / Math.pow(d + 1.5 + h.r, 1.35)) * (0.75 + this.rnd() * 0.5);
        if (v > bestV) { bestV = v; best = o; }
      }
    }
    if (best) { if (best !== last) ai.chase = 0; ai.obj = best; ai.think = 0.45 + this.rnd() * 0.3; return; }
    // nothing edible nearby: roam
    ai.tx = Math.max(-BOUND, Math.min(BOUND, h.x + (this.rnd() * 2 - 1) * 90));
    ai.tz = Math.max(-BOUND, Math.min(BOUND, h.z + (this.rnd() * 2 - 1) * 90));
    ai.think = 1.5;
  }

  steer(h, dt) {
    const ai = h.ai;
    ai.think -= dt;
    if (ai.obj && ai.obj.state !== 0) { ai.obj = null; ai.think = 0; }
    if (ai.prey && (!ai.prey.alive || ai.prey.r * 1.12 > h.r)) { ai.prey = null; ai.think = 0; }
    if (ai.think <= 0) this.think(h);
    if (ai.obj) {
      ai.tx = ai.obj.x; ai.tz = ai.obj.z;
      // give up on anything that refuses to be eaten (e.g. a pedestrian that keeps outrunning us)
      if ((ai.chase += dt) > 4) { ai.skip.add(ai.obj); ai.obj = null; ai.chase = 0; ai.think = 0; if (ai.skip.size > 40) ai.skip.clear(); }
    }
    if (ai.prey) { ai.tx = ai.prey.x; ai.tz = ai.prey.z; }
    const dx = ai.tx - h.x, dz = ai.tz - h.z, d = Math.hypot(dx, dz);
    if (d < 0.4) { ai.think = 0; return [0, 0]; }
    return [(dx / d) * ai.skill, (dz / d) * ai.skill];
  }

  // ---- frame -------------------------------------------------------------
  update(dt) {
    if (this.mode === 'playing') {
      this.time -= dt;
      if (this.time <= 0) { this.time = 0; this.mode = 'over'; this.on.over(); }
    }
    const active = this.mode !== 'over';
    for (const h of this.holes) {
      if (!h.alive) {
        h.shown = Math.max(0, h.shown - dt * Math.max(4, h.shown * 6)); h.grow = 0;
        if (active && (h.respawn -= dt) <= 0) { this.placeHole(h); this.on.respawn(h); }
        h.sync();
        continue;
      }
      // springy growth so a level-up visibly pops
      h.grow += ((h.r - h.shown) * 150 - h.grow * 13) * dt;
      h.shown = Math.max(0.05, h.shown + h.grow * dt);
      h.flash = Math.max(0, h.flash - dt * 2.2);
      if (active) {
        const sp = speedFor(h.r);
        if (h.isPlayer && !this.autopilot) {
          // The player's hole answers the controls immediately: no easing.
          const inp = this.input;
          if (inp.point) {
            const dx = inp.tx - h.x, dz = inp.tz - h.z, d = Math.hypot(dx, dz);
            const step = Math.min(sp * dt, d);
            h.vx = d > 1e-4 ? (dx / d) * step / dt : 0; h.vz = d > 1e-4 ? (dz / d) * step / dt : 0;
          } else { h.vx = inp.x * sp; h.vz = inp.z * sp; }
        } else {
          const [ix, iz] = this.steer(h, dt), k = 1 - Math.exp(-6 * dt);
          h.vx += (ix * sp - h.vx) * k; h.vz += (iz * sp - h.vz) * k;
        }
        h.x = Math.max(-BOUND, Math.min(BOUND, h.x + h.vx * dt));
        h.z = Math.max(-BOUND, Math.min(BOUND, h.z + h.vz * dt));
        this.eatObjects(h);
      }
      h.sync();
    }
    if (active) this.eatHoles();
    this.updateFalling(dt);
    this.updateCars(dt);
    this.updatePeople(dt);
    this.syncUniforms();
  }

  // Anything tall standing between the camera and the player's hole is drawn see-through.
  updateGhosts(cam) {
    const p = this.player, on = p.alive && this.mode !== 'idle';
    const dx = cam.x - p.x, dz = cam.z - p.z, len2 = dx * dx + dz * dz || 1;
    for (const o of this.tall) {
      let g = false;
      if (on && o.state === 0) {
        const tu = ((o.x - p.x) * dx + (o.z - p.z) * dz) / len2, t = Math.max(0, Math.min(1, tu));
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
    for (const h of this.holes) uniforms.uHoles.value[h.index].set(h.x, h.z, h.shown > 0.02 ? h.shown : 0);
    const p = this.player;
    uniforms.uPlayer.value.set(p.x, 0, p.z);
    uniforms.uReveal.value = p.alive && this.mode !== 'idle' ? p.shown * 1.1 + 1.8 : 0;
  }

  ranking() { return this.holes.filter((h) => h.isPlayer ? this.mode !== 'idle' : true).sort((a, b) => b.score - a.score); }
}

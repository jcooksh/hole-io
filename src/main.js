import * as THREE from 'three';
import { createAssets } from './assets.js';
import { Game } from './game.js';
import { STAGES, prepareStage, buildStage } from './stages.js';
import { THEMES } from './maps.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const stick = $('stick');
const stickKnob = stick.firstElementChild;
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- renderer --------------------------------------------------------------
const touchFirst = matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !touchFirst, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, touchFirst ? 1 : 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const SKY = 0x9fd8ff;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 300, 900);
const hemi = new THREE.HemisphereLight(0xffffff, 0x8a94a6, 1.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.1);
const SUN_DIR = new THREE.Vector3(0.55, 1, 0.38).normalize();
sun.castShadow = true;
sun.shadow.mapSize.setScalar(touchFirst ? 1024 : 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.35;
scene.add(sun, sun.target);

const camera = new THREE.PerspectiveCamera(42, 1, 1, 4000);
const PITCH = 1.02;
const aim = camera.clone();
let camR = 1, shadowExtent = 0, menuAngle = 0.6;
let viewWidth = 0, viewHeight = 0;

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h || (w === viewWidth && h === viewHeight)) return;
  viewWidth = w; viewHeight = h;
  renderer.setSize(w, h, false);
  camera.aspect = aim.aspect = w / h;
  camera.updateProjectionMatrix();
  aim.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

// ---- state -----------------------------------------------------------------
const sound = new Sound();
const assets = createAssets();
let game = null;
// one playthrough: which map, which stage, when it started
const run = { name: 'You', theme: THEMES[0], stage: 0, startedAt: 0, busy: false };
let shadowsOK = true;
const input = { pointer: null, stick: null, keys: new Set(), useKeys: false };

// ---- HUD -------------------------------------------------------------------
const labels = [];
const popPool = [];
const _v = new THREE.Vector3();

// Screen position of a point given in stage coordinates (works on the flat stages and on the globe).
function toScreen(x, y, z) {
  game.worldOf(x, z, y, _v);
  let ok = true;
  // on a globe, anything on the far side is hidden
  if (game.kind === 'globe') ok = (_v.x - 0) * (camera.position.x - _v.x) + (_v.y + game.globeR) * (camera.position.y - _v.y) + _v.z * (camera.position.z - _v.z) > 0;
  _v.project(camera);
  return [(_v.x * 0.5 + 0.5) * viewWidth, (-_v.y * 0.5 + 0.5) * viewHeight, ok && _v.z < 1];
}

function makeLabels() {
  $('labels').textContent = '';
  labels.length = 0;
  for (const h of game.holes) {
    const el = document.createElement('div');
    el.className = h.isPlayer ? 'label me' : 'label';
    el.style.setProperty('--c', hex(h.color));
    el.innerHTML = `<i></i>${esc(h.name)} <b></b>`;
    el.dataset.lv = '';
    $('labels').appendChild(el);
    labels.push(el);
  }
}

function updateLabels() {
  game.holes.forEach((h, i) => {
    const el = labels[i];
    const [x, y, ok] = toScreen(h.x, 0.3, h.z - h.shown * (h.isPlayer ? 1.35 : 1.15));
    const show = h.alive && ok && h.shown > 0.3 && x > -80 && y > -40 && x < viewWidth + 80 && y < viewHeight + 40;
    el.style.display = show ? '' : 'none';
    if (el.dataset.lv !== String(h.level)) { el.dataset.lv = h.level; el.lastElementChild.textContent = h.level + 1; }
    const crown = h === leader ? '\u{1F451}' : '';
    if (el.firstElementChild.textContent !== crown) el.firstElementChild.textContent = crown;
    if (show) el.style.transform = `translate(${x.toFixed(1)}px, ${(y - 8).toFixed(1)}px) translate(-50%, -100%)`;
  });
}

// Name tags for notable things nearby (countries, planets, landmarks ...).
const tags = [];
let tagTimer = 0, tagged = [];
function updateTags(dt) {
  const box = $('tags');
  if (!game.named.length || game.mode === 'idle') { if (tagged.length) { tagged = []; for (const t of tags) t.style.display = 'none'; } return; }
  tagTimer -= dt;
  if (tagTimer <= 0) {
    tagTimer = 0.25;
    const p = game.player, reach = game.viewRadius * 1.1 + 6;
    tagged = [];
    for (const o of game.named) {
      if (o.state !== 0) continue;
      game.sep(p.x, p.z, o.x, o.z);
      const d = Math.hypot(game.dx, game.dz) - o.rf;
      if (d < reach) tagged.push([d - o.rf * 2, o]);
    }
    tagged.sort((a, b) => a[0] - b[0]);
    tagged = tagged.slice(0, 7).map((t) => t[1]);
  }
  const lim = game.player.r * 0.92;
  for (let i = 0; i < 7; i++) {
    let el = tags[i];
    if (!el) { el = tags[i] = document.createElement('div'); el.className = 'nametag'; box.appendChild(el); }
    const o = tagged[i];
    if (!o || o.state !== 0) { el.style.display = 'none'; continue; }
    const [x, y, ok] = toScreen(o.x, Math.min(o.h, 3) + 0.5, o.z);
    if (!ok || x < -60 || y < -20 || x > viewWidth + 60 || y > viewHeight + 20) { el.style.display = 'none'; continue; }
    el.style.display = '';
    if (el.textContent !== o.name) el.textContent = o.name;
    el.classList.toggle('big', o.rf > lim || (o.boss && game.player.level < 11));
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
  }
}

function popup(text, x, y, z, big) {
  if ($('popups').childElementCount > 16) return;
  const [sx, sy, ok] = toScreen(x, y, z);
  if (!ok) return;
  const el = popPool.pop() || document.createElement('div');
  el.className = big ? 'pop big' : 'pop';
  el.textContent = text;
  el.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) translate(-50%, -50%)`;
  $('popups').appendChild(el);
  el.onanimationend = () => { el.remove(); popPool.push(el); };
}

function banner(text, hold) {
  const el = $('banner');
  el.textContent = text;
  el.className = '';
  void el.offsetWidth;
  el.className = hold ? 'hold' : 'show';
}

function feed(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  $('feed').appendChild(el);
  while ($('feed').childElementCount > 4) $('feed').firstChild.remove();
  setTimeout(() => el.remove(), 4000);
}

let boardTimer = 0, lastScore = -1, leader = null;
function updateHud(dt) {
  if (game.player.score !== lastScore) {
    lastScore = game.player.score;
    $('meScore').textContent = lastScore;
    $('meLevel').textContent = `Level ${game.player.level + 1}`;
    $('meBar').style.width = `${Math.round(game.progress(game.player) * 100)}%`;
  }
  boardTimer -= dt;
  if (boardTimer > 0) return;
  boardTimer = 0.25;
  const rank = game.ranking();
  const me = rank.indexOf(game.player);
  leader = rank[0].xp > 0 ? rank[0] : null;
  $('meRank').textContent = `#${me + 1}`;
  const rows = rank.slice(0, 5);
  if (me >= 5) rows[4] = game.player;
  $('board').innerHTML = rows.map((h) => `<li class="${h.isPlayer ? 'me' : ''}${h.alive ? '' : ' dead'}" style="--c:${hex(h.color)}"><i></i><span>${rank.indexOf(h) + 1}. ${h === leader ? '\u{1F451} ' : ''}${esc(h.name)}</span><b>Lv ${h.level + 1}</b></li>`).join('');
}

// ---- game events -----------------------------------------------------------
function bind() {
  game.on.eat = (h, o) => {
    if (!h.isPlayer) return;
    const big = o.pts >= 20 || !!o.name;
    popup(o.name ? `+${o.pts} ${o.name}` : `+${o.pts}`, o.x, Math.min(o.h, 4) + 1.5, o.z, big);
    const rate = Math.max(0.45, Math.min(1.7, 1.55 - o.rf * 0.13)) * (0.94 + Math.random() * 0.12);
    if (big) { sound.play('drop_004', { rate: rate * 0.9, gain: 1 }); shake = Math.min(1, shake + 0.35 + o.rf * 0.04); }
    else sound.play(o.rf < 0.8 ? 'drop_001' : o.rf < 2 ? 'drop_002' : 'drop_003', { rate, gain: 0.75, gap: 0.035 });
  };
  game.on.sizeUp = (h) => { banner(`Level ${h.level + 1}!`); sound.play('confirmation_002', { gain: 0.8 }); boardTimer = 0; };
  game.on.bossReady = (boss) => { setTimeout(() => banner(`Big enough. Swallow ${boss.name}!`), 1400); };
  game.on.swallow = (a, b, gain) => {
    feed(`<b style="--c:${hex(a.color)}">${esc(a.name)}</b> swallowed <b style="--c:${hex(b.color)}">${esc(b.name)}</b>`);
    if (b.isPlayer) { sound.play('error_006'); shake = 1; }
    else if (a.isPlayer) { banner(`You swallowed ${b.name}!`); sound.play('confirmation_004'); shake = 0.8; popup(`+${gain}`, b.x, 2, b.z, true); }
  };
  // Swallowed by a bigger hole: that is the end of the run.
  game.on.lost = (by) => {
    clearStick();
    banner(`Swallowed by ${by.name}!`, true);
    showEnd('Swallowed!', `${by.name} ate you in stage ${run.stage + 1}, ${game.stage.name}.`);
  };
  // The stage is finished: let the hole swallow what is left, then move up a scale.
  game.on.stageDone = (index) => {
    clearStick();
    banner(game.stage.done, true);
    sound.play('confirmation_004');
    shake = 1;
    setTimeout(() => nextStage(index + 1), 2500);
  };
}

function showEnd(title, sub) {
  const p = game.player, secs = Math.round((performance.now() - run.startedAt) / 1000);
  $('endTitle').textContent = title;
  $('endSub').textContent = sub;
  $('results').innerHTML = [
    ['Stage reached', `${run.stage + 1} of ${STAGES.length} · ${game.stage.name}`],
    ['Level', p.level + 1], ['Things swallowed', p.eaten], ['Points', p.score],
    ['Time', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
  ].map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');
  setTimeout(() => { $('end').hidden = false; $('again').focus({ preventScroll: true }); }, 1100);
}

// Sky, fog and light for the stage that was just built.
function applySky() {
  const sky = game.stage.sky || {};
  scene.background = sky.bg || new THREE.Color(sky.color ?? SKY);
  scene.backgroundIntensity = sky.bgIntensity ?? 1;
  scene.fog = sky.fog ? new THREE.Fog(sky.color ?? SKY, sky.fog[0], sky.fog[1]) : null;
  hemi.intensity = sky.hemi ?? 1.75;
  sun.intensity = sky.sun ?? 2.1;
  sun.castShadow = shadowsOK && game.kind === 'ground';
  document.querySelector('meta[name="theme-color"]').content = hex(sky.color ?? SKY);
}

function enterStage(index, playerName, carry) {
  run.stage = index;
  game.build(buildStage(assets, index, { theme: run.theme }, (Math.random() * 2 ** 31) | 0), index, playerName, carry);
  applySky();
  makeLabels();
  tagged = []; tagTimer = 0;
  $('popups').textContent = ''; $('feed').textContent = '';
  camR = game.player.r; boardTimer = 0; shake = 0; lastScore = -1;
  clearStick(); input.keys.clear(); input.useKeys = false;
  $('stageNo').textContent = `Stage ${index + 1} / ${STAGES.length}`;
  $('stageName').textContent = game.stage.name;
  updateCamera(0);
  // fetch the next world in the background so the hand-over is instant
  if (playerName && index + 1 < STAGES.length) prepareStage(assets, index + 1, { theme: run.theme }).catch(() => {});
}

async function nextStage(index) {
  if (index >= STAGES.length) {
    showEnd('You ate everything', 'City, planet, galaxy, universe, and whatever was outside that. Nothing is left.');
    return;
  }
  const fade = $('fade');
  fade.classList.add('on');
  const carry = { score: game.player.score, eaten: game.player.eaten };
  try {
    await Promise.all([prepareStage(assets, index, { theme: run.theme }), new Promise((r) => setTimeout(r, 450))]);
    enterStage(index, run.name, carry);
    banner(`Stage ${index + 1}: ${game.stage.name}`);
    sound.play('maximize_008');
  } catch (err) {
    console.error(err);
    showEnd('Could not load the next stage', 'Check your connection and try again.');
  }
  fade.classList.remove('on');
}

async function start(playerName) {
  if (run.busy) return;
  run.busy = true;
  run.name = playerName; run.startedAt = performance.now();
  $('end').hidden = true;
  try {
    await prepareStage(assets, 0, { theme: run.theme });
    enterStage(0, playerName, null);
    $('menu').hidden = true;
    $('hud').hidden = false;
    banner('Go!'); sound.play('maximize_008');
  } catch (err) { console.error(err); }
  run.busy = false;
}

// ---- input -----------------------------------------------------------------
const KEYS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
const STICK_RADIUS = 40, STICK_DEAD_ZONE = 4;

function clearStick() {
  const st = input.stick;
  if (!st) return;
  input.stick = null;
  stick.hidden = true;
  if (canvas.hasPointerCapture(st.id)) canvas.releasePointerCapture(st.id);
}

function cancelInput() {
  clearStick();
  input.keys.clear();
  input.pointer = null;
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (KEYS[e.code]) { input.keys.add(e.code); input.useKeys = true; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => input.keys.delete(e.code));
window.addEventListener('blur', cancelInput);
window.addEventListener('pagehide', cancelInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelInput(); });
screen.orientation?.addEventListener('change', clearStick);
matchMedia('(orientation: portrait)').addEventListener('change', clearStick);

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || e.button !== 0 || game?.mode !== 'playing' || input.stick) return;
  canvas.setPointerCapture(e.pointerId);
  input.pointer = null;
  input.useKeys = false;
  input.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
  stick.style.left = `${e.clientX}px`; stick.style.top = `${e.clientY}px`;
  stickKnob.style.transform = '';
  stick.hidden = false;
});
window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && !input.stick) { input.pointer = [e.clientX, e.clientY]; input.useKeys = false; }
});
canvas.addEventListener('pointermove', (e) => {
  const st = input.stick;
  if (!st || st.id !== e.pointerId) return;
  const dx = e.clientX - st.ox, dy = e.clientY - st.oy;
  const distance = Math.hypot(dx, dy);
  const travelScale = Math.min(STICK_RADIUS, distance) / (distance || 1);
  const strength = THREE.MathUtils.clamp((distance - STICK_DEAD_ZONE) / (STICK_RADIUS - STICK_DEAD_ZONE), 0, 1);
  const inputScale = strength / (distance || 1);
  st.x = dx * inputScale; st.y = dy * inputScale;
  stickKnob.style.transform = `translate(${dx * travelScale}px, ${dy * travelScale}px)`;
});
const endTouch = (e) => {
  if (input.stick?.id === e.pointerId) clearStick();
};
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);
canvas.addEventListener('lostpointercapture', endTouch);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const raycaster = new THREE.Raycaster(), _ndc = new THREE.Vector2();
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function readInput() {
  let x = 0, z = 0;
  if (input.stick) {
    x = input.stick.x; z = input.stick.y;
  } else if (input.useKeys && input.keys.size) {
    for (const k of input.keys) { x += KEYS[k][0]; z += KEYS[k][1]; }
    const l = Math.hypot(x, z) || 1; x /= l; z /= l;
  } else if (input.pointer && !input.useKeys) {
    // Mouse: the hole heads straight for the spot on the ground under the cursor.
    _ndc.set((input.pointer[0] / viewWidth) * 2 - 1, 1 - (input.pointer[1] / viewHeight) * 2);
    raycaster.setFromCamera(_ndc, aim);
    if (raycaster.ray.intersectPlane(GROUND, _v)) { game.pointAt(_v.x, _v.z); return; }
  }
  game.input.point = false;
  game.input.x = x; game.input.z = z;
}

// ---- camera + light --------------------------------------------------------
let shake = 0;
function updateCamera(dt) {
  const f = game.focus;
  if (game.mode === 'idle') {
    menuAngle += dt * 0.07;
    f.set(0, 0, 0);
    camera.position.set(Math.sin(menuAngle) * 210, 135, Math.cos(menuAngle) * 210);
    camera.lookAt(0, 0, 0);
    aim.position.copy(camera.position); aim.lookAt(0, 0, 0); aim.updateMatrixWorld();
    game.viewRadius = 170;
  } else {
    const p = game.player;
    if (game.kind === 'globe') f.set(0, 0, 0);        // the planet turns under the hole instead
    else {
      // With the mouse the hole sits under the cursor and the view drifts after it; with keys or
      // touch the view stays glued to the hole.
      const k = 1 - Math.exp(-(!p.alive ? 2.5 : game.input.point ? 3.2 : 10) * dt);
      f.x += (p.x - f.x) * k; f.z += (p.z - f.z) * k;
    }
    camR += (p.r - camR) * (1 - Math.exp(-(game.mode === 'transition' ? 2.4 : 1.1) * dt));
    const portrait = Math.max(1, Math.min(1.9, 1.15 / camera.aspect));
    const dist = (20 + camR * 6) * portrait;
    shake = Math.max(0, shake - dt * 2.5);
    const s = shake * shake * (0.25 + camR * 0.12);
    aim.position.set(f.x, Math.sin(PITCH) * dist, f.z + Math.cos(PITCH) * dist);
    aim.lookAt(f.x, 0, f.z);
    aim.updateMatrixWorld();
    camera.position.set(aim.position.x + (Math.random() - 0.5) * s, aim.position.y, aim.position.z + (Math.random() - 0.5) * s);
    camera.lookAt(f.x, 0, f.z);
    game.viewRadius = dist * 0.8;
  }
  // keep the shadow frustum tight around what the camera sees
  const extent = Math.min(260, Math.max(40, game.viewRadius * 1.35));
  if (Math.abs(extent - shadowExtent) > shadowExtent * 0.08) {
    shadowExtent = extent;
    const c = sun.shadow.camera;
    c.left = -extent; c.right = extent; c.top = extent; c.bottom = -extent; c.near = 10; c.far = 700;
    c.updateProjectionMatrix();
  }
  sun.target.position.set(f.x, 0, f.z);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 350);
}

// ---- main loop -------------------------------------------------------------
let last = performance.now(), slow = 0, fastFrames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(raw, 0.1);
  if (!game) return;
  if (game.mode !== 'idle') readInput();
  game.update(dt);
  updateCamera(dt);
  game.updateGhosts(camera.position);
  renderer.render(scene, camera);
  updateLabels();
  updateTags(dt);
  if (game.mode !== 'idle') updateHud(dt);

  // If the device cannot keep up, drop resolution first and soft shadows second.
  if (raw > 0.026) slow += raw; else if (++fastFrames > 120) { slow = 0; fastFrames = 0; }
  if (slow > 1.5) {
    slow = 0; fastFrames = 0;
    if (pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.5); renderer.setPixelRatio(pixelRatio); }
    else if (sun.shadow.mapSize.x > 1024) { sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    else if (shadowsOK) { shadowsOK = false; sun.castShadow = false; }
  }
}
requestAnimationFrame(frame);

// ---- boot ------------------------------------------------------------------
try { const n = localStorage.getItem('gulp-name'); if (n) $('name').value = n; } catch { /* private mode */ }
const syncMute = () => { $('mute').textContent = sound.muted ? 'Sound off' : 'Sound on'; };
syncMute();
$('mute').addEventListener('click', () => { sound.setMuted(!sound.muted); syncMute(); });

// Mobile keyboards can shrink the visible viewport without resizing the page.
const viewport = window.visualViewport;
const menu = $('menu');
const nameField = $('name');
function fitNameForm() {
  if (!menu.hidden && viewport.scale === 1 && viewport.height < canvas.clientHeight - 1) {
    menu.style.top = `${viewport.offsetTop}px`;
    menu.style.height = `${viewport.height}px`;
    if (document.activeElement === nameField) nameField.scrollIntoView({ block: 'nearest' });
  } else {
    menu.style.top = '';
    menu.style.height = '';
  }
}
if (viewport) {
  viewport.addEventListener('resize', fitNameForm);
  viewport.addEventListener('scroll', fitNameForm);
}

function play() {
  sound.unlock();
  document.activeElement?.blur();   // otherwise WASD would keep typing into the name field
  const name = nameField.value.trim().slice(0, 14) || 'You';
  try { localStorage.setItem('gulp-name', name); } catch { /* private mode */ }
  start(name);
}
$('startForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!$('play').disabled) play();
});
$('again').addEventListener('click', play);

const showProgress = (p) => { $('progress').firstElementChild.style.width = `${Math.round(p * 100)}%`; };

// Map picker. Choosing a map loads it and shows it behind the menu, bots already at work.
try { const id = localStorage.getItem('gulp-map'); run.theme = THEMES.find((t) => t.id === id) || THEMES[0]; } catch { /* private mode */ }
let loadToken = 0;
async function showMap(theme) {
  const token = ++loadToken;
  run.theme = theme;
  try { localStorage.setItem('gulp-map', theme.id); } catch { /* private mode */ }
  $('play').disabled = true; $('play').textContent = 'Loading…';
  $('progress').classList.remove('done'); showProgress(0);
  try {
    await prepareStage(assets, 0, { theme }, showProgress);
    if (token !== loadToken) return;          // a different map was picked meanwhile
    if (!game) { game = new Game(scene, assets); bind(); game.renderer = renderer; game.camera = camera; window.__game = game; window.__stage = nextStage; }
    enterStage(0, null, null);
    $('play').disabled = false; $('play').textContent = 'Play';
  } catch (err) {
    console.error(err);
    if (token === loadToken) $('play').textContent = 'Could not load';
  }
  if (token === loadToken) $('progress').classList.add('done');
}
for (const theme of THEMES) {
  const label = document.createElement('label');
  label.innerHTML = `<input type="radio" name="map" value="${theme.id}"><span><b>${theme.name}</b><small>${theme.blurb}</small></span>`;
  const radio = label.firstElementChild;
  radio.checked = theme === run.theme;
  radio.addEventListener('change', () => { if (radio.checked) showMap(theme); });
  $('maps').appendChild(label);
}
showMap(run.theme);

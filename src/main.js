import * as THREE from 'three';
import { loadAssets } from './assets.js';
import { Game } from './game.js';
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
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a94a6, 1.75));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.1);
const SUN_DIR = new THREE.Vector3(0.55, 1, 0.38).normalize();
sun.castShadow = true;
sun.shadow.mapSize.setScalar(touchFirst ? 1024 : 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.35;
scene.add(sun, sun.target);

const camera = new THREE.PerspectiveCamera(42, 1, 1, 1600);
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
let game = null;
const input = { pointer: null, stick: null, keys: new Set(), useKeys: false };

// ---- HUD -------------------------------------------------------------------
const labels = [];
const popPool = [];
const _v = new THREE.Vector3();

function toScreen(x, y, z) {
  _v.set(x, y, z).project(camera);
  return [(_v.x * 0.5 + 0.5) * viewWidth, (-_v.y * 0.5 + 0.5) * viewHeight, _v.z < 1];
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

let boardTimer = 0, lastSecond = -1, lastScore = -1, leader = null;
function updateHud(dt) {
  const t = Math.ceil(game.time);
  if (t !== lastSecond) {
    lastSecond = t;
    $('timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    $('timer').classList.toggle('low', t <= 10 && game.mode === 'playing');
    if (t <= 5 && t > 0 && game.mode === 'playing') sound.play('click_001', { rate: 1.5, gain: 0.7 });
  }
  if (game.player.score !== lastScore) {
    lastScore = game.player.score;
    $('meScore').textContent = lastScore;
    $('meLevel').textContent = `Level ${game.player.level + 1}`;
    $('meBar').style.width = `${Math.round(game.player.progress * 100)}%`;
  }
  boardTimer -= dt;
  if (boardTimer > 0) return;
  boardTimer = 0.25;
  const rank = game.ranking();
  const me = rank.indexOf(game.player);
  leader = rank[0].score > 0 ? rank[0] : null;
  $('meRank').textContent = `#${me + 1}`;
  const rows = rank.slice(0, 5);
  if (me >= 5) rows[4] = game.player;
  $('board').innerHTML = rows.map((h) => `<li class="${h.isPlayer ? 'me' : ''}${h.alive ? '' : ' dead'}" style="--c:${hex(h.color)}"><i></i><span>${rank.indexOf(h) + 1}. ${h === leader ? '\u{1F451} ' : ''}${esc(h.name)}</span><b>${h.score}</b></li>`).join('');
}

// ---- game events -----------------------------------------------------------
function bind() {
  game.on.eat = (h, o) => {
    if (!h.isPlayer) return;
    const big = o.pts >= 20;
    popup(`+${o.pts}`, o.x, Math.min(o.h, 4) + 1.5, o.z, big);
    const rate = Math.max(0.45, Math.min(1.7, 1.55 - o.rf * 0.13)) * (0.94 + Math.random() * 0.12);
    if (big) { sound.play('drop_004', { rate: rate * 0.9, gain: 1 }); shake = Math.min(1, shake + 0.35 + o.rf * 0.04); }
    else sound.play(o.rf < 0.8 ? 'drop_001' : o.rf < 2 ? 'drop_002' : 'drop_003', { rate, gain: 0.75, gap: 0.035 });
  };
  game.on.sizeUp = (h) => { banner(`Level ${h.level + 1}!`); sound.play('confirmation_002', { gain: 0.8 }); boardTimer = 0; };
  game.on.swallow = (a, b, gain) => {
    feed(`<b style="--c:${hex(a.color)}">${esc(a.name)}</b> swallowed <b style="--c:${hex(b.color)}">${esc(b.name)}</b>`);
    if (b.isPlayer) { banner(`Swallowed by ${a.name}!`, true); sound.play('error_006'); shake = 1; }
    else if (a.isPlayer) { banner(`You swallowed ${b.name}!`); sound.play('confirmation_004'); shake = 0.8; popup(`+${gain}`, b.x, 2, b.z, true); }
  };
  game.on.respawn = (h) => { if (h.isPlayer) { banner('Back in!'); sound.play('maximize_008'); } };
  game.on.over = () => {
    clearStick();
    const rank = game.ranking(), place = rank.indexOf(game.player) + 1;
    $('endTitle').textContent = place === 1 ? 'You win!' : 'Time!';
    $('endSub').textContent = place === 1
      ? `Biggest hole in town with ${game.player.score} points.`
      : `You finished #${place} with ${game.player.score} points.`;
    $('results').innerHTML = rank.map((h, i) => `<li class="${h.isPlayer ? 'me' : ''}" style="--c:${hex(h.color)}"><em>${i + 1}</em><i></i><span>${esc(h.name)}</span><b>${h.score}</b></li>`).join('');
    sound.play(place === 1 ? 'confirmation_004' : 'select_005');
    $('timer').classList.remove('low');
    setTimeout(() => { $('end').hidden = false; $('again').focus({ preventScroll: true }); }, 900);
  };
}

function start(playerName) {
  game.build((Math.random() * 2 ** 31) | 0, playerName);
  makeLabels();
  $('popups').textContent = ''; $('feed').textContent = '';
  camR = game.player.r; lastSecond = -1; boardTimer = 0; shake = 0;
  clearStick(); input.keys.clear(); input.useKeys = false; lastScore = -1;
  $('menu').hidden = true; $('end').hidden = true;
  $('hud').hidden = !playerName;
  updateCamera(0);
  if (playerName) { banner('Go!'); sound.play('maximize_008'); }
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
    if (raycaster.ray.intersectPlane(GROUND, _v)) { game.input.point = true; game.input.tx = _v.x; game.input.tz = _v.z; return; }
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
    game.viewRadius = 170;
  } else {
    const p = game.player;
    // With the mouse the hole sits under the cursor and the view drifts after it; with keys or
    // touch the view stays glued to the hole.
    const k = 1 - Math.exp(-(!p.alive ? 2.5 : game.input.point ? 3.2 : 10) * dt);
    f.x += (p.x - f.x) * k; f.z += (p.z - f.z) * k;
    camR += (p.r - camR) * (1 - Math.exp(-1.1 * dt));
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
  if (game.mode !== 'idle') updateHud(dt);

  // If the device cannot keep up, drop resolution first and soft shadows second.
  if (raw > 0.026) slow += raw; else if (++fastFrames > 120) { slow = 0; fastFrames = 0; }
  if (slow > 1.5) {
    slow = 0; fastFrames = 0;
    if (pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.5); renderer.setPixelRatio(pixelRatio); }
    else if (sun.shadow.mapSize.x > 1024) { sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    else if (sun.castShadow) sun.castShadow = false;
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

loadAssets((p) => { $('progress').firstElementChild.style.width = `${Math.round(p * 100)}%`; })
  .then((assets) => {
    game = new Game(scene, assets);
    bind();
    game.build((Math.random() * 2 ** 31) | 0, null);
    makeLabels();
    $('progress').classList.add('done');
    $('play').disabled = false;
    $('play').textContent = 'Play';
    game.renderer = renderer; game.camera = camera;
    window.__game = game;
  })
  .catch((err) => {
    console.error(err);
    $('play').textContent = 'Could not load';
    $('progress').classList.add('done');
  });

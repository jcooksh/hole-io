// The worlds the hole eats its way through, smallest to largest. Each stage has a `prepare`
// step that downloads what it needs and a `build` step that lays the world out for game.js.
import * as THREE from 'three';
import { generateCity, BOUND, NODES, nodePos, mulberry32 } from './city.js';
import { loadPack, loadTexture, compose, makeGlobeMaterial, ASSET_URL } from './assets.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const helpers = (rnd) => ({
  pick: (arr) => arr[Math.floor(rnd() * arr.length)],
  range: (a, b) => a + rnd() * (b - a),
  chance: (p) => rnd() < p,
  spin: () => rnd() * TAU,
});

// Drops things at random spots that are not already taken. `list` collects { x, z, r }.
function scatterer(rnd, bound, taken = []) {
  return (r, tries = 40) => {
    for (let t = 0; t < tries; t++) {
      const x = (rnd() * 2 - 1) * bound, z = (rnd() * 2 - 1) * bound;
      if (taken.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + r)) { taken.push({ x, z, r }); return [x, z]; }
    }
    return null;
  };
}

// ---- 1. city ---------------------------------------------------------------
const city = {
  id: 'city', name: 'City', done: 'City devoured',
  async prepare(assets, opts, onProgress) { await loadPack(assets, opts.theme?.pack || 'city', onProgress); },
  build(assets, opts, seed) {
    const c = generateCity(seed, opts.theme);
    // The lawn tiles and the land around the city share one colour (the kit's grass, toned down a little).
    const grass = assets.models['nature/ground_grass'].geometry.attributes.color;
    const tint = assets.materials.nature.ground.color.setRGB(0.8, 0.74, 0.44);
    return {
      kind: 'ground', rnd: c.rnd, bound: BOUND, xp: 0.9,
      ground: c.ground, props: c.props, people: c.people, traffic: c.traffic,
      baseColor: new THREE.Color(grass.getX(0), grass.getY(0), grass.getZ(0)).multiply(tint),
      spawn: (rnd) => [nodePos(Math.floor(rnd() * NODES)), nodePos(Math.floor(rnd() * NODES))],
      sky: { color: 0x9fd8ff, fog: [300, 900] },
    };
  },
};

// ---- 2. countryside: whole towns are single bites ----------------------------
const K = 0.035;     // one unit is roughly 30 m here
const LOW = 'abcdefghijklm'.split('').map((c) => `commercial/low-detail-building-${c}`);
const HOUSES = 'abcdefghijklmnopqrstu'.split('').map((c) => `suburban/building-type-${c}`);
const TREES = ['nature/tree_oak', 'nature/tree_default', 'nature/tree_detailed', 'nature/tree_fat', 'nature/tree_pineRoundA', 'nature/tree_tall'];

function composeRegion(assets) {
  if (assets.models['region/giga']) return;
  const rnd = mulberry32(20241), { pick, range, chance, spin } = helpers(rnd);
  // A skyline: a grid of simple blocks, taller towards the middle, with a couple of avenues cut through.
  const skyline = (name, n, peak) => {
    const parts = [], half = (n - 1) / 2;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const d = Math.hypot(i - half, j - half) / (half + 0.5);
      if (d > 1.02 || chance(0.14) || i === Math.round(half) || j === Math.round(half * 0.5)) continue;
      parts.push({ model: pick(LOW), x: (i - half) * 11 + range(-1.5, 1.5), z: (j - half) * 11 + range(-1.5, 1.5), rot: Math.floor(rnd() * 4) * Math.PI / 2, s: 1.6, sy: 0.35 + peak * Math.exp(-d * d * 3.2) * range(0.6, 1.2) });
    }
    compose(assets, name, parts, K);
  };
  for (let v = 0; v < 3; v++) skyline(`region/town-${v}`, 8, 0.7);
  for (let v = 0; v < 2; v++) skyline(`region/city-${v}`, 16, 1.3);
  skyline('region/metro', 28, 1.9);
  skyline('region/mega', 44, 2.5);
  skyline('region/giga', 56, 3.2);
  const ring = (name, count, radius, extra) => {
    const parts = [];
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU + range(-0.2, 0.2), r = radius * (k % 2 ? 1 : 0.55) + range(-2, 2);
      parts.push({ model: pick(HOUSES), x: Math.cos(a) * r, z: Math.sin(a) * r, rot: Math.atan2(Math.cos(a), Math.sin(a)) });
    }
    for (let k = 0; k < extra; k++) { const a = spin(), r = range(0, radius + 8); parts.push({ model: pick(['suburban/tree-large', 'suburban/tree-small']), x: Math.cos(a) * r, z: Math.sin(a) * r, s: range(1, 1.5) }); }
    compose(assets, name, parts, K);
  };
  for (let v = 0; v < 3; v++) ring(`region/hamlet-${v}`, 3, 13, 3);
  for (let v = 0; v < 3; v++) ring(`region/village-${v}`, 7, 26, 6);
  const wood = (name, count, radius) => {
    const parts = [];
    for (let k = 0; k < count; k++) { const a = spin(), r = Math.sqrt(rnd()) * radius; parts.push({ model: pick(TREES), x: Math.cos(a) * r, z: Math.sin(a) * r, rot: spin(), s: range(1.8, 3) }); }
    compose(assets, name, parts, K);
  };
  for (let v = 0; v < 2; v++) wood(`region/grove-${v}`, 6, 8);
  for (let v = 0; v < 2; v++) wood(`region/forest-${v}`, 22, 30);
  wood('region/woods', 60, 75);
  for (let v = 0; v < 2; v++) {
    compose(assets, `region/works-${v}`, [
      { model: pick(['industrial/building-l', 'industrial/building-q']), x: 0, z: -12 },
      { model: pick(['industrial/building-e', 'industrial/building-f']), x: -18, z: 10, rot: Math.PI / 2 },
      { model: 'industrial/chimney-large', x: 14, z: 12 }, { model: 'industrial/detail-tank-large', x: 30, z: -8 },
      { model: 'industrial/water-tower', x: -30, z: -12 }, { model: 'industrial/shipping-container-a', x: 4, z: 22 },
      { model: 'industrial/shipping-container-c', x: 9, z: 22 }, { model: 'industrial/chimney-medium', x: 20, z: -20 },
    ], K);
    compose(assets, `region/farm-${v}`, [
      { model: 'industrial/windmill', x: 0, z: 0, rot: spin() }, { model: 'industrial/solar-panel-landscape-group', x: 14, z: 6 },
      { model: 'industrial/detail-tank', x: -12, z: 8, rot: spin() }, { model: 'industrial/shipping-container-b', x: 6, z: -12, rot: spin() },
    ], K);
  }
}

const region = {
  id: 'region', name: 'Countryside', done: 'Every town for miles is gone',
  async prepare(assets, opts, onProgress) {
    await Promise.all([loadPack(assets, 'city'), loadPack(assets, 'region', onProgress)]);
    composeRegion(assets);
  },
  build(assets, opts, seed) {
    const rnd = mulberry32(seed), { pick, range, spin } = helpers(rnd);
    const bound = 118, props = [], ground = [], taken = [], place = scatterer(rnd, bound - 4, taken);
    const models = assets.models;
    // a loose net of highways so the land does not look empty
    const lines = [-78, -26, 26, 78].map((v) => v + range(-8, 8));
    for (const v of lines) for (let k = -bound - 30; k <= bound + 30; k += 3) {
      ground.push({ model: 'roads/road-straight', x: k, z: v, rot: 0, y: 0.01, s: 0.3 });
      ground.push({ model: 'roads/road-straight', x: v, z: k, rot: Math.PI / 2, y: 0.012, s: 0.3 });
    }
    // model, how many, optional target size (the model is scaled to hit it)
    const add = (names, count, rfMin, rfMax) => {
      for (let k = 0; k < count; k++) {
        const name = pick(names), m = models[name];
        const base = m.footprint + 0.03 * m.height;
        const s = rfMin ? range(rfMin, rfMax) / base : 1;
        const at = place(Math.max(0.5, base * s * 1.15));
        if (at) props.push({ model: name, x: at[0], z: at[1], rot: spin(), s });
      }
    };
    // big things first so they find room
    add(['region/giga'], 2); add(['region/mega'], 3); add(['nature/rock_tallA', 'nature/rock_tallB'], 4, 8.5, 11);
    add(['region/metro'], 6); add(['nature/rock_tallA', 'nature/rock_tallB', 'nature/rock_largeB'], 14, 3.4, 7.5);
    add(['region/woods'], 12); add(['region/city-0', 'region/city-1'], 16);
    add(['region/works-0', 'region/works-1'], 20); add(['nature/rock_tallC', 'nature/rock_tallD', 'nature/rock_largeC'], 36, 1.2, 2.8);
    add(['region/town-0', 'region/town-1', 'region/town-2'], 40); add(['region/forest-0', 'region/forest-1'], 50);
    add(['region/village-0', 'region/village-1', 'region/village-2'], 60);
    add(['region/farm-0', 'region/farm-1'], 60); add(['region/hamlet-0', 'region/hamlet-1', 'region/hamlet-2'], 120);
    add(['region/grove-0', 'region/grove-1'], 150);
    for (let k = 0; k < 220; k++) { const at = place(0.5); if (at) props.push({ model: pick(HOUSES), x: at[0], z: at[1], rot: spin(), s: K * 1.25, rf: 0.34 }); }
    for (let k = 0; k < 320; k++) { const at = place(0.4); if (at) props.push({ model: pick(TREES), x: at[0], z: at[1], rot: spin(), s: range(0.07, 0.11), rf: 0.3 }); }
    return {
      kind: 'ground', rnd, bound, xp: 0.75, props, ground,
      baseColor: new THREE.Color(0.2, 0.52, 0.27),
      sky: { color: 0xa9dcff, fog: [320, 900] },
    };
  },
};

// ---- 3. Earth ---------------------------------------------------------------
const GLOBE_R = 32.8;                 // one unit is about 1.75 degrees of arc
const CITIES = [['New York', 40.7, -74], ['Los Angeles', 34, -118.2], ['Mexico City', 19.4, -99.1], ['Sao Paulo', -23.5, -46.6],
  ['Buenos Aires', -34.6, -58.4], ['Lima', -12, -77], ['Bogota', 4.7, -74.1], ['Chicago', 41.9, -87.6], ['Toronto', 43.7, -79.4],
  ['London', 51.5, -0.1], ['Madrid', 40.4, -3.7], ['Rome', 41.9, 12.5], ['Berlin', 52.5, 13.4], ['Moscow', 55.8, 37.6],
  ['Istanbul', 41, 29], ['Cairo', 30, 31.2], ['Lagos', 6.5, 3.4], ['Kinshasa', -4.3, 15.3], ['Johannesburg', -26.2, 28],
  ['Nairobi', -1.3, 36.8], ['Riyadh', 24.7, 46.7], ['Tehran', 35.7, 51.4], ['Karachi', 24.9, 67], ['Mumbai', 19.1, 72.9],
  ['Delhi', 28.6, 77.2], ['Dhaka', 23.8, 90.4], ['Bangkok', 13.8, 100.5], ['Singapore', 1.35, 103.8], ['Jakarta', -6.2, 106.8],
  ['Manila', 14.6, 121], ['Hong Kong', 22.3, 114.2], ['Shanghai', 31.2, 121.5], ['Beijing', 39.9, 116.4], ['Seoul', 37.6, 127],
  ['Tokyo', 35.7, 139.7], ['Sydney', -33.9, 151.2], ['Melbourne', -37.8, 145], ['Auckland', -36.8, 174.8], ['Honolulu', 21.3, -157.9],
  ['Anchorage', 61.2, -149.9], ['Reykjavik', 64.1, -21.9], ['Cape Town', -33.9, 18.4], ['Dakar', 14.7, -17.5], ['Santiago', -33.4, -70.7]];

const LANDMARKS = [
  { name: 'Great Pyramid', model: 'lm/khufu', lat: 29.98, lon: 31.13, rf: 0.7 },
  { name: 'Big Ben', model: 'lm/bigben', lat: 51.5, lon: -0.12, rf: 0.6 },
  { name: 'Arc de Triomphe', model: 'lm/arc', lat: 48.87, lon: 2.3, rf: 0.65 },
  { name: 'Empire State Building', model: 'lm/empire', lat: 40.75, lon: -73.99, rf: 0.7 },
];

const lonLat = (lon, lat) => [lon * DEG * GLOBE_R, -lat * DEG * GLOBE_R];
function onSphere(lon, lat, r, out) {
  const cl = Math.cos(lat * DEG), sl = Math.sin(lat * DEG);
  return out.set(cl * Math.sin(lon * DEG) * r, sl * r, cl * Math.cos(lon * DEG) * r);
}

// Triangulates one country outline (longitude / latitude rings) and wraps it onto the sphere.
function countryTriangles(polys, radius, emit) {
  for (const rings of polys) {
    const ref = rings[0][0][0];
    const flat = rings.map((ring) => {
      const pts = ring.slice(0, -1).map(([lon, lat]) => new THREE.Vector2(lon - Math.round((lon - ref) / 360) * 360, lat));
      return pts;
    });
    if (flat[0].length < 3) continue;
    const holes = flat.slice(1).filter((h) => h.length > 2), all = [flat[0], ...holes].flat();
    const tris = THREE.ShapeUtils.triangulateShape(flat[0], holes);
    const split = (a, b, c, depth) => {
      const ab = a.distanceTo(b), bc = b.distanceTo(c), ca = c.distanceTo(a), m = Math.max(ab, bc, ca);
      if (m < 5 || depth > 5) { emit(a, b, c); return; }
      if (m === ab) { const p = a.clone().lerp(b, 0.5); split(a, p, c, depth + 1); split(p, b, c, depth + 1); }
      else if (m === bc) { const p = b.clone().lerp(c, 0.5); split(a, b, p, depth + 1); split(a, p, c, depth + 1); }
      else { const p = c.clone().lerp(a, 0.5); split(a, b, p, depth + 1); split(p, b, c, depth + 1); }
    };
    for (const [i, j, k] of tris) split(all[i], all[j], all[k], 0);
  }
}

function pointInRings(lon, lat, polys) {
  for (const rings of polys) {
    const ring = rings[0];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

const earth = {
  id: 'earth', name: 'Earth', done: 'The whole planet, gone',
  async prepare(assets, opts, onProgress) {
    const [tex, countries] = await Promise.all([
      loadTexture('earth/earth.jpg'),
      fetch(`${ASSET_URL}earth/countries.json`).then((r) => r.json()),
      loadPack(assets, 'city'), loadPack(assets, 'region'), loadPack(assets, 'earth', onProgress),
    ]);
    composeRegion(assets);
    await loadSky(assets);
    assets.earth = { tex, countries };
  },
  build(assets, opts, seed) {
    const rnd = mulberry32(seed), { pick, range, chance, spin } = helpers(rnd);
    const { tex, countries } = assets.earth;
    const R = GLOBE_R, globe = new THREE.Group(), v = new THREE.Vector3();
    const land = makeGlobeMaterial({ map: tex, vertexColors: true });
    const sea = makeGlobeMaterial({ map: tex });
    const scarMat = makeGlobeMaterial({ color: 0x241d1a });

    // the ocean (with the land painted on, so coastlines line up) and a dark core you see through holes
    const grid = new THREE.SphereGeometry(R, 128, 72);
    {
      const pos = grid.attributes.position, uv = grid.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const lon = (uv.getX(i) - 0.5) * 360, lat = (uv.getY(i) - 0.5) * 180;
        onSphere(lon, lat, R, v); pos.setXYZ(i, v.x, v.y, v.z);
      }
      grid.computeVertexNormals();
    }
    globe.add(new THREE.Mesh(grid, sea));
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.965, 48, 32), new THREE.MeshBasicMaterial({ color: 0x0a0806 })));
    // thin atmosphere
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.045, 64, 40), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; void main() { float f = pow(1.0 - abs(dot(vN, vV)), 2.2); gl_FragColor = vec4(0.35, 0.62, 1.0, 1.0) * f * 0.9; }',
    })));

    const nodes = [], scarPos = [];
    const east = new THREE.Vector3(), up = new THREE.Vector3(), south = new THREE.Vector3(), c0 = new THREE.Vector3();
    for (const c of countries) {
      const [clon, clat] = c.c;
      onSphere(clon, clat, 1, up);
      east.set(Math.cos(clon * DEG), 0, -Math.sin(clon * DEG));
      south.crossVectors(east, up);
      c0.copy(up).multiplyScalar(R);
      const pos = [], uvs = [], col = [], shade = 0.84 + rnd() * 0.3;
      const push = (p) => {
        onSphere(p.x, p.y, R * 1.004, v);
        scarPos.push(v.x * 0.9975, v.y * 0.9975, v.z * 0.9975);
        v.sub(c0);
        pos.push(v.dot(east), v.dot(up), v.dot(south));
        uvs.push(p.x / 360 + 0.5, p.y / 180 + 0.5);
        col.push(shade, shade, shade);
      };
      countryTriangles(c.p, R, (a, b, d) => {
        // keep every triangle facing out of the planet
        const ccw = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x) > 0;
        push(a); push(ccw ? d : b); push(ccw ? b : d);
      });
      if (!pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, land);
      mesh.frustumCulled = false;
      const [x, z] = lonLat(clon, clat);
      const rf = Math.max(0.3, Math.min(11.5, Math.sqrt(c.a / Math.PI) / 0.0305));
      nodes.push({ node: mesh, x, z, rf, h: 0.6, name: c.n });
    }
    // what is left behind where a country used to be
    const scar = new THREE.BufferGeometry();
    scar.setAttribute('position', new THREE.Float32BufferAttribute(scarPos, 3));
    scar.computeVertexNormals();
    const scarMesh = new THREE.Mesh(scar, scarMat);
    scarMesh.frustumCulled = false;
    globe.add(scarMesh);

    const props = [], models = assets.models;
    const sized = (name, rf) => { const m = models[name]; return rf / (m.footprint + 0.03 * m.height); };
    for (const lm of LANDMARKS) {
      if (!models[lm.model]) continue;
      const [x, z] = lonLat(lm.lon, lm.lat);
      props.push({ model: lm.model, x, z, rot: spin(), y: 0.12, s: sized(lm.model, lm.rf), rf: lm.rf, name: lm.name, pts: 8 });
    }
    for (const [name, lat, lon] of CITIES) {
      const [x, z] = lonLat(lon + range(-0.6, 0.6), lat + range(-0.6, 0.6));
      const model = pick(['region/town-0', 'region/town-1', 'region/town-2', 'region/city-0']);
      const rf = range(0.42, 0.75);
      props.push({ model, x, z, rot: spin(), y: 0.12, s: sized(model, rf), rf, name, pts: 3 });
    }
    // shipping on the open sea
    const landAt = (lon, lat) => countries.some((c) => pointInRings(lon, lat, c.p));
    for (let k = 0, guard = 0; k < 110 && guard < 2000; guard++) {
      const lon = range(-180, 180), lat = Math.asin(range(-0.92, 0.92)) / DEG;
      if (landAt(lon, lat)) continue;
      const [x, z] = lonLat(lon, lat), a = spin();
      const model = pick(['pirate/ship-large', 'pirate/ship-medium', 'pirate/ship-small', 'pirate/ship-pirate-large', 'pirate/boat-row-large', 'pirate/ship-small']);
      const rf = range(0.32, 0.6);
      props.push({ model, x, z, rot: a, y: 0.02, s: sized(model, rf), rf, drift: [Math.sin(a) * 0.25, Math.cos(a) * 0.25], pts: 2 });
      k++;
    }
    // icebergs near the poles
    for (let k = 0; k < 40; k++) {
      const lon = range(-180, 180), lat = (chance(0.5) ? 1 : -1) * range(60, 73);
      if (landAt(lon, lat)) continue;
      const [x, z] = lonLat(lon, lat), rf = range(0.35, 0.9);
      props.push({ model: pick(['nature/stone_tallA', 'nature/stone_largeA']), x, z, rot: spin(), y: 0, s: sized('nature/stone_tallA', rf), rf, color: 0xdff3ff, pts: 2 });
    }
    return {
      kind: 'globe', rnd, globe, globeR: R, xp: 1.0, props, nodes,
      start: lonLat(pick([-30, -140, 70, 160]), pick([5, -20, 25])),
      sky: { color: 0x02040a, bg: assets.sky, bgIntensity: 1.6, fog: null },
      dispose() { for (const n of nodes) n.node.geometry.dispose(); scar.dispose(); grid.dispose(); land.dispose(); sea.dispose(); scarMat.dispose(); },
    };
  },
};

// ---- space stages -------------------------------------------------------------
// A soft glow drawn as a slightly larger shell around a body.
function haloMaterial(strength) {
  return new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: strength } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main() {
        vec4 p = vec4(position, 1.0); vec3 n = normal; vC = vec3(1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #endif
        vec4 mv = modelViewMatrix * p;
        vN = normalize(normalMatrix * n); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uStrength; varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main() { float f = pow(max(dot(normalize(vN), normalize(vV)), 0.0), 3.0); gl_FragColor = vec4(vC * f * uStrength, f); }`,
  });
}

// A photo (nebula, galaxy) laid flat in space; the edges fade out so no rectangle shows.
function photoMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; varying vec3 vC;
      void main() {
        vec4 p = vec4(position, 1.0); vUv = uv; vC = vec3(1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: `uniform sampler2D uMap; varying vec2 vUv; varying vec3 vC;
      void main() {
        vec3 c = texture2D(uMap, vUv).rgb;
        float edge = smoothstep(1.0, 0.72, length(vUv - 0.5) * 2.0);
        gl_FragColor = vec4(c * (0.6 + c) * 1.5 * vC * edge, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// A bubble universe: a photo wrapped on a sphere with a bright rim.
function bubbleMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main() {
        vec4 p = vec4(position, 1.0); vec3 n = normal; vUv = uv; vC = vec3(1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #endif
        vec4 mv = modelViewMatrix * p;
        vN = normalize(normalMatrix * n); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D uMap; varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main() {
        float rim = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.2);
        vec3 c = texture2D(uMap, vUv * vec2(2.0, 1.0)).rgb * 0.9 + vC * 0.10;
        gl_FragColor = vec4(c + vC * rim * 1.3, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// A brightened black-and-white copy of a texture (used to tint one star surface many colours).
function greyscale(tex) {
  const img = tex.image, c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const l = Math.min(255, 70 + (px[i] * 0.5 + px[i + 1] * 0.4 + px[i + 2] * 0.1) * 0.95);
    px[i] = px[i + 1] = px[i + 2] = l;
  }
  g.putImageData(d, 0, 0);
  const out = new THREE.CanvasTexture(c);
  out.colorSpace = THREE.SRGBColorSpace;
  return out;
}

function registerModel(assets, name, geometry, material) {
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  assets.models[name] = { name, geometry, material, ground: false, size, footprint: 1, halfDiag: 1, height: size.y };
}

async function loadSky(assets) {
  if (assets.sky) return;
  const sky = await loadTexture('space/stars.jpg');
  sky.mapping = THREE.EquirectangularReflectionMapping;
  assets.sky = sky;
}

// Shared pieces for the four space stages: glowing stars, photo cards, bubbles, the sky.
async function prepareSpace(assets, onProgress) {
  if (assets.space) return;
  const PHOTOS = ['heic0109a', 'heic0206c', 'heic0305a', 'heic0406a', 'heic0414a', 'heic0503a', 'heic0506a', 'heic0515a', 'heic0601a',
    'heic0602a', 'heic0604a', 'heic0615a', 'heic0707a', 'heic0709a', 'heic0719a', 'heic0817a', 'heic0822a', 'heic0910h', 'heic1107a',
    'heic1302a', 'heic1310a', 'heic1501a', 'heic1509a', 'heic1608a', 'opo0328a', 'opo0501a', 'opo0624a', 'opo9941a', 'potw1036a', 'potw1113a'];
  const PLANETS = ['sun', 'mercury', 'venus', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'ceres', 'eris', 'haumea', 'makemake'];
  let done = 0;
  const total = PHOTOS.length + PLANETS.length + 1;
  const tick = (t) => { if (onProgress) onProgress(++done / total); return t; };
  const [photos, planets, ring] = await Promise.all([
    Promise.all(PHOTOS.map((id) => loadTexture(`space/deep/${id}.jpg`).then(tick))),
    Promise.all(PLANETS.map((id) => loadTexture(`space/planets/${id}.jpg`).then(tick))),
    loadTexture('space/planets/saturn_ring.png').then(tick),
    loadSky(assets),
  ]);
  const tex = {}, photo = {};
  PLANETS.forEach((id, i) => { tex[id] = planets[i]; });
  PHOTOS.forEach((id, i) => { photo[id] = photos[i]; photos[i].wrapS = photos[i].wrapT = THREE.MirroredRepeatWrapping; });

  // star: a bright textured ball with a glow shell, drawn as one instanced model with two materials
  const core = new THREE.SphereGeometry(1, 20, 14), shell = new THREE.SphereGeometry(1.75, 20, 14);
  const star = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv']) {
    const a = core.attributes[k], b = shell.attributes[k], arr = new Float32Array(a.array.length + b.array.length);
    arr.set(a.array); arr.set(b.array, a.array.length);
    star.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize));
  }
  const idx = [...core.index.array, ...Array.from(shell.index.array, (i) => i + core.attributes.position.count)];
  star.setIndex(idx);
  star.addGroup(0, core.index.count, 0); star.addGroup(core.index.count, shell.index.count, 1);
  registerModel(assets, 'space/star', star, [new THREE.MeshBasicMaterial({ map: greyscale(tex.sun) }), haloMaterial(0.55)]);

  const card = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  for (const id of PHOTOS) {
    const img = photo[id].image, w = img.width, h = img.height, m = Math.max(w, h);
    const g = card.clone().scale(w / m, 1, h / m);
    registerModel(assets, `photo/${id}`, g, photoMaterial(photo[id]));
  }
  const ball = new THREE.SphereGeometry(1, 28, 18);
  for (const id of ['heic0406a', 'heic0709a', 'heic0602a', 'heic0719a']) registerModel(assets, `bubble/${id}`, ball, bubbleMaterial(photo[id]));
  assets.space = { tex, photo, ring, ball: new THREE.SphereGeometry(1, 40, 26) };
}

const NEBULAE = [['heic0601a', 'Orion Nebula'], ['heic0515a', 'Crab Nebula'], ['heic0707a', 'Carina Nebula'], ['heic1310a', 'Ring Nebula'],
  ['heic0414a', "Cat's Eye Nebula"], ['heic0910h', 'Butterfly Nebula'], ['heic1501a', 'Pillars of Creation'], ['heic1608a', 'Bubble Nebula'],
  ['heic0109a', 'Red Spider Nebula'], ['heic0206c', 'Cone Nebula'], ['heic0305a', 'Omega Nebula'], ['heic0503a', 'V838 Monocerotis'],
  ['heic0822a', 'NGC 3603'], ['heic1509a', 'Westerlund 2'], ['potw1113a', 'Globular cluster']];
const GALAXIES = [['heic0506a', 'Whirlpool Galaxy'], ['heic0602a', 'Pinwheel Galaxy'], ['opo0328a', 'Sombrero Galaxy'], ['opo0501a', 'NGC 1300'],
  ['heic0615a', 'Antennae Galaxies'], ['heic0604a', 'Cigar Galaxy'], ['heic1107a', 'Arp 273'], ['opo9941a', 'NGC 2207'], ['heic0817a', 'NGC 1275'],
  ['potw1036a', 'Cartwheel Galaxy'], ['heic0719a', 'Messier 74'], ['heic1302a', 'Messier 106'], ['opo0624a', 'NGC 5866']];

const tiltQ = (rnd, max) => new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * max, 0, (rnd() - 0.5) * max));

const solar = {
  id: 'solar', name: 'Solar System', done: 'The Sun has gone out',
  async prepare(assets, opts, onProgress) { await Promise.all([loadPack(assets, 'city'), loadPack(assets, 'region'), prepareSpace(assets, onProgress)]); },
  build(assets, opts, seed) {
    const rnd = mulberry32(seed), { pick, range, spin } = helpers(rnd);
    const { tex, ring, ball } = assets.space, nodes = [], props = [], bound = 108;
    const body = (name, map, rf, orbitR, opts2 = {}) => {
      const mat = opts2.glow ? new THREE.MeshBasicMaterial({ map }) : new THREE.MeshLambertMaterial({ map });
      const mesh = new THREE.Mesh(ball, mat), node = new THREE.Group();
      node.add(mesh);
      if (opts2.glow) { const halo = new THREE.Mesh(ball, haloMaterial(0.9)); halo.scale.setScalar(1.55); node.add(halo); }
      if (opts2.ring) {
        const g = new THREE.RingGeometry(1.25, 2.3, 72, 1);
        const p = g.attributes.position, uv = g.attributes.uv, t = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) { t.fromBufferAttribute(p, i); uv.setXY(i, (t.length() - 1.25) / 1.05, 0.5); }
        node.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: ring, transparent: true, side: THREE.DoubleSide, depthWrite: false })).rotateX(-Math.PI / 2 + 0.35));
      }
      const a = spin();
      nodes.push({ node, x: Math.cos(a) * orbitR, z: Math.sin(a) * orbitR, s: rf, rf, h: rf, name, turn: opts2.turn ?? 0.25, boss: opts2.boss,
        orbit: orbitR ? { cx: 0, cz: 0, r: orbitR, a, w: (opts2.w ?? 1) * 0.9 / orbitR } : null, pts: opts2.pts });
      return nodes[nodes.length - 1];
    };
    body('The Sun', tex.sun, 11.5, 0, { glow: true, boss: true, turn: 0.05, pts: 100 });
    body('Mercury', tex.mercury, 1.5, 18, { w: 1.6 });
    body('Venus', tex.venus, 2.7, 26, { w: 1.3 });
    body('Mars', tex.mars, 2.0, 43);
    body('Jupiter', tex.jupiter, 8.2, 66, { w: 0.6 });
    body('Saturn', tex.saturn, 6.4, 82, { w: 0.5, ring: true });
    body('Uranus', tex.uranus, 4.9, 94, { w: 0.4 });
    body('Neptune', tex.neptune, 4.5, 103, { w: 0.35 });
    const start = [33, 0];
    // the Moon is still drifting where the Earth used to be: breakfast
    const moons = [['The Moon', tex.moon, 0.85, 35.5], ['Ceres', tex.ceres, 1.0, 51], ['Eris', tex.eris, 1.2, 99], ['Haumea', tex.haumea, 1.05, 88],
      ['Makemake', tex.makemake, 1.1, 97], ['Io', tex.makemake, 0.8, 55], ['Europa', tex.eris, 0.75, 58], ['Ganymede', tex.moon, 1.3, 75],
      ['Callisto', tex.mercury, 1.25, 77], ['Titan', tex.venus, 1.35, 90], ['Triton', tex.ceres, 0.9, 106], ['Pluto', tex.haumea, 1.15, 107],
      ['Phobos', tex.moon, 0.6, 40], ['Vesta', tex.ceres, 0.7, 48]];
    for (const [name, map, rf, r] of moons) { const b = body(name, map, rf, r, { w: 0.8 }); if (name === 'The Moon') { b.orbit.a = 0.05; b.x = Math.cos(0.05) * r; b.z = Math.sin(0.05) * r; } }
    // rocks: a belt between Mars and Jupiter, a second one far out, and strays everywhere
    const ROCKS = ['nature/stone_tallA', 'nature/stone_largeA', 'nature/stone_tallA'];
    const rock = (r, a, rf) => {
      const model = pick(ROCKS), m = assets.models[model];
      props.push({ model, x: Math.cos(a) * r, z: Math.sin(a) * r, y: range(-0.6, 0.6), rot: spin(), q0: tiltQ(rnd, 3), s: rf / (m.footprint + 0.03 * m.height), rf,
        turn: range(-0.6, 0.6), orbit: { cx: 0, cz: 0, r, a, w: range(0.5, 1.1) / r }, color: pick([0xb8aa9c, 0xd6c0a8, 0x9da0ad, 0xe8d8c0]) });
    };
    for (let k = 0; k < 190; k++) rock(range(46, 57), spin(), range(0.3, 0.8));
    for (let k = 0; k < 130; k++) rock(range(27, 41), spin(), range(0.3, 0.7));
    for (let k = 0; k < 130; k++) rock(range(86, 112), spin(), range(0.3, 1.1));
    for (let k = 0; k < 110; k++) rock(range(14, 108), spin(), range(0.3, 0.9));
    return {
      kind: 'space', rnd, bound, xp: 0.5, props, nodes, start,
      spawn: (r) => { const a = r() * TAU, d = 22 + r() * 80; return [Math.cos(a) * d, Math.sin(a) * d]; },
      sky: { color: 0x000004, bg: assets.sky, bgIntensity: 2.2, fog: null, hemi: 0.7, sun: 2.4 },
    };
  },
};

const STAR_KINDS = [
  // name, colour, size range, how many
  ['Red dwarf', 0xff7a4a, 0.3, 0.55, 230], ['Orange star', 0xffb066, 0.45, 0.8, 120], ['Yellow star', 0xfff0b0, 0.6, 0.95, 90],
  ['White star', 0xffffff, 1.0, 1.6, 60], ['Blue star', 0x9fc4ff, 1.6, 2.5, 40], ['Red giant', 0xff5a3a, 2.6, 4.2, 26],
  ['Blue giant', 0x7fb0ff, 4.4, 6.4, 12], ['Supergiant', 0xffa25a, 7.0, 8.4, 6], ['Hypergiant', 0xff7ad0, 9.2, 10.6, 3],
];

const galaxy = {
  id: 'galaxy', name: 'Milky Way', done: 'The Milky Way has been swallowed',
  async prepare(assets, opts, onProgress) { await prepareSpace(assets, onProgress); },
  build(assets, opts, seed) {
    const rnd = mulberry32(seed), { pick, range, spin } = helpers(rnd);
    const bound = 118, props = [], taken = [{ x: 0, z: 0, r: 15 }];
    // stars sit on four spiral arms
    const spot = (r) => {
      for (let t = 0; t < 30; t++) {
        const d = 14 + Math.pow(rnd(), 0.8) * 108, arm = Math.floor(rnd() * 4) * (TAU / 4);
        const a = arm + d * 0.028 + (rnd() - 0.5) * (1.0 - d / 210), x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (Math.abs(x) > bound || Math.abs(z) > bound) continue;
        if (taken.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + r)) { taken.push({ x, z, r }); return [x, z]; }
      }
      return null;
    };
    props.push({ model: 'space/star', x: 0, z: 0, s: 11.5, rf: 11.5, color: 0xfff3d0, name: 'Galactic Core', boss: true, pts: 100, turn: 0.05 });
    for (const [id, name] of NEBULAE) {
      const rf = range(1.8, 6.5), at = spot(rf);
      if (at) props.push({ model: `photo/${id}`, x: at[0], z: at[1], y: range(-0.5, 0.5), s: rf * 1.25, rf, rot: spin(), q0: tiltQ(rnd, 0.5), name, turn: range(-0.05, 0.05) });
    }
    for (const [name, color, a, b, count] of STAR_KINDS.slice().reverse()) {
      for (let k = 0; k < count; k++) {
        const rf = range(a, b), at = spot(rf * 1.2);
        if (at) props.push({ model: 'space/star', x: at[0], z: at[1], y: range(-1, 1), s: rf, rf, color, rot: spin(), turn: range(-0.2, 0.2), name: rf > 2.5 ? name : null, bob: 0.25 });
      }
    }
    return {
      kind: 'space', rnd, bound, xp: 0.9, props,
      sky: { color: 0x000004, bg: assets.sky, bgIntensity: 2.2, fog: null },
    };
  },
};

const cosmos = {
  id: 'cosmos', name: 'The Universe', done: 'Every galaxy, eaten',
  async prepare(assets, opts, onProgress) { await prepareSpace(assets, onProgress); },
  build(assets, opts, seed) {
    const rnd = mulberry32(seed), { pick, range, spin } = helpers(rnd);
    const bound = 108, props = [], place = scatterer(rnd, bound - 6, [{ x: 0, z: 0, r: 15 }]);
    const TINTS = [0xffffff, 0xffe2c4, 0xcfe0ff, 0xffd0e6, 0xd8ffe9];
    props.push({ model: 'photo/heic0709a', x: 0, z: 0, s: 14, rf: 11.5, name: 'The Great Attractor', boss: true, pts: 100, turn: 0.03 });
    const add = (count, a, b, named) => {
      for (let k = 0; k < count; k++) {
        const rf = range(a, b), at = place(rf * 1.1);
        if (!at) continue;
        const [id, name] = pick(GALAXIES);
        props.push({ model: `photo/${id}`, x: at[0], z: at[1], y: range(-1, 1), s: rf * 1.3, rf, rot: spin(), q0: tiltQ(rnd, 1.1), color: pick(TINTS), name: named ? name : null, turn: range(-0.12, 0.12), drift: [range(-0.3, 0.3), range(-0.3, 0.3)] });
      }
    };
    add(3, 9, 10.6, true); add(6, 6.5, 8.4, true); add(12, 4.2, 6.2, true); add(26, 2.5, 4, true);
    add(44, 1.5, 2.4, true); add(70, 0.9, 1.4, false); add(130, 0.55, 0.9, false); add(260, 0.3, 0.55, false);
    return {
      kind: 'space', rnd, bound, xp: 0.9, props,
      sky: { color: 0x010109, bg: assets.sky, bgIntensity: 0.5, fog: null },
    };
  },
};

const multiverse = {
  id: 'multiverse', name: 'Multiverse', done: 'There is nothing left',
  async prepare(assets, opts, onProgress) { await prepareSpace(assets, onProgress); },
  build(assets, opts, seed) {
    const rnd = mulberry32(seed), { pick, range, spin } = helpers(rnd);
    const bound = 108, props = [], place = scatterer(rnd, bound - 6, [{ x: 0, z: 0, r: 15 }]);
    const KINDS = ['bubble/heic0406a', 'bubble/heic0709a', 'bubble/heic0602a', 'bubble/heic0719a'];
    const TINTS = [0x8fd0ff, 0xff9ad5, 0xffd98a, 0xa5ffcf, 0xc9a7ff, 0xffffff];
    props.push({ model: 'bubble/heic0406a', x: 0, z: 0, s: 11.5, rf: 11.5, color: 0xffffff, name: 'Everything Else', boss: true, pts: 100, turn: 0.04 });
    const add = (count, a, b, named) => {
      for (let k = 0; k < count; k++) {
        const rf = range(a, b), at = place(rf * 1.1);
        if (at) props.push({ model: pick(KINDS), x: at[0], z: at[1], y: range(-1, 1), s: rf, rf, rot: spin(), q0: tiltQ(rnd, 2), color: pick(TINTS), name: named ? `Universe ${Math.floor(rnd() * 9000 + 1000)}` : null, turn: range(-0.25, 0.25), drift: [range(-0.4, 0.4), range(-0.4, 0.4)], bob: 0.4 });
      }
    };
    add(3, 9, 10.6, true); add(6, 6.5, 8.4, true); add(12, 4.2, 6.2, true); add(26, 2.5, 4, true);
    add(44, 1.5, 2.4, false); add(70, 0.9, 1.4, false); add(130, 0.55, 0.9, false); add(260, 0.3, 0.55, false);
    return {
      kind: 'space', rnd, bound, xp: 0.9, props,
      sky: { color: 0x0b0318, bg: null, fog: null },
    };
  },
};

export const STAGES = [city, region, earth, solar, galaxy, cosmos, multiverse];

export function prepareStage(assets, index, opts, onProgress) { return STAGES[index].prepare(assets, opts, onProgress); }
export function buildStage(assets, index, opts, seed) {
  const stage = STAGES[index].build(assets, opts, seed);
  stage.id = STAGES[index].id; stage.name = STAGES[index].name;
  return stage;
}

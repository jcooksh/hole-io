// Loads the model kits (see CREDITS.md) on demand and turns each model into a single merged
// geometry, so a whole world can be drawn with instancing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ASSET_URL = new URL('../assets/', import.meta.url).href;

export const MAX_HOLES = 8;

// Uniforms shared by every patched material.
export const uniforms = {
  uHoles: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector3(0, 0, 0)) },      // flat stages: x, z, radius
  uHoleDirs: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector4(0, 1, 0, 2)) }, // globe: direction, cos(angle)
  uGlobeC: { value: new THREE.Vector3() },
  uPlayer: { value: new THREE.Vector3() },
  uReveal: { value: 0 },
  uFade: { value: 10 },
};

// World units are metres in the city. Each kit is authored at its own scale.
const KITS = {
  roads: { scale: 10, tex: true },
  commercial: { scale: 10, tex: true },
  suburban: { scale: 10, tex: true },
  cars: { scale: 1.6, tex: true },
  nature: { scale: 5, tex: false },
  characters: { scale: 2.6, tex: true },
  industrial: { scale: 10, tex: true },
  food: { scale: 3, tex: true },      // deliberately oversized snacks
  skate: { scale: 2.6, tex: true },
  pets: { scale: 0.6, tex: true },
  pirate: { scale: 0.08, tex: true },
};

const GROUND = new Set([
  'roads/road-straight', 'roads/road-crossroad', 'roads/road-intersection', 'roads/road-bend',
  'roads/road-crossing', 'roads/tile-low', 'nature/ground_grass', 'skate/floor-concrete',
]);

const SCALE_OVERRIDE = {
  'nature/ground_grass': 10,
  'cars/firetruck': 2.0, 'cars/garbage-truck': 2.0, 'cars/delivery': 1.9, 'cars/delivery-flat': 1.9,
  'cars/ambulance': 1.9, 'cars/truck': 1.8, 'cars/truck-flat': 1.8, 'cars/tractor': 1.7,
  'nature/statue_obelisk': 8, 'nature/statue_column': 7, 'nature/statue_head': 8,
  'nature/tent_detailedOpen': 6, 'nature/rock_largeA': 6, 'nature/statue_ring': 8, 'nature/canoe': 4,
  'cars/tractor-shovel': 1.7,
  'skate/floor-concrete': 10, 'skate/half-pipe': 5, 'skate/ramp': 5, 'skate/steps': 5, 'skate/structure-platform': 5,
  'skate/obstacle-box': 4, 'skate/rail-high': 4, 'skate/fence': 4, 'skate/skateboard': 1.6, 'skate/scooter': 1.8,
  'pets/animal-cow': 0.95, 'pets/animal-pig': 0.7, 'pets/animal-cat': 0.5, 'pets/animal-bunny': 0.45, 'pets/animal-chick': 0.4,
};

const person = (n) => ['characters', `character-${n}`];

// A pack is everything one map or stage needs. Packs are fetched the first time they are used.
export const PACKS = {
  city: {
    models: {
      roads: ['road-straight', 'road-crossroad', 'road-intersection', 'road-bend', 'road-crossing', 'tile-low',
        'construction-cone', 'construction-barrier', 'construction-fence', 'construction-light', 'dumpster',
        'light-square', 'light-curved', 'light-square-double', 'road-sign-stop', 'road-sign-street',
        'road-sign-warning', 'traffic-light', 'sign-highway', 'electricity-pole-single'],
      commercial: ['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g',
        'building-h', 'building-i', 'building-j', 'building-k', 'building-l', 'building-m', 'building-n',
        'building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d',
        'building-skyscraper-e', 'detail-parasol-a', 'detail-parasol-b'],
      suburban: ['building-type-a', 'building-type-b', 'building-type-c', 'building-type-d', 'building-type-e',
        'building-type-f', 'building-type-g', 'building-type-h', 'building-type-j', 'building-type-k',
        'building-type-l', 'building-type-m', 'building-type-n', 'building-type-q', 'building-type-s',
        'building-type-t', 'building-type-i', 'building-type-o', 'building-type-p', 'building-type-r', 'building-type-u',
        'tree-large', 'tree-small', 'planter', 'fence'],
      cars: ['sedan', 'sedan-sports', 'suv', 'suv-luxury', 'taxi', 'police', 'van', 'truck', 'truck-flat',
        'hatchback-sports', 'delivery', 'delivery-flat', 'ambulance', 'firetruck', 'garbage-truck', 'race',
        'tractor', 'tractor-shovel', 'race-future', 'box', 'cone'],
      nature: ['ground_grass', 'tree_oak', 'tree_default', 'tree_detailed', 'tree_fat', 'tree_pineRoundA',
        'plant_bush', 'plant_bushLarge', 'flower_redA', 'flower_yellowA', 'flower_purpleA', 'rock_largeA',
        'rock_smallA', 'statue_obelisk', 'statue_column', 'statue_head', 'mushroom_red', 'stump_round',
        'log_stack', 'tent_detailedOpen', 'sign', 'pot_large', 'tree_tall', 'tree_simple', 'tree_palm',
        'campfire_stones', 'canoe', 'statue_ring'],
      industrial: ['building-a', 'building-c', 'building-d', 'building-e', 'building-f', 'building-h', 'building-k',
        'building-l', 'building-m', 'building-n', 'building-q', 'building-r', 'chimney-large', 'chimney-medium',
        'detail-tank', 'detail-tank-large', 'shipping-container-a', 'shipping-container-b', 'shipping-container-c',
        'solar-panel-landscape-group', 'solar-panel-portrait', 'water-tower', 'windmill'],
      food: ['burger', 'pizza', 'donut-sprinkles', 'hot-dog', 'ice-cream', 'watermelon', 'pumpkin', 'cake-birthday',
        'fries', 'soda-can', 'cupcake', 'cheese', 'turkey', 'pizza-box', 'barrel', 'sundae', 'taco', 'pineapple'],
      skate: ['floor-concrete', 'bench', 'benches', 'half-pipe', 'ramp', 'obstacle-box', 'rail-high', 'steps',
        'structure-platform', 'pallet', 'skateboard', 'scooter', 'fence'],
      pets: ['animal-dog', 'animal-cat', 'animal-bunny', 'animal-chick', 'animal-pig', 'animal-cow'],
    },
    // Animated pedestrians. The skaters share the mini-character rig and animations.
    characters: [
      ...['male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f', 'female-a', 'female-b', 'female-c', 'female-d',
        'female-e', 'female-f', 'worker'].map(person),
      ['skate', 'character-skate-boy'], ['skate', 'character-skate-girl'],
    ],
  },
};
// simple blocks for skylines seen from far away, and rocks for mountains and asteroids
PACKS.region = {
  models: {
    commercial: [...'abcdefghijklmn'].map((c) => `low-detail-building-${c}`).concat(['low-detail-building-wide-a', 'low-detail-building-wide-b']),
    nature: ['rock_tallA', 'rock_tallB', 'rock_tallC', 'rock_tallD', 'rock_largeB', 'rock_largeC', 'stone_tallA', 'stone_largeA'],
  },
};
// ships, plus landmark scans from Wikimedia Commons (see CREDITS.md)
PACKS.earth = {
  models: { pirate: ['ship-large', 'ship-medium', 'ship-small', 'ship-pirate-large', 'boat-row-large'] },
  stl: [
    { name: 'lm/khufu', file: 'earth/landmarks/khufu.stl', size: 1.5, color: 0xe2c98f, up: 'z' },
    { name: 'lm/bigben', file: 'earth/landmarks/bigben.stl', size: 2.2, color: 0xcdb68a, up: 'z' },
    { name: 'lm/arc', file: 'earth/landmarks/arc.stl', size: 1.5, color: 0xe6dcc8, up: 'z' },
    { name: 'lm/empire', file: 'earth/landmarks/empire.stl', size: 2.6, color: 0xb9c0c8, up: 'z' },
  ],
};
export const CHARACTER_SCALE = KITS.characters.scale;

const HOLE_GLSL = `
uniform vec3 uHoles[${MAX_HOLES}];
uniform vec4 uHoleDirs[${MAX_HOLES}];
uniform vec3 uGlobeC;
uniform vec3 uPlayer;
uniform float uReveal;
uniform float uFade;
varying vec3 vWPos;
`;

const WORLD_POS_VERT = `#include <project_vertex>
  vec4 hWP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    hWP = instanceMatrix * hWP;
  #endif
  vWPos = (modelMatrix * hWP).xyz;
`;

// kind 'ground': cut a round opening wherever a hole is.
// kind 'globe':  the same on a sphere (holes are directions from the globe's centre).
// kind 'object': fade to black below ground, and dither away anything that
// would hide the player's hole from the camera.
function patch(material, kind) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const objVert = kind === 'object'
      ? '#ifdef USE_INSTANCING\nattribute float aFall;\n#endif\nvarying float vFall;\n' : '';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${objVert}`)
      .replace('#include <project_vertex>', WORLD_POS_VERT + (kind === 'object'
        ? '\n#ifdef USE_INSTANCING\n vFall = aFall;\n#else\n vFall = 1.0;\n#endif\n' : ''));

    let frag = shader.fragmentShader.replace('#include <common>', `#include <common>\n${HOLE_GLSL}${kind === 'object' ? 'varying float vFall;\n' : ''}`);
    if (kind === 'globe') {
      frag = frag
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          float hEdge = 1.0;
          vec3 gDir = normalize(vWPos - uGlobeC);
          for (int i = 0; i < ${MAX_HOLES}; i++) {
            vec4 h = uHoleDirs[i];
            float c = dot(gDir, h.xyz);
            if (c > h.w) discard;
            hEdge = min(hEdge, (h.w - c) / max(0.0005, (1.0 - h.w) * 0.5 + 0.0004));
          }`)
        .replace('#include <opaque_fragment>', `outgoingLight *= mix(0.6, 1.0, smoothstep(0.0, 1.0, hEdge));
          #include <opaque_fragment>`);
    } else if (kind === 'ground') {
      frag = frag
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          float hEdge = 1.0;
          for (int i = 0; i < ${MAX_HOLES}; i++) {
            vec3 h = uHoles[i];
            if (h.z <= 0.0) continue;
            float d = distance(vWPos.xz, h.xy);
            if (d < h.z) discard;
            hEdge = min(hEdge, (d - h.z) / (h.z * 0.22 + 0.25));
          }`)
        .replace('#include <opaque_fragment>', `outgoingLight *= mix(0.62, 1.0, smoothstep(0.0, 1.0, hEdge));
          #include <opaque_fragment>`);
    } else {
      frag = frag
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          // Anything at ground level directly over a hole is cut away too, otherwise the floor of a
          // building you slide under would fight with the hole for the same pixels.
          if (vFall != 1.0 && vWPos.y < 0.75) {
            for (int i = 0; i < ${MAX_HOLES}; i++) {
              vec3 h = uHoles[i];
              if (h.z > 0.0 && distance(vWPos.xz, h.xy) < h.z * 1.12) discard;
            }
          }
          // vFall: 0 = standing, 1 = falling into a hole, 2 = "ghost" (blocks the camera's view of the player)
          float hNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (vFall > 1.5) {
            if (hNoise < 0.84 * smoothstep(1.2, 2.6, vWPos.y)) discard;
          } else if (uReveal > 0.0 && vFall < 0.5 && vWPos.y > 3.0) {
            vec3 ray = vWPos - cameraPosition;
            float k = cameraPosition.y / max(cameraPosition.y - vWPos.y, 0.001);
            vec2 g = cameraPosition.xz + ray.xz * k;
            float a = smoothstep(uReveal, uReveal * 0.55, distance(g, uPlayer.xz)) * smoothstep(3.0, 4.5, vWPos.y);
            if (hNoise < a * 0.86) discard;
          }`)
        .replace('#include <opaque_fragment>', `float hDepth = clamp(1.0 + vWPos.y / uFade, 0.0, 1.0);
          outgoingLight *= hDepth * hDepth;
          #include <opaque_fragment>`);
    }
    shader.fragmentShader = frag;
  };
  material.customProgramCacheKey = () => `hole-${kind}`;
  return material;
}

export function makeGroundMaterial(params) {
  return patch(new THREE.MeshLambertMaterial(params), 'ground');
}
export function makeGlobeMaterial(params) {
  return patch(new THREE.MeshLambertMaterial(params), 'globe');
}

// Rebuild an attribute as a plain Float32 one (GLB data may be interleaved or normalised).
function plainAttribute(attr, itemSize) {
  const out = new Float32Array(attr.count * itemSize);
  for (let i = 0; i < attr.count; i++) {
    out[i * itemSize] = attr.getX(i);
    out[i * itemSize + 1] = attr.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
  }
  return new THREE.BufferAttribute(out, itemSize);
}

const WHITE = new THREE.Color(1, 1, 1);

function mergeScene(root, scale, keepY) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    let src = o.geometry;
    if (!src.attributes.normal) { src = src.clone(); src.computeVertexNormals(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', plainAttribute(src.attributes.position, 3));
    g.setAttribute('normal', plainAttribute(src.attributes.normal, 3));
    g.setAttribute('uv', src.attributes.uv
      ? plainAttribute(src.attributes.uv, 2)
      : new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
    if (src.index) g.setIndex(src.index.clone());
    g.applyMatrix4(o.matrixWorld);
    const flat = g.index ? g.toNonIndexed() : g;
    const n = flat.attributes.position.count;
    const col = new Float32Array(n * 3);
    const paint = (mat, from, to) => {
      const c = mat.map ? WHITE : mat.color;
      for (let i = from; i < to; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    };
    if (Array.isArray(o.material)) for (const grp of src.groups) paint(o.material[grp.materialIndex], grp.start, Math.min(n, grp.start + grp.count));
    else paint(o.material, 0, n);
    flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(flat);
  });
  const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  geo.scale(scale, scale, scale);
  geo.computeBoundingBox();
  if (!keepY) geo.translate(0, -geo.boundingBox.min.y, 0);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ---- loading ---------------------------------------------------------------
// The kits all point at "Textures/colormap.png"; load one shared copy per kit
// instead of letting every GLB decode its own.
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const manager = new THREE.LoadingManager();
manager.setURLModifier((url) => (/\.png($|\?)/.test(url) && !url.startsWith('data:') ? BLANK : url));
const gltfLoader = new GLTFLoader(manager);
const texLoader = new THREE.TextureLoader();
const textureCache = new Map();

// Plain image textures (planets, galaxies, the Earth), fetched once.
export function loadTexture(path, { srgb = true, repeat = false } = {}) {
  if (!textureCache.has(path)) {
    textureCache.set(path, texLoader.loadAsync(ASSET_URL + path).then((t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = 4;
      return t;
    }));
  }
  return textureCache.get(path);
}

export function createAssets() {
  return { models: {}, characters: [], materials: {}, packs: new Map() };
}

function kitMaterials(assets, kit, jobs) {
  if (assets.materials[kit]) return assets.materials[kit];
  const cfg = KITS[kit];
  const mats = assets.materials[kit] = {
    object: patch(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 'object'),
    skinned: patch(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), 'object'),
    ground: patch(new THREE.MeshLambertMaterial({ vertexColors: true }), 'ground'),
  };
  if (cfg.tex) {
    jobs.push(texLoader.loadAsync(`${ASSET_URL}models/${kit}/Textures/colormap.png`).then((t) => {
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      for (const m of Object.values(mats)) { m.map = t; m.needsUpdate = true; }
    }));
  }
  return mats;
}

function register(assets, name, geometry, material, ground) {
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  return assets.models[name] = {
    name, geometry, ground, size, material,
    footprint: 0.5 * Math.sqrt(size.x * size.z),
    halfDiag: 0.5 * Math.hypot(size.x, size.z),
    height: size.y,
  };
}

async function loadObj(kit, file) {
  const base = `${ASSET_URL}models/${kit}/`;
  const mtl = await new MTLLoader().setPath(base).loadAsync(`${file}.mtl`);
  mtl.preload();
  return new OBJLoader().setMaterials(mtl).loadAsync(`${base}${file}.obj`);
}

// Loads a pack once. Calling it again returns the same promise.
export function loadPack(assets, packName, onProgress) {
  if (assets.packs.has(packName)) return assets.packs.get(packName);
  const pack = PACKS[packName];
  const texJobs = [], jobs = [];
  for (const [kit, names] of Object.entries(pack.models || {})) {
    kitMaterials(assets, kit, texJobs);
    for (const n of names) if (!assets.models[`${kit}/${n}`]) jobs.push({ kit, file: n });
  }
  for (const [kit, file, special] of pack.characters || []) { kitMaterials(assets, kit, texJobs); jobs.push({ kit, file, character: true, special }); }
  for (const stl of pack.stl || []) jobs.push({ stl });
  let done = 0;
  const total = jobs.length + texJobs.length;
  const tick = () => onProgress && onProgress(++done / total);
  texJobs.forEach((j) => j.then(tick));

  const work = Promise.all(jobs.map(async ({ kit, file, character, special, stl }) => {
    if (stl) {
      // Landmark scans: one plain mesh each, laid on its base and painted a single colour.
      const geo = await new STLLoader().loadAsync(`${ASSET_URL}${stl.file}`);
      if (stl.up === 'z') geo.rotateX(-Math.PI / 2);
      geo.computeBoundingBox();
      const size = geo.boundingBox.getSize(new THREE.Vector3()), c = geo.boundingBox.getCenter(new THREE.Vector3());
      geo.translate(-c.x, -geo.boundingBox.min.y, -c.z);
      const k = stl.size / Math.max(size.x, size.y, size.z);
      geo.scale(k, k, k);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const n = geo.attributes.position.count, col = new Float32Array(n * 3), tint = new THREE.Color(stl.color);
      for (let i = 0; i < n; i++) { col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      kitMaterials(assets, 'nature', texJobs);
      register(assets, stl.name, geo, assets.materials.nature.object, false);
      tick();
      return;
    }
    const mats = assets.materials[kit], name = `${kit}/${file}`;
    if (character) {
      const gltf = await gltfLoader.loadAsync(`${ASSET_URL}models/${kit}/${file}.glb`);
      gltf.scene.traverse((o) => {
        if (o.isMesh) { o.material = mats.skinned; o.castShadow = true; }
      });
      // Generous culling spheres, measured once in the rest pose and reused by every clone.
      gltf.scene.updateMatrixWorld(true);
      const bounds = [];
      gltf.scene.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        o.computeBoundingSphere();
        o.boundingSphere.radius *= 1.7;
        bounds.push(o.boundingSphere);
      });
      const clips = {};
      for (const c of gltf.animations) clips[c.name] = c;
      if (!assets.characters.some((c) => c.name === name)) assets.characters.push({ name, scene: gltf.scene, clips, bounds, special: !!special });
    } else {
      const scene = KITS[kit].format === 'obj' ? await loadObj(kit, file) : (await gltfLoader.loadAsync(`${ASSET_URL}models/${kit}/${file}.glb`)).scene;
      const ground = GROUND.has(name);
      const geometry = mergeScene(scene, SCALE_OVERRIDE[name] || KITS[kit].scale, false);
      register(assets, name, geometry, mats[ground ? 'ground' : 'object'], ground);
    }
    tick();
  })).then(() => Promise.all(texJobs)).then(() => {
    assets.characters.sort((a, b) => a.name.localeCompare(b.name));
    return assets;
  });
  assets.packs.set(packName, work);
  return work;
}

// Builds a new model out of existing ones (e.g. a whole town as one object for the region stage).
// parts: [{ model, x, z, rot, s, y }]; every part has to come from the same kit so they share a texture.
export function compose(assets, name, parts, scale = 1) {
  if (assets.models[name]) return assets.models[name];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const geos = parts.map((p) => {
    const src = assets.models[p.model];
    if (!src) throw new Error(`compose: unknown model ${p.model}`);
    const s = (p.s || 1) * scale;
    return src.geometry.clone().applyMatrix4(m.compose(new THREE.Vector3(p.x * scale, (p.y || 0) * scale, p.z * scale), q.setFromAxisAngle(up, p.rot || 0), new THREE.Vector3(s, s * (p.sy || 1), s)));
  });
  return register(assets, name, mergeGeometries(geos, false), assets.models[parts[0].model].material, false);
}

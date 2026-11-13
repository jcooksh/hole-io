// Loads the CC0 model kits (see CREDITS.md) and turns each model into a single
// merged geometry so the whole city can be drawn with instancing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ASSET_URL = new URL('../assets/', import.meta.url).href;

export const MAX_HOLES = 8;

// Uniforms shared by every patched material.
export const uniforms = {
  uHoles: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector3(0, 0, 0)) },
  uPlayer: { value: new THREE.Vector3() },
  uReveal: { value: 0 },
  uFade: { value: 10 },
};

// World units are metres. Each kit is authored at its own scale.
const KITS = {
  roads: { scale: 10, tex: true },
  commercial: { scale: 10, tex: true },
  suburban: { scale: 10, tex: true },
  cars: { scale: 1.6, tex: true },
  nature: { scale: 5, tex: false },
  characters: { scale: 2.6, tex: true },
};

const GROUND = new Set([
  'roads/road-straight', 'roads/road-crossroad', 'roads/road-intersection', 'roads/road-bend',
  'roads/road-crossing', 'roads/tile-low', 'nature/ground_grass',
]);

const SCALE_OVERRIDE = {
  'nature/ground_grass': 10,
  'cars/firetruck': 2.0, 'cars/garbage-truck': 2.0, 'cars/delivery': 1.9, 'cars/delivery-flat': 1.9,
  'cars/ambulance': 1.9, 'cars/truck': 1.8, 'cars/truck-flat': 1.8, 'cars/tractor': 1.7,
  'nature/statue_obelisk': 8, 'nature/statue_column': 7, 'nature/statue_head': 8,
  'nature/tent_detailedOpen': 6, 'nature/rock_largeA': 6,
};

const MODELS = {
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
    'building-type-t', 'tree-large', 'tree-small', 'planter', 'fence'],
  cars: ['sedan', 'sedan-sports', 'suv', 'suv-luxury', 'taxi', 'police', 'van', 'truck', 'truck-flat',
    'hatchback-sports', 'delivery', 'delivery-flat', 'ambulance', 'firetruck', 'garbage-truck', 'race',
    'tractor', 'box', 'cone'],
  nature: ['ground_grass', 'tree_oak', 'tree_default', 'tree_detailed', 'tree_fat', 'tree_pineRoundA',
    'plant_bush', 'plant_bushLarge', 'flower_redA', 'flower_yellowA', 'flower_purpleA', 'rock_largeA',
    'rock_smallA', 'statue_obelisk', 'statue_column', 'statue_head', 'mushroom_red', 'stump_round',
    'log_stack', 'tent_detailedOpen', 'sign', 'pot_large'],
};

export const CHARACTERS = ['character-male-a', 'character-male-b', 'character-male-c', 'character-male-d',
  'character-female-a', 'character-female-b', 'character-female-c', 'character-female-d', 'character-worker'];
export const CHARACTER_SCALE = KITS.characters.scale;

const HOLE_GLSL = `
uniform vec3 uHoles[${MAX_HOLES}];
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
    if (kind === 'ground') {
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
    const c = o.material.map ? new THREE.Color(1, 1, 1) : o.material.color;
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
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

export async function loadAssets(onProgress) {
  // The kits all point at "Textures/colormap.png"; load one shared copy per kit
  // instead of letting every GLB decode its own.
  const blank = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (/\.png($|\?)/.test(url) && !url.startsWith('data:') ? blank : url));
  const loader = new GLTFLoader(manager);
  const texLoader = new THREE.TextureLoader();

  const materials = {};
  const texJobs = [];
  for (const [kit, cfg] of Object.entries(KITS)) {
    let map = null;
    if (cfg.tex) {
      texJobs.push(texLoader.loadAsync(`${ASSET_URL}models/${kit}/Textures/colormap.png`).then((t) => {
        t.flipY = false;
        t.colorSpace = THREE.SRGBColorSpace;
        for (const m of Object.values(materials[kit])) { m.map = t; m.needsUpdate = true; }
      }));
    }
    const skinned = kit === 'characters';
    materials[kit] = {
      object: patch(new THREE.MeshLambertMaterial({ map, vertexColors: !skinned, side: THREE.DoubleSide }), 'object'),
      ground: patch(new THREE.MeshLambertMaterial({ map, vertexColors: true }), 'ground'),
    };
  }

  const jobs = [];
  for (const [kit, names] of Object.entries(MODELS)) for (const n of names) jobs.push({ kit, file: n });
  for (const n of CHARACTERS) jobs.push({ kit: 'characters', file: n });
  let done = 0;
  const total = jobs.length + texJobs.length;
  const tick = () => onProgress && onProgress(++done / total);
  texJobs.forEach((j) => j.then(tick));

  const models = {};
  const characters = [];
  await Promise.all(jobs.map(async ({ kit, file }) => {
    const gltf = await loader.loadAsync(`${ASSET_URL}models/${kit}/${file}.glb`);
    const name = `${kit}/${file}`;
    if (kit === 'characters') {
      gltf.scene.traverse((o) => {
        if (o.isMesh) { o.material = materials.characters.object; o.castShadow = true; }
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
      characters.push({ name, scene: gltf.scene, clips, bounds });
    } else {
      const ground = GROUND.has(name);
      const geometry = mergeScene(gltf.scene, SCALE_OVERRIDE[name] || KITS[kit].scale, false);
      const size = geometry.boundingBox.getSize(new THREE.Vector3());
      models[name] = {
        name, geometry, ground, size,
        material: materials[kit][ground ? 'ground' : 'object'],
        footprint: 0.5 * Math.sqrt(size.x * size.z),
        halfDiag: 0.5 * Math.hypot(size.x, size.z),
        height: size.y,
      };
    }
    tick();
  }));
  await Promise.all(texJobs);
  characters.sort((a, b) => a.name.localeCompare(b.name));
  return { models, characters, materials };
}

// The two alternative first stages: a medieval town and a colony on another planet.
// They share the street grid of the modern city (see city.js), so traffic and pedestrians work
// the same way; only what stands on the blocks differs.
import * as THREE from 'three';
import { TILE, GRID, STEP, HALF, NODES, mulberry32 } from './city.js';
import { compose } from './assets.js';

const BLOCKS = NODES - 1;
const TAU = Math.PI * 2;

// ---- shared scaffolding -------------------------------------------------------
export function generateMap(seed, theme, assets) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const range = (a, b) => a + rnd() * (b - a);
  const chance = (p) => rnd() < p;
  const spin = () => rnd() * TAU;
  const ground = [], props = [], people = [], traffic = [];
  const tile = (model, x, z, rot = 0, y = 0) => ground.push({ model, x, z, rot, y });
  const prop = (model, x, z, rot = 0, y = 0, s = 1) => props.push({ model, x, z, rot, y, s });
  const pet = (model, cx, cz, half, y) => props.push({ model, x: cx + range(-half, half), z: cz + range(-half, half), rot: spin(), y, s: 1, pet: { cx, cz, half } });
  const H = { rnd, pick, range, chance, spin, prop, pet, people };

  // streets
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    const ri = i % STEP === 0, rj = j % STEP === 0;
    if (!ri && !rj) continue;
    const x = (i - HALF) * TILE, z = (j - HALF) * TILE;
    tile(theme.road.model, x, z, 0, theme.road.y);
    if (ri && rj) continue;
    const alongX = rj, m = (alongX ? i : j) % STEP, base = alongX ? 0 : Math.PI / 2;
    const put = (model, u, v, rot = 0, s = 1) => {
      const [px, pz] = alongX ? [x + u, z + v] : [x + v, z - u];
      prop(model, px, pz, rot + base, theme.road.top, s);
    };
    theme.roadside({ ...H, put, m });
  }

  // blocks
  const kinds = [];
  for (let bi = 0; bi < BLOCKS; bi++) {
    kinds.push([]);
    for (let bj = 0; bj < BLOCKS; bj++) {
      const d = Math.max(Math.abs(bi - (BLOCKS - 1) / 2), Math.abs(bj - (BLOCKS - 1) / 2));
      kinds[bi].push(d < 1 ? theme.zones[0] : d < 2 ? theme.zones[1] : theme.zones[2]);
    }
  }
  for (const [kind, count] of theme.swaps) {
    for (let n = 0, guard = 0; n < count && guard < 300; guard++) {
      const bi = Math.floor(rnd() * BLOCKS), bj = Math.floor(rnd() * BLOCKS);
      if (kinds[bi][bj] !== theme.zones[1] && kinds[bi][bj] !== theme.zones[2]) continue;
      kinds[bi][bj] = kind; n++;
    }
  }
  for (let bi = 0; bi < BLOCKS; bi++) for (let bj = 0; bj < BLOCKS; bj++) {
    const cx = ((bi * STEP + STEP / 2) - HALF) * TILE, cz = ((bj * STEP + STEP / 2) - HALF) * TILE;
    const kind = kinds[bi][bj], floor = theme.floor[kind] || theme.floor.default, gy = floor.top;
    for (let a = 0; a < STEP - 1; a++) for (let b = 0; b < STEP - 1; b++) tile(floor.model, cx - 15 + a * TILE, cz - 15 + b * TILE, 0, floor.y);
    // keep-out circles so scattered props do not end up inside buildings
    const taken = [];
    const free = (x, z, r) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
    const solid = (model, lx, lz, rot, r, s = 1) => { prop(model, cx + lx, cz + lz, rot, gy, s); taken.push({ x: lx, z: lz, r }); };
    // scatter(models, how many, keep-out radius, [scale range], [half-size of the area])
    const scatter = (models, count, r, s = [1, 1], half = 18.5) => {
      for (let k = 0; k < count; k++) for (let t = 0; t < 20; t++) {
        const lx = range(-half, half), lz = range(-half, half);
        if (!free(lx, lz, r)) continue;
        prop(Array.isArray(models) ? pick(models) : models, cx + lx, cz + lz, spin(), gy, range(s[0], s[1]));
        taken.push({ x: lx, z: lz, r });
        break;
      }
    };
    const faceOut = (lx, lz) => (Math.abs(lx) > Math.abs(lz) || (Math.abs(lx) === Math.abs(lz) && chance(0.5))
      ? (lx > 0 ? Math.PI / 2 : -Math.PI / 2) : (lz > 0 ? 0 : Math.PI));
    const walkers = (n, cast) => { for (let k = 0; k < n; k++) people.push({ x: cx, z: cz, loop: { cx, cz, half: 20.5, dir: chance(0.5) ? 1 : -1 }, cast }); };
    const loiterers = (n, half, cast) => { for (let k = 0; k < n; k++) people.push({ x: cx + range(-half, half), z: cz + range(-half, half), wander: { cx, cz, half }, cast }); };
    theme.blocks[kind]({ ...H, cx, cz, gy, taken, solid, scatter, faceOut, walkers, loiterers, here: (m, lx, lz, rot = 0, s = 1) => prop(m, cx + lx, cz + lz, rot, gy, s), animal: (m, half) => pet(m, cx, cz, half, gy) });
  }

  for (let k = 0; k < theme.traffic.count; k++) {
    traffic.push({ model: pick(theme.traffic.models), node: [Math.floor(rnd() * NODES), Math.floor(rnd() * NODES)], dir: Math.floor(rnd() * 4), t: rnd(), y: theme.traffic.y, speed: theme.traffic.speed });
  }
  return { ground, props, people, traffic, rnd };
}

// ---- medieval ------------------------------------------------------------------
const HEX_HOMES = ['house', 'village', 'cabin', 'market', 'smelter', 'mill', 'watermill', 'archery', 'mine'].map((n) => `hexagon/building-${n}`);
const HEX_GRAND = ['hexagon/building-tower', 'hexagon/building-wizard-tower', 'hexagon/building-castle', 'hexagon/building-market'];
const COTTAGES = ['hexagon/unit-house', 'hexagon/unit-house', 'hexagon/unit-mansion', 'hexagon/unit-mill', 'hexagon/unit-wall-tower'];
const MED_TREES = ['fantasy/tree', 'fantasy/tree-high', 'fantasy/tree-crooked', 'fantasy/tree-high-round', 'hexagon/unit-tree'];
const CLUTTER = ['pirate/barrel', 'pirate/crate', 'pirate/crate-bottles', 'pirate/chest', 'pirate/barrel', 'fantasy/wheel', 'fantasy/stall-bench'];
const SIEGE = ['castle/siege-catapult', 'castle/siege-trebuchet', 'castle/siege-ballista', 'castle/siege-ram', 'castle/siege-tower'];
const FLAGS = ['castle/flag', 'castle/flag-pennant', 'castle/flag-wide', 'castle/flag-banner-long', 'pirate/flag-high', 'pirate/flag-high-pennant'];
const WILD = ['nature/flower_redA', 'nature/flower_yellowA', 'nature/flower_purpleA', 'nature/mushroom_red', 'nature/plant_bush', 'nature/rock_smallA', 'nature/stump_round'];
const KNIGHTS = ['characters/character-knight', 'characters/character-raider'];
const FARM = ['pets/animal-cow', 'pets/animal-pig', 'pets/animal-chick', 'pets/animal-chick', 'pets/animal-dog'];

export const medieval = {
  id: 'medieval', name: 'Medieval', title: 'Kingdom', done: 'The kingdom has fallen in', pack: 'medieval', blurb: 'Castle, market town and siege camp',
  cast: ['characters/character-male-b', 'characters/character-female-c', 'characters/character-male-e', 'characters/character-female-a',
    'characters/character-male-d', 'characters/character-female-e', 'characters/character-knight'],
  road: { model: 'fantasy/road', y: 0.02, top: 0.32 },
  floor: { default: { model: 'nature/ground_grass', y: 0.02, top: 0.02 } },
  zones: ['castle', 'town', 'village'],
  swaps: [['forest', 6], ['camp', 4]],
  traffic: { models: ['fantasy/cart', 'fantasy/cart-high'], count: 22, y: 0.32, speed: 2.6 },
  sky: { color: 0xbfe6ff, fog: [300, 900] },
  prepare(assets) {
    if (assets.models['med/castle']) return;
    const stack = (name, pieces) => {
      let y = 0;
      compose(assets, name, pieces.map((p) => { const part = { model: `castle/${p}`, x: 0, z: 0, y }; y += assets.models[`castle/${p}`].height; return part; }));
    };
    stack('med/tower-a', ['tower-square-base', 'tower-square-mid-windows', 'tower-square-top-roof']);
    stack('med/tower-b', ['tower-square-base', 'tower-square-mid-door', 'tower-square-mid-windows', 'tower-square-top-roof-high-windows']);
    stack('med/tower-c', ['tower-square-base', 'tower-square-mid', 'tower-square-mid-windows', 'tower-square-mid', 'tower-square-top-roof-high']);
    // a keep: four corner towers joined by walls around a tall central tower
    const U = assets.models['castle/wall'].size.x, parts = [{ model: 'med/tower-c', x: 0, z: 0, s: 1.25 }];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push({ model: 'med/tower-a', x: sx * U * 1.05, z: sz * U * 1.05 });
    for (const s of [-1, 1]) { parts.push({ model: 'castle/wall', x: 0, z: s * U * 1.05 }); parts.push({ model: 'castle/wall', x: s * U * 1.05, z: 0, rot: Math.PI / 2 }); }
    compose(assets, 'med/castle', parts, 0.8);
    compose(assets, 'med/wall', [-1, 0, 1].map((k) => ({ model: 'castle/wall', x: k * U, z: 0 })), 0.75);
  },
  roadside({ put, m, pick, range, chance, spin }) {
    if (m === 2) put('fantasy/lantern', 0, 4.6);
    if (m === 4) put('fantasy/lantern', 0, -4.6);
    if (m === 3 && chance(0.35)) put(pick(['fantasy/banner-green', 'fantasy/banner-red']), range(-3, 3), (chance(0.5) ? 1 : -1) * 4.7, Math.PI / 2);
    if (chance(0.45)) put(pick(CLUTTER), range(-4.5, 4.5), (chance(0.5) ? 1 : -1) * 4.4, spin());
    if (chance(0.16)) put(pick(['fantasy/hedge', 'fantasy/fence']), range(-3, 3), (chance(0.5) ? 1 : -1) * 4.8, Math.PI / 2);
  },
  blocks: {
    castle({ solid, scatter, loiterers, walkers, pick, chance, spin }) {
      solid('med/castle', 0, 0, chance(0.5) ? 0 : Math.PI / 2, 15.5);
      for (const [lx, lz] of [[-15, -15], [15, 15]]) if (chance(0.7)) solid(pick(['pirate/tower-complete-large', 'pirate/tower-complete-small', 'pirate/tower-watch']), lx, lz, spin(), 4.2);
      if (chance(0.6)) solid('med/wall', 0, 17.5, 0, 4);
      scatter(SIEGE, 2, 4.2);
      scatter(['pirate/cannon', 'pirate/cannon-mobile'], 5, 1.6);
      scatter(FLAGS, 8, 0.9);
      scatter(CLUTTER, 14, 0.9);
      scatter('fantasy/lantern', 4, 0.6);
      loiterers(3, 18, KNIGHTS); walkers(2, KNIGHTS);
    },
    town({ solid, scatter, here, faceOut, walkers, loiterers, pick, range, chance, spin }) {
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) solid(pick(chance(0.25) ? HEX_GRAND : HEX_HOMES), sx * 11.5, sz * 11.5, faceOut(sx, sz * 2) + (chance(0.5) ? 0 : Math.PI / 3), 7.6);
      solid(pick(['fantasy/fountain-round-detail', 'fantasy/fountain-square-detail']), 0, 0, 0, 3.4);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + Math.PI / 4;
        if (chance(0.8)) here(pick(['fantasy/stall-green', 'fantasy/stall-red', 'fantasy/stall']), Math.cos(a) * 7.5, Math.sin(a) * 7.5, -a + Math.PI / 2);
      }
      scatter(['med/tower-a', 'med/tower-b'], 1, 4.6, [0.55, 0.7]);
      scatter(['fantasy/cart', 'fantasy/cart-high'], 2, 2.2);
      scatter(COTTAGES, 2, 3.4);
      scatter(MED_TREES, 3, 1.8);
      scatter(CLUTTER, 14, 0.9);
      scatter(FLAGS, 3, 0.9);
      scatter('fantasy/lantern', 3, 0.6);
      scatter(['fantasy/hedge', 'fantasy/hedge-large'], 4, 1.4);
      walkers(3); loiterers(1, 8);
    },
    village({ solid, scatter, here, walkers, animal, pick, range, chance, spin }) {
      if (chance(0.75)) solid(pick(['hexagon/building-farm', 'hexagon/building-sheep', 'hexagon/building-cabin', 'hexagon/building-house']), pick([-10, 10]), pick([-10, 10]), spin(), 7.6);
      scatter(COTTAGES, 7, 3.6);
      scatter(MED_TREES, 9, 1.8, [0.9, 1.3]);
      scatter('castle/tree-large', 2, 2.6);
      scatter(['fantasy/cart', 'fantasy/cart-high'], 2, 2.2);
      scatter(['fantasy/hedge', 'fantasy/hedge-large', 'fantasy/fence'], 8, 1.4);
      scatter(['castle/tree-log', 'castle/tree-trunk', 'fantasy/wheel'], 4, 1);
      scatter(CLUTTER, 8, 0.9);
      scatter(WILD, 12, 0.8, [0.9, 1.3]);
      if (chance(0.3)) scatter(SIEGE, 1, 4);
      for (let k = 0; k < 3; k++) animal(pick(FARM), 14);
      walkers(2);
    },
    forest({ solid, scatter, loiterers, animal, pick, chance, spin }) {
      if (chance(0.6)) solid(pick(['pirate/tower-complete-small', 'pirate/tower-watch', 'hexagon/building-cabin', 'hexagon/unit-tower']), 0, 0, spin(), 5);
      scatter('castle/tree-large', 9, 2.5, [0.9, 1.4]);
      scatter('castle/tree-small', 7, 2, [0.9, 1.3]);
      scatter(MED_TREES, 16, 1.7, [0.9, 1.4]);
      scatter(['fantasy/rock-large', 'fantasy/rock-wide', 'castle/rocks-large', 'pirate/rocks-a'], 5, 3);
      scatter(['fantasy/rock-small', 'castle/rocks-small'], 4, 2);
      scatter(['castle/tree-log', 'castle/tree-trunk', 'nature/log_stack'], 6, 1.2);
      if (chance(0.6)) { scatter('nature/campfire_stones', 1, 2); scatter('nature/tent_detailedOpen', 1, 3.2); }
      scatter(WILD, 26, 0.8, [0.9, 1.4]);
      animal('pets/animal-dog', 14);
      loiterers(2, 16);
    },
    camp({ solid, scatter, loiterers, pick, chance, spin }) {
      scatter(SIEGE, 5, 4.2);
      scatter('nature/tent_detailedOpen', 5, 3.2);
      if (chance(0.7)) solid(pick(['pirate/tower-watch', 'pirate/tower-complete-small']), pick([-13, 13]), pick([-13, 13]), spin(), 4);
      scatter(['pirate/cannon', 'pirate/cannon-mobile'], 4, 1.6);
      scatter(FLAGS, 9, 0.9);
      scatter('nature/campfire_stones', 2, 2);
      scatter(CLUTTER, 16, 0.9);
      scatter(['castle/tree-log', 'nature/log_stack'], 4, 1.2);
      scatter(['fantasy/cart', 'fantasy/cart-high'], 2, 2.2);
      loiterers(4, 17, KNIGHTS);
    },
  },
};

// ---- a colony on another planet ---------------------------------------------------
const CRAFT = [1, 2, 3, 4, 5, 6].map((n) => `spacekit/spaceCraft${n}`);
const HABS = ['spacekit/buildingOpen', 'spacekit/buildingCorner', 'spacekit/buildingCorridor', 'fut/tower-2'];
const TECH = ['spacekit/barrel', 'spacekit/barrel', 'station/container', 'station/container-flat', 'station/container-tall', 'station/container-wide',
  'station/computer', 'station/computer-screen', 'station/computer-system', 'station/chair', 'station/table-display', 'station/table-display-planet',
  'spacekit/console', 'spacekit/consoleScreen', 'station/skip', 'station/pipe'];
const ROCKS = ['spacekit/rocks', 'spacekit/rocksOre', 'spacekit/rocksSmall', 'spacekit/rocksTall', 'spacekit/rocksTallOre', 'station/rocks', 'station/skip-rocks'];
const CREW = ['characters/character-robot', 'characters/character-alien', 'characters/character-soldier'];

export const future = {
  id: 'future', name: 'Futuristic', title: 'Colony', done: 'The colony is gone', pack: 'future', blurb: 'Colony, spaceport and crater fields',
  cast: ['characters/character-robot', 'characters/character-alien', 'characters/character-soldier', 'characters/character-male-a', 'characters/character-female-b'],
  road: { model: 'spacekit/metalTile', y: -0.5, top: 0.32 },
  floor: { default: { model: 'spacekit/groundTile', y: 0.03, top: 0.03 }, rocks: { model: 'spacekit/groundTileRough', y: -0.55, top: 0.2 } },
  zones: ['core', 'habs', 'outpost'],
  swaps: [['rocks', 6], ['port', 3]],
  traffic: { models: CRAFT, count: 30, y: 1.6, speed: 9 },
  sky: { color: 0xe8b99a, fog: [260, 800] },
  prepare(assets) {
    if (assets.models['fut/tower-2']) return;
    const h = assets.models['spacekit/buildingCorridor'].height;
    compose(assets, 'fut/tower-2', [{ model: 'spacekit/buildingCorner', x: 0, z: 0 }, { model: 'spacekit/buildingOpen', x: 0, z: 0, y: h }]);
    compose(assets, 'fut/tower-3', [{ model: 'spacekit/buildingCorridor', x: 0, z: 0 }, { model: 'spacekit/buildingCorner', x: 0, z: 0, y: h, rot: Math.PI / 2 }, { model: 'spacekit/buildingOpen', x: 0, z: 0, y: h * 2 }]);
    const parts = [];
    for (const [sx, sz, r] of [[-1, -1, 0], [1, -1, Math.PI / 2], [1, 1, Math.PI], [-1, 1, -Math.PI / 2]]) parts.push({ model: 'spacekit/buildingCorner', x: sx * 5, z: sz * 5, rot: r });
    parts.push({ model: 'spacekit/stationLarge', x: 0, z: 0, y: h });
    compose(assets, 'fut/block', parts);
    const m = assets.models['spacekit/metalStructure'].height;
    compose(assets, 'fut/mast', [{ model: 'spacekit/metalStructureBottom', x: 0, z: 0, s: 0.6 }, { model: 'spacekit/metalStructure', x: 0, z: 0, y: m * 0.6, s: 0.6 },
      { model: 'spacekit/metalStructure', x: 0, z: 0, y: m * 1.2, s: 0.6 }, { model: 'spacekit/satelliteDishAntenna', x: 0, z: 0, y: m * 1.8 }]);
  },
  roadside({ put, m, pick, range, chance, spin }) {
    if (m === 2) put('spacekit/laserSabel', 0, 4.6);
    if (m === 4) put('spacekit/laserSabel', 0, -4.6);
    if (chance(0.45)) put(pick(TECH), range(-4.5, 4.5), (chance(0.5) ? 1 : -1) * 4.4, spin());
    if (m === 3 && chance(0.3)) put('spacekit/metalFence', 0, (chance(0.5) ? 1 : -1) * 4.8);
  },
  blocks: {
    core({ solid, scatter, faceOut, walkers, loiterers, animal, pick, chance, spin }) {
      const big = chance(0.5) ? (chance(0.5) ? 1 : -1) : 0;
      for (const sz of [-1, 1]) {
        if (sz === big) { solid('fut/block', 0, sz * 9.5, sz > 0 ? 0 : Math.PI, 12.5); continue; }
        for (const sx of [-1, 1]) solid(pick(['fut/tower-3', 'fut/tower-3', 'spacekit/stationLarge', 'spacekit/station', 'fut/mast']), sx * 10.5, sz * 10.5, faceOut(sx, sz * 2), 7.6);
      }
      if (chance(0.5)) scatter('spacekit/portal', 1, 5, [0.6, 0.6]);
      scatter(CRAFT, 2, 3.4);
      scatter(['spacekit/satelliteDish', 'spacekit/satelliteDishAntenna'], 2, 3.4);
      scatter(TECH, 22, 0.9);
      scatter('spacekit/laserSabel', 5, 0.5);
      for (let k = 0; k < 2; k++) animal('spacekit/robot', 14);
      walkers(3); loiterers(2, 6, CREW);
    },
    habs({ solid, scatter, faceOut, walkers, loiterers, animal, pick, chance }) {
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) if (chance(0.9)) solid(pick(HABS), sx * 11, sz * 11, faceOut(sx, sz * 2), 7.4);
      scatter(CRAFT, 3, 3.4, [1, 1.15], 7);
      scatter('spacekit/barrelLarge', 1, 3.6);
      scatter(['spacekit/frameHigh', 'spacekit/pipeStand'], 2, 3.6);
      scatter(TECH, 18, 0.9);
      scatter('spacekit/metalFence', 3, 2.8);
      scatter(ROCKS, 3, 2.2);
      animal('spacekit/robot', 14);
      walkers(3); loiterers(1, 7);
    },
    outpost({ solid, scatter, walkers, animal, pick, chance, spin }) {
      if (chance(0.8)) solid(pick(['spacekit/station', 'spacekit/stationLarge', 'spacekit/buildingOpen', 'fut/mast']), pick([-9, 9]), pick([-9, 9]), spin(), 7);
      scatter(['spacekit/satelliteDish', 'spacekit/satelliteDishLarge', 'spacekit/satelliteDishAntenna'], 2, 4.4);
      scatter('spacekit/barrelLarge', 2, 3.6);
      scatter('spacekit/pipeStraight', 2, 4);
      scatter(CRAFT, 2, 3.4, [1, 1.15]);
      scatter(ROCKS, 8, 2.4);
      scatter(['spacekit/crater', 'spacekit/craterLarge'], 2, 4.5, [0.6, 0.8]);
      scatter(['spacekit/frameHigh', 'spacekit/pipeStand', 'spacekit/metalFence'], 3, 3.4);
      scatter(TECH, 14, 0.9);
      for (let k = 0; k < 2; k++) animal('spacekit/robot', 15);
      walkers(2);
    },
    rocks({ scatter, loiterers, animal, chance }) {
      scatter('spacekit/meteorFull', chance(0.7) ? 2 : 1, 7, [0.75, 1]);
      scatter('spacekit/meteorHalf', 3, 4);
      scatter(['spacekit/crater', 'spacekit/craterLarge'], 4, 5);
      scatter(ROCKS, 22, 2.3, [0.8, 1.5]);
      scatter(['station/rocks', 'spacekit/rocksSmall'], 16, 1.3, [0.5, 0.9]);
      scatter('spacekit/satelliteDish', 1, 4);
      scatter(TECH, 6, 0.9);
      animal('spacekit/robot', 16); animal('spacekit/robot', 16);
      loiterers(2, 16, CREW);
    },
    port({ solid, scatter, walkers, loiterers, animal, pick, spin }) {
      for (const [lx, lz] of [[-10, -9], [10, -9], [0, 10]]) solid(pick(CRAFT), lx, lz, spin(), 7.5, 2);
      solid('fut/mast', pick([-15, 15]), 14, 0, 4);
      scatter(CRAFT, 3, 3.4, [1, 1.15]);
      scatter('spacekit/barrelLarge', 3, 3.6);
      scatter('spacekit/spaceCraftStand', 4, 1.6);
      scatter(TECH, 24, 0.9);
      scatter('spacekit/metalFence', 4, 2.8);
      animal('spacekit/robot', 14);
      walkers(3); loiterers(2, 14, CREW);
    },
  },
};

export const THEMES = [
  { id: 'modern', name: 'Modern', title: 'City', done: 'City devoured', pack: 'city', blurb: 'Towers, suburbs and parks' },
  medieval,
  future,
];

// Colour of the land around the map.
export function baseColorFor(theme, assets) {
  if (theme.id === 'future') {
    // rusty ground, a little darker than the buildings so they stand out
    const tint = assets.materials.spacekit.ground.color.setRGB(0.74, 0.66, 0.64);
    return new THREE.Color(0.737, 0.482, 0.322).multiply(tint);
  }
  const grass = assets.models['nature/ground_grass'].geometry.attributes.color;
  const tint = assets.materials.nature.ground.color.setRGB(0.8, 0.74, 0.44);
  return new THREE.Color(grass.getX(0), grass.getY(0), grass.getZ(0)).multiply(tint);
}

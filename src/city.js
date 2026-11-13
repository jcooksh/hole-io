// Procedural city layout. Produces plain placement lists; game.js turns them
// into instanced meshes and simulation objects.

export const TILE = 10;          // metres per road tile
export const GRID = 31;          // tiles per side
export const STEP = 5;           // a road every STEP tiles
export const HALF = (GRID - 1) / 2;
export const NODES = (GRID - 1) / STEP + 1;   // intersections per side
export const BOUND = HALF * TILE + 5.5;       // holes stay inside +-BOUND
const BLOCKS = NODES - 1;

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const nodePos = (n) => (n * STEP - HALF) * TILE;

const CARS = ['cars/sedan', 'cars/sedan-sports', 'cars/suv', 'cars/suv-luxury', 'cars/taxi', 'cars/police',
  'cars/van', 'cars/hatchback-sports', 'cars/race', 'cars/taxi', 'cars/sedan'];
const TRUCKS = ['cars/truck', 'cars/truck-flat', 'cars/delivery', 'cars/delivery-flat', 'cars/ambulance',
  'cars/firetruck', 'cars/garbage-truck', 'cars/tractor'];
const TOWERS = ['commercial/building-skyscraper-a', 'commercial/building-skyscraper-b',
  'commercial/building-skyscraper-c', 'commercial/building-skyscraper-d', 'commercial/building-skyscraper-e',
  'commercial/building-l', 'commercial/building-m', 'commercial/building-i'];
const WIDE = ['commercial/building-n', 'commercial/building-j'];
const SHOPS = ['commercial/building-a', 'commercial/building-b', 'commercial/building-c', 'commercial/building-d',
  'commercial/building-f', 'commercial/building-g', 'commercial/building-h'];
const SHOPS_WIDE = ['commercial/building-e', 'commercial/building-k'];
const HOUSES = 'abcdefghjklmnqst'.split('').map((c) => `suburban/building-type-${c}`);
const PARK_TREES = ['nature/tree_oak', 'nature/tree_default', 'nature/tree_detailed', 'nature/tree_fat',
  'nature/tree_pineRoundA'];
const SMALL_NATURE = ['nature/flower_redA', 'nature/flower_yellowA', 'nature/flower_purpleA',
  'nature/mushroom_red', 'nature/plant_bush', 'nature/plant_bushLarge', 'nature/rock_smallA',
  'nature/stump_round', 'nature/pot_large'];

export function generateCity(seed) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const range = (a, b) => a + rnd() * (b - a);
  const chance = (p) => rnd() < p;
  const spin = () => rnd() * Math.PI * 2;

  const ground = [];   // { model, x, z, rot, y }
  const props = [];    // { model, x, z, rot, y, s }
  const people = [];   // { x, z, loop: {cx, cz, half, dir} | wander: {cx, cz, half} }
  const traffic = [];  // { model, node: [i, j], dir }

  const tile = (model, x, z, rot = 0, y = 0) => ground.push({ model, x, z, rot, y });
  const prop = (model, x, z, rot = 0, y = 0, s = 1) => props.push({ model, x, z, rot, y, s });

  // ---- roads -------------------------------------------------------------
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const ri = i % STEP === 0, rj = j % STEP === 0;
      if (!ri && !rj) continue;
      const x = (i - HALF) * TILE, z = (j - HALF) * TILE;
      if (ri && rj) {
        const left = i > 0, right = i < GRID - 1, up = j > 0, down = j < GRID - 1;
        const n = left + right + up + down;
        if (n === 4) {
          tile('roads/road-crossroad', x, z);
          if (chance(0.6)) {
            for (const [sx, sz, r] of [[1, 1, 0], [-1, -1, Math.PI], [1, -1, Math.PI / 2], [-1, 1, -Math.PI / 2]]) {
              prop('roads/traffic-light', x + sx * 4.5, z + sz * 4.5, r, 0.2);
            }
          }
        } else if (n === 3) {
          tile('roads/road-intersection', x, z, !up ? 0 : !down ? Math.PI : !left ? Math.PI / 2 : -Math.PI / 2);
        } else {
          tile('roads/road-bend', x, z, !left && !up ? Math.PI / 2 : !right && !up ? 0 : !right && !down ? -Math.PI / 2 : Math.PI);
        }
        continue;
      }
      // Straight piece. Work in road-local coordinates: u along the road, v across it.
      const alongX = rj;
      const m = (alongX ? i : j) % STEP;
      const base = alongX ? 0 : Math.PI / 2;
      const at = (u, v) => (alongX ? [x + u, z + v] : [x + v, z - u]);
      const put = (model, u, v, rot = 0, y = 0.2, s = 1) => { const [px, pz] = at(u, v); prop(model, px, pz, rot + base, y, s); };
      tile((m === 1 || m === 4) && chance(0.55) ? 'roads/road-crossing' : 'roads/road-straight', x, z, base);

      if (m === 2) put(pick(['roads/light-square', 'roads/light-curved']), 0, 4.5, 0);
      if (m === 4) put(pick(['roads/light-square', 'roads/light-curved']), 0, -4.5, Math.PI);
      if (m === 1 && chance(0.7)) put(pick(['roads/road-sign-stop', 'roads/road-sign-warning', 'roads/road-sign-street']), -3.4, -4.5, 0);
      if (m === 4 && chance(0.7)) put(pick(['roads/road-sign-stop', 'roads/road-sign-warning', 'roads/road-sign-street']), 3.4, 4.5, Math.PI);
      if (m === 3 && chance(0.07)) put('roads/sign-highway', 0, 0, 0, 0.2);
      if ((m === 2 || m === 3) && chance(0.16)) {
        // little roadworks strip along the kerb
        const side = chance(0.5) ? 1 : -1;
        const n = 3 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) put(chance(0.75) ? 'cars/cone' : 'roads/construction-cone', -4 + k * (8 / n) + range(-0.3, 0.3), side * 3.45, spin(), 0.1);
        if (chance(0.6)) put('roads/construction-barrier', range(-2, 2), side * 4.5, Math.PI / 2, 0.2);
        if (chance(0.5)) put('roads/construction-light', range(-4, 4), side * 4.4, 0, 0.2);
      }
      if (chance(0.3)) put(pick(['cars/box', 'cars/cone', 'roads/construction-cone', 'cars/box']), range(-4.5, 4.5), (chance(0.5) ? 1 : -1) * 4.5, spin(), 0.2);
    }
  }

  // ---- blocks ------------------------------------------------------------
  // Decide what each block is: towers in the middle, shops around, houses outside, a few parks.
  const kinds = [];
  for (let bi = 0; bi < BLOCKS; bi++) {
    kinds.push([]);
    for (let bj = 0; bj < BLOCKS; bj++) {
      const d = Math.max(Math.abs(bi - (BLOCKS - 1) / 2), Math.abs(bj - (BLOCKS - 1) / 2));
      kinds[bi].push(d < 1 ? 'downtown' : d < 2 ? 'shops' : 'homes');
    }
  }
  let parks = 0;
  for (let guard = 0; parks < 5 && guard < 200; guard++) {
    const bi = Math.floor(rnd() * BLOCKS), bj = Math.floor(rnd() * BLOCKS);
    if (kinds[bi][bj] === 'downtown' || kinds[bi][bj] === 'park') continue;
    kinds[bi][bj] = 'park'; parks++;
  }

  for (let bi = 0; bi < BLOCKS; bi++) {
    for (let bj = 0; bj < BLOCKS; bj++) {
      const cx = ((bi * STEP + STEP / 2) - HALF) * TILE;
      const cz = ((bj * STEP + STEP / 2) - HALF) * TILE;
      const kind = kinds[bi][bj];
      const paved = kind === 'downtown' || kind === 'shops';
      const gy = paved ? 0.2 : 0.02;
      for (let a = 0; a < STEP - 1; a++) for (let b = 0; b < STEP - 1; b++) {
        tile(paved ? 'roads/tile-low' : 'nature/ground_grass', cx - 15 + a * TILE, cz - 15 + b * TILE, 0, paved ? 0 : 0.02);
      }

      // Keep-out circles so scattered props do not end up inside buildings.
      const taken = [];
      const free = (x, z, r) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
      const solid = (model, lx, lz, rot, r, s = 1) => { prop(model, cx + lx, cz + lz, rot, gy, s); taken.push({ x: lx, z: lz, r }); };
      const scatter = (model, r, s = 1, half = 18.5, tries = 20) => {
        for (let t = 0; t < tries; t++) {
          const lx = range(-half, half), lz = range(-half, half);
          if (!free(lx, lz, r)) continue;
          prop(model, cx + lx, cz + lz, spin(), gy, s); taken.push({ x: lx, z: lz, r });
          return true;
        }
        return false;
      };
      // Small street clutter along the pavement edge of a block.
      const edge = (n, models) => {
        for (let k = 0; k < n; k++) {
          const t = range(-18, 18), side = Math.floor(rnd() * 4);
          const [lx, lz] = side === 0 ? [t, 18.9] : side === 1 ? [t, -18.9] : side === 2 ? [18.9, t] : [-18.9, t];
          prop(pick(models), cx + lx, cz + lz, spin(), gy);
        }
      };
      // Rotation that makes a building's front (+Z) face the street nearest to its lot.
      const faceOut = (lx, lz) => {
        const useX = Math.abs(lx) > Math.abs(lz) ? true : Math.abs(lx) < Math.abs(lz) ? false : chance(0.5);
        return useX ? (lx > 0 ? Math.PI / 2 : -Math.PI / 2) : (lz > 0 ? 0 : Math.PI);
      };

      if (kind === 'downtown') {
        const wideSide = chance(0.5) ? (chance(0.5) ? 1 : -1) : 0;
        for (const sz of [-1, 1]) {
          if (sz === wideSide) { solid(pick(WIDE), 0, sz * 9.5, sz > 0 ? 0 : Math.PI, 12); continue; }
          for (const sx of [-1, 1]) solid(pick(TOWERS), sx * 10.5, sz * 10.5, faceOut(sx * (chance(0.5) ? 2 : 1), sz), 8.2);
        }
        for (let k = 0; k < 4; k++) scatter('roads/dumpster', 2);
        for (let k = 0; k < 6; k++) scatter('cars/box', 0.8);
        for (let k = 0; k < 5; k++) scatter('cars/cone', 0.5);
        for (let k = 0; k < 3; k++) scatter('suburban/planter', 2.2);
        for (let k = 0; k < 2; k++) scatter(pick(['commercial/detail-parasol-a', 'commercial/detail-parasol-b']), 2.2);
        for (let k = 0; k < 2; k++) scatter('suburban/tree-small', 1.4);
        edge(12, ['cars/box', 'cars/cone', 'suburban/tree-small', 'nature/pot_large', 'roads/construction-cone', 'suburban/tree-small']);
        for (let k = 0; k < 5; k++) people.push({ x: cx, z: cz, loop: { cx, cz, half: 20.5, dir: chance(0.5) ? 1 : -1 } });
      } else if (kind === 'shops') {
        const L = 13.4;
        const wide = chance(0.6) ? (chance(0.5) ? 1 : -1) : 0;
        for (const lz of [-1, 0, 1]) for (const lx of [-1, 0, 1]) {
          if (lx === 0 && lz === 0) continue;
          if (lz === wide) {
            if (lx === 0) continue;
            if (lx === -1) { solid(pick(SHOPS_WIDE), -7, lz * L, lz > 0 ? 0 : Math.PI, 9.5); continue; }
          }
          solid(pick(SHOPS), lx * L, lz * L, faceOut(lx, lz), 6.4);
        }
        if (chance(0.5)) {
          // car park in the courtyard
          for (let k = -1; k <= 1; k++) if (chance(0.8)) solid(pick(CARS), k * 3.4, range(-0.6, 0.6), chance(0.5) ? 0 : Math.PI, 2.2);
        } else {
          for (let k = 0; k < 3; k++) scatter(pick(['commercial/detail-parasol-a', 'commercial/detail-parasol-b']), 2.2, 1, 5);
          for (let k = 0; k < 2; k++) scatter('suburban/planter', 2, 1, 5.5);
        }
        for (let k = 0; k < 5; k++) scatter('cars/box', 0.8);
        for (let k = 0; k < 4; k++) scatter('cars/cone', 0.5);
        for (let k = 0; k < 2; k++) scatter('roads/dumpster', 2);
        for (let k = 0; k < 2; k++) scatter('suburban/tree-small', 1.4);
        scatter('roads/construction-fence', 2);
        edge(9, ['cars/box', 'cars/cone', 'suburban/tree-small', 'nature/pot_large', 'nature/plant_bush']);
        for (let k = 0; k < 4; k++) people.push({ x: cx, z: cz, loop: { cx, cz, half: 20.5, dir: chance(0.5) ? 1 : -1 } });
        for (let k = 0; k < 1; k++) people.push({ x: cx + range(-4, 4), z: cz + range(-4, 4), wander: { cx, cz, half: 5 } });
      } else if (kind === 'homes') {
        for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
          const lx = sx * 9.5, lz = sz * 9;
          solid(pick(HOUSES), lx, lz, faceOut(sx, sz * 2), 9.5);
          // front yard: a parked car or a planter
          if (chance(0.5)) prop(pick(CARS), cx + lx + range(-3, 3), cz + sz * 17.8, chance(0.5) ? Math.PI / 2 : -Math.PI / 2, gy);
          else if (chance(0.7)) prop('suburban/planter', cx + lx + range(-4, 4), cz + sz * 17.8, 0, gy);
        }
        taken.push({ x: 0, z: 0, r: 4 });
        for (let k = -3; k <= 3; k++) if (k !== 0 && chance(0.8)) prop('suburban/fence', cx + k * 4.9, cz, 0, gy);
        for (let k = 0; k < 5; k++) scatter(pick(['suburban/tree-large', 'suburban/tree-small', 'suburban/tree-large']), 1.5, range(0.9, 1.3));
        if (chance(0.5)) scatter(pick(PARK_TREES), 2.2, range(1.0, 1.4));
        for (let k = 0; k < 10; k++) scatter(pick(SMALL_NATURE), 0.9, range(0.9, 1.3));
        for (let k = 0; k < 3; k++) scatter('cars/box', 0.8);
        for (let k = 0; k < 3; k++) people.push({ x: cx, z: cz, loop: { cx, cz, half: 20.5, dir: chance(0.5) ? 1 : -1 } });
      } else {
        // park
        const centre = pick(['nature/statue_obelisk', 'nature/statue_head', 'nature/statue_column']);
        solid(centre, 0, 0, 0, 3.5);
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          prop(pick(['nature/flower_redA', 'nature/flower_yellowA', 'nature/flower_purpleA']), cx + Math.cos(a) * 5, cz + Math.sin(a) * 5, spin(), gy, 1.2);
        }
        taken.push({ x: 0, z: 0, r: 6 });
        for (let k = 0; k < 3; k++) scatter(pick(PARK_TREES), 3.6, range(1.5, 1.75));
        for (let k = 0; k < 11; k++) scatter(pick(PARK_TREES), 2.4, range(0.9, 1.25));
        if (chance(0.7)) scatter('nature/tent_detailedOpen', 3.2);
        for (let k = 0; k < 2; k++) scatter('nature/rock_largeA', 3.2);
        scatter('nature/log_stack', 2);
        scatter('nature/sign', 1);
        for (let k = 0; k < 26; k++) scatter(pick(SMALL_NATURE), 0.8, range(0.9, 1.4));
        for (let k = 0; k < 5; k++) people.push({ x: cx + range(-16, 16), z: cz + range(-16, 16), wander: { cx, cz, half: 17 } });
      }
    }
  }

  // ---- moving traffic ----------------------------------------------------
  for (let k = 0; k < 44; k++) {
    traffic.push({
      model: chance(0.72) ? pick(CARS) : pick(TRUCKS),
      node: [Math.floor(rnd() * NODES), Math.floor(rnd() * NODES)],
      dir: Math.floor(rnd() * 4),
      t: rnd(),
    });
  }

  return { ground, props, people, traffic, rnd };
}

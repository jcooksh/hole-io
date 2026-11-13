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
  'cars/van', 'cars/hatchback-sports', 'cars/race', 'cars/race-future', 'cars/taxi', 'cars/sedan'];
const TRUCKS = ['cars/truck', 'cars/truck-flat', 'cars/delivery', 'cars/delivery-flat', 'cars/ambulance',
  'cars/firetruck', 'cars/garbage-truck', 'cars/tractor', 'cars/tractor-shovel'];
const TOWERS = ['commercial/building-skyscraper-a', 'commercial/building-skyscraper-b',
  'commercial/building-skyscraper-c', 'commercial/building-skyscraper-d', 'commercial/building-skyscraper-e',
  'commercial/building-l', 'commercial/building-m', 'commercial/building-i'];
const WIDE = ['commercial/building-n', 'commercial/building-j'];
const SHOPS = ['commercial/building-a', 'commercial/building-b', 'commercial/building-c', 'commercial/building-d',
  'commercial/building-f', 'commercial/building-g', 'commercial/building-h'];
const SHOPS_WIDE = ['commercial/building-e', 'commercial/building-k'];
const HOUSES = 'abcdefghijklmnopqrstu'.split('').map((c) => `suburban/building-type-${c}`);
const PARK_TREES = ['nature/tree_oak', 'nature/tree_default', 'nature/tree_detailed', 'nature/tree_fat',
  'nature/tree_pineRoundA', 'nature/tree_tall', 'nature/tree_simple'];
const SMALL_NATURE = ['nature/flower_redA', 'nature/flower_yellowA', 'nature/flower_purpleA',
  'nature/mushroom_red', 'nature/plant_bush', 'nature/plant_bushLarge', 'nature/rock_smallA',
  'nature/stump_round', 'nature/pot_large'];
const FOOD = ['burger', 'pizza', 'donut-sprinkles', 'hot-dog', 'ice-cream', 'watermelon', 'pumpkin', 'cake-birthday',
  'fries', 'soda-can', 'cupcake', 'cheese', 'turkey', 'pizza-box', 'sundae', 'taco', 'pineapple'].map((n) => `food/${n}`);
const PETS = ['pets/animal-dog', 'pets/animal-cat', 'pets/animal-bunny', 'pets/animal-chick', 'pets/animal-dog', 'pets/animal-cat'];
const FACTORIES = 'adefhkmn'.split('').map((c) => `industrial/building-${c}`);
const FACTORIES_WIDE = 'clqr'.split('').map((c) => `industrial/building-${c}`);
const CONTAINERS = ['industrial/shipping-container-a', 'industrial/shipping-container-b', 'industrial/shipping-container-c'];

export function generateCity(seed, theme) {
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
  // animals wander around inside a square area, like the pedestrians in parks
  const pet = (model, cx, cz, half, y) => props.push({ model, x: cx + range(-half, half), z: cz + range(-half, half), rot: spin(), y, s: 1, pet: { cx, cz, half } });

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
      if (m === 3 && chance(0.16)) put('roads/sign-highway', 0, 0, 0, 0.2);
      if ((m === 2 || m === 3) && chance(0.16)) {
        // little roadworks strip along the kerb
        const side = chance(0.5) ? 1 : -1;
        const n = 3 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) put(chance(0.75) ? 'cars/cone' : 'roads/construction-cone', -4 + k * (8 / n) + range(-0.3, 0.3), side * 3.45, spin(), 0.1);
        if (chance(0.6)) put('roads/construction-barrier', range(-2, 2), side * 4.5, Math.PI / 2, 0.2);
        if (chance(0.5)) put('roads/construction-light', range(-4, 4), side * 4.4, 0, 0.2);
      }
      if (chance(0.3)) put(pick(['cars/box', 'cars/cone', 'roads/construction-cone', 'cars/box']), range(-4.5, 4.5), (chance(0.5) ? 1 : -1) * 4.5, spin(), 0.2);
      if (chance(0.12)) put(pick(FOOD), range(-4.5, 4.5), (chance(0.5) ? 1 : -1) * 4.5, spin(), 0.2);
      if (m === 3 && chance(0.25)) { const side = chance(0.5) ? 1 : -1; put('skate/bench', range(-2, 2), side * 4.6, side > 0 ? Math.PI : 0, 0.2); }
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
  // Swap some blocks for parks, a skate park and an industrial estate.
  const swap = (kind, count, from) => {
    for (let n = 0, guard = 0; n < count && guard < 300; guard++) {
      const bi = Math.floor(rnd() * BLOCKS), bj = Math.floor(rnd() * BLOCKS);
      if (!from.includes(kinds[bi][bj])) continue;
      kinds[bi][bj] = kind; n++;
    }
  };
  swap('park', 4, ['shops', 'homes']);
  swap('skate', 1, ['shops', 'homes']);
  swap('industrial', 4, ['homes']);

  for (let bi = 0; bi < BLOCKS; bi++) {
    for (let bj = 0; bj < BLOCKS; bj++) {
      const cx = ((bi * STEP + STEP / 2) - HALF) * TILE;
      const cz = ((bj * STEP + STEP / 2) - HALF) * TILE;
      const kind = kinds[bi][bj];
      const paved = kind === 'downtown' || kind === 'shops' || kind === 'industrial';
      const gy = paved ? 0.2 : kind === 'skate' ? 0.04 : 0.02;
      const floor = paved ? 'roads/tile-low' : kind === 'skate' ? 'skate/floor-concrete' : 'nature/ground_grass';
      for (let a = 0; a < STEP - 1; a++) for (let b = 0; b < STEP - 1; b++) {
        tile(floor, cx - 15 + a * TILE, cz - 15 + b * TILE, 0, paved ? 0 : gy);
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
        for (let k = 0; k < 2; k++) scatter(pick(SHOPS), 3.6, 0.5);       // kiosks
        for (let k = 0; k < 2; k++) scatter(pick(PARK_TREES), 2.6, range(1.5, 1.8));
        for (let k = 0; k < 4; k++) scatter('roads/dumpster', 2);
        for (let k = 0; k < 6; k++) scatter('cars/box', 0.8);
        for (let k = 0; k < 5; k++) scatter('cars/cone', 0.5);
        for (let k = 0; k < 3; k++) scatter('suburban/planter', 2.2);
        for (let k = 0; k < 2; k++) scatter(pick(['commercial/detail-parasol-a', 'commercial/detail-parasol-b']), 2.2);
        for (let k = 0; k < 2; k++) scatter('suburban/tree-small', 1.4);
        for (let k = 0; k < 3; k++) scatter(pick(FOOD), 1.2);
        for (let k = 0; k < 2; k++) scatter('skate/bench', 1.4);
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
          for (let k = 0; k < 4; k++) scatter(pick(FOOD), 1.2, 1, 6);
          for (let k = 0; k < 2; k++) scatter('skate/bench', 1.4, 1, 6);
          if (chance(0.5)) scatter('nature/tree_palm', 2.4, 1.2, 5);
        }
        for (let k = 0; k < 2; k++) scatter(pick(SHOPS), 3.4, 0.5, 6.5);  // kiosks in the courtyard
        for (let k = 0; k < 2; k++) scatter(pick(PARK_TREES), 2.6, range(1.5, 1.8));
        scatter(pick(TRUCKS), 3.2);
        for (let k = 0; k < 5; k++) scatter('cars/box', 0.8);
        for (let k = 0; k < 4; k++) scatter('cars/cone', 0.5);
        for (let k = 0; k < 2; k++) scatter('roads/dumpster', 2);
        for (let k = 0; k < 2; k++) scatter('suburban/tree-small', 1.4);
        scatter('roads/construction-fence', 2);
        for (let k = 0; k < 2; k++) scatter(pick(FOOD), 1.2);
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
        for (let k = 0; k < 2; k++) scatter(pick(HOUSES), 3.6, 0.42);     // garden sheds
        for (let k = 0; k < 3; k++) scatter(pick(PARK_TREES), 2.8, range(1.5, 1.85));
        if (chance(0.4)) scatter(pick(['industrial/solar-panel-portrait', 'nature/tent_detailedOpen', 'industrial/shipping-container-a']), 3.4);
        for (let k = 0; k < 5; k++) scatter(pick(['suburban/tree-large', 'suburban/tree-small', 'suburban/tree-large']), 1.5, range(0.9, 1.3));
        if (chance(0.5)) scatter(pick(PARK_TREES), 2.2, range(1.0, 1.4));
        for (let k = 0; k < 10; k++) scatter(pick(SMALL_NATURE), 0.9, range(0.9, 1.3));
        for (let k = 0; k < 3; k++) scatter('cars/box', 0.8);
        for (let k = 0; k < 2; k++) scatter(pick(['food/pumpkin', 'food/watermelon', 'skate/skateboard', 'skate/scooter', 'food/pizza-box']), 1);
        if (chance(0.8)) pet(pick(PETS), cx, cz, 3.5, gy);
        if (chance(0.5)) pet(pick(PETS), cx, cz, 3.5, gy);
        for (let k = 0; k < 3; k++) people.push({ x: cx, z: cz, loop: { cx, cz, half: 20.5, dir: chance(0.5) ? 1 : -1 } });
      } else if (kind === 'industrial') {
        // factories on one side of the block, a yard of containers, tanks and machinery on the other
        const side = chance(0.5) ? 1 : -1, front = side > 0 ? 0 : Math.PI;
        if (chance(0.5)) solid(pick(FACTORIES_WIDE), 0, side * 9, front, 12.5);
        else for (const sx of [-1, 1]) solid(pick(FACTORIES), sx * 10, side * 10, chance(0.5) ? front : (sx > 0 ? Math.PI / 2 : -Math.PI / 2), 9);
        const yard = -side * 10.5;
        const rows = 3 + Math.floor(rnd() * 3);
        for (let k = 0; k < rows; k++) solid(pick(CONTAINERS), -16 + k * 4.6, yard + range(-1, 1), chance(0.2) ? 0.12 : 0, 3.2);
        solid(pick(['industrial/detail-tank-large', 'industrial/chimney-large', 'industrial/water-tower', 'industrial/windmill',
          'industrial/detail-tank-large']), 11, yard, spin(), 8.5);
        scatter('industrial/detail-tank', 4.5);
        scatter('industrial/chimney-medium', 2.6);
        for (let k = 0; k < 2; k++) scatter(pick(['industrial/solar-panel-landscape-group', 'industrial/solar-panel-portrait']), 4);
        for (let k = 0; k < 2; k++) scatter(pick(TRUCKS), 3.4);
        for (let k = 0; k < 2; k++) scatter(pick(CONTAINERS), 4.2);
        for (let k = 0; k < 6; k++) scatter('skate/pallet', 1);
        for (let k = 0; k < 5; k++) scatter('food/barrel', 1.3);
        for (let k = 0; k < 6; k++) scatter('cars/box', 0.8);
        for (let k = 0; k < 4; k++) scatter('cars/cone', 0.5);
        for (let k = 0; k < 2; k++) scatter('roads/dumpster', 2);
        for (let k = 0; k < 2; k++) scatter('roads/construction-fence', 2);
        edge(8, ['cars/box', 'cars/cone', 'skate/pallet', 'food/barrel', 'roads/construction-cone']);
        for (let k = 0; k < 3; k++) people.push({ x: cx, z: cz, loop: { cx, cz, half: 20.5, dir: chance(0.5) ? 1 : -1 } });
      } else if (kind === 'skate') {
        for (const [lx, lz, r] of [[-10, -8, Math.PI / 2], [10, -8, -Math.PI / 2], [-10, 8, Math.PI / 2], [10, 8, -Math.PI / 2]]) {
          if (chance(0.8)) solid('skate/half-pipe', lx, lz, r, 3.6);
        }
        for (let k = 0; k < 4; k++) scatter('skate/ramp', 3.6, 1, 14);
        for (let k = 0; k < 3; k++) scatter('skate/obstacle-box', 3, 1, 14);
        for (let k = 0; k < 3; k++) scatter('skate/rail-high', 2.4, 1, 15);
        for (let k = 0; k < 2; k++) scatter('skate/steps', 3.6, 1, 14);
        scatter('skate/structure-platform', 3.4, 1, 14);
        for (let k = 0; k < 8; k++) scatter(pick(['skate/skateboard', 'skate/scooter']), 1);
        for (let k = 0; k < 4; k++) scatter('skate/bench', 1.5);
        for (let k = 0; k < 4; k++) scatter('skate/pallet', 1);
        for (let k = 0; k < 4; k++) scatter('nature/tree_palm', 2.6, range(1.2, 1.6));
        for (let k = 0; k < 6; k++) scatter(pick(FOOD), 1.2);
        for (let k = -3; k <= 3; k++) if (chance(0.7)) prop('skate/fence', cx + k * 4.2, cz - 19, 0, gy);
        for (let k = 0; k < 6; k++) people.push({ x: cx + range(-14, 14), z: cz + range(-14, 14), wander: { cx, cz, half: 16 } });
      } else {
        // park
        const centre = pick(['nature/statue_obelisk', 'nature/statue_head', 'nature/statue_column', 'nature/statue_ring']);
        solid(centre, 0, 0, 0, 3.5);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
          prop('skate/bench', cx + Math.cos(a) * 8, cz + Math.sin(a) * 8, Math.atan2(-Math.cos(a), -Math.sin(a)), gy);
        }
        if (chance(0.6)) { scatter('nature/campfire_stones', 2); scatter('nature/canoe', 2.6); }
        for (let k = 0; k < 6; k++) scatter(pick(FOOD), 1.2);
        for (let k = 0; k < 3; k++) pet(pick(PETS), cx, cz, 15, gy);
        if (chance(0.5)) { pet('pets/animal-cow', cx, cz, 14, gy); pet('pets/animal-pig', cx, cz, 14, gy); }
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          prop(pick(['nature/flower_redA', 'nature/flower_yellowA', 'nature/flower_purpleA']), cx + Math.cos(a) * 5, cz + Math.sin(a) * 5, spin(), gy, 1.2);
        }
        taken.push({ x: 0, z: 0, r: 9 });
        for (let k = 0; k < 6; k++) scatter(pick(PARK_TREES), 3.4, range(1.5, 1.9));
        scatter(pick(HOUSES), 3.8, 0.45);                                    // park pavilion
        for (let k = 0; k < 11; k++) scatter(pick(PARK_TREES), 2.4, range(0.9, 1.25));
        if (chance(0.7)) scatter('nature/tent_detailedOpen', 3.2);
        for (let k = 0; k < 3; k++) scatter('nature/rock_largeA', 3.2);
        scatter('nature/log_stack', 2);
        scatter('nature/sign', 1);
        for (let k = 0; k < 26; k++) scatter(pick(SMALL_NATURE), 0.8, range(0.9, 1.4));
        for (let k = 0; k < 5; k++) people.push({ x: cx + range(-16, 16), z: cz + range(-16, 16), wander: { cx, cz, half: 17 } });
      }
    }
  }

  // ---- moving traffic ----------------------------------------------------
  for (let k = 0; k < 50; k++) {
    traffic.push({
      model: chance(0.6) ? pick(CARS) : pick(TRUCKS),
      node: [Math.floor(rnd() * NODES), Math.floor(rnd() * NODES)],
      dir: Math.floor(rnd() * 4),
      t: rnd(),
    });
  }

  return { ground, props, people, traffic, rnd };
}

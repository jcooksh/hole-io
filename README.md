# Gulp City

A browser game where you are a hole in the ground. Slide under things smaller than you, they fall
in, you get bigger. You start with traffic cones and pedestrians and work up to skyscrapers. Eat
the whole city and the game moves up a size: the countryside (whole towns are one bite), the Earth
(a real globe, where you eat countries), the solar system, the Milky Way, the universe, and finally
the multiverse. Seven other holes are eating the same world; one of a higher level can swallow you,
and that ends the run. There is no clock.

The first stage comes in three flavours, picked on the title screen: a modern city, a medieval
kingdom (castles, market towns, siege camps) and a colony on another planet.

## Play

Hosted with GitHub Pages: **https://jcooksh.github.io/hole-io/**

- **Touch** — Drag anywhere on the city to steer. Drag farther to move faster, and lift your finger to stop. Play in portrait or landscape.
- **Mouse and keyboard** — Move the pointer to steer, or use WASD or the arrow keys.

Every bite fills the yellow ring around your hole. A full ring is a level, and each level makes
the hole bigger. A hole of a higher level can swallow a lower one.

## Turning on GitHub Pages

The repo is a plain static site (no build step), so Pages can serve it as is:

1. Repo **Settings → Pages**
2. **Source:** Deploy from a branch
3. **Branch:** pick the branch that holds this code, folder `/ (root)`, then **Save**

The game is live at the URL above about a minute later. `.nojekyll` tells Pages to publish the
files untouched.

## Run locally

It needs to be served over HTTP (ES modules do not load from `file://`):

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## How it is built

- `index.html`, `src/style.css` - page, menus and HUD
- `src/main.js` - renderer, camera, input, HUD
- `src/game.js` - the rules shared by every stage: holes, swallowing, levels, bots, traffic, pedestrians
- `src/stages.js` - the seven worlds (city, countryside, Earth, solar system, galaxy, universe, multiverse)
- `src/city.js` - random city layout (new town every run)
- `src/maps.js` - the medieval and colony maps, and the map list
- `src/assets.js` - model loading, instancing prep, the shader patch that cuts the holes
- `src/audio.js` - sound effects
- `vendor/three/` - three.js r170

## Credits

All art, sound and the display font are CC0 assets by [Kenney](https://kenney.nl). See
[CREDITS.md](CREDITS.md) for the full list.

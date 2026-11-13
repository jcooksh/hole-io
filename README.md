# Gulp City

A browser game where you are a hole in the ground. Slide under things smaller than you, they fall
in, you get bigger. Start with traffic cones and pedestrians, finish with skyscrapers. Seven other
holes are eating the same town, and a bigger hole can swallow a smaller one. Two minutes per round.

## Play

Hosted with GitHub Pages: **https://jcooksh.github.io/hole-io/**

Controls: the hole follows your mouse. On a phone, drag. WASD / arrow keys work too.

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
- `src/game.js` - holes, swallowing, bots, traffic, pedestrians
- `src/city.js` - random city layout (new town every round)
- `src/assets.js` - model loading, instancing prep, the shader patch that cuts the holes
- `src/audio.js` - sound effects
- `vendor/three/` - three.js r170

## Credits

All art, sound and the display font are CC0 assets by [Kenney](https://kenney.nl). See
[CREDITS.md](CREDITS.md) for the full list.

# Credits

The modern city's model kits, sound effects and display font are public-domain (CC0 1.0) assets by
[Kenney](https://kenney.nl). The packs were downloaded from Kenney's pages on OpenGameArt.

| Pack | Used for | Source |
| --- | --- | --- |
| City Kit (Roads) 2.2 | roads, pavement, street lights, signs, cones, dumpsters | https://opengameart.org/content/city-kit-roads |
| City Kit (Commercial) 2.1 | shops, office blocks, skyscrapers, parasols | https://opengameart.org/content/city-kit-commercial |
| City Kit (Suburban) 2.0 | houses, street trees, planters, fences | https://opengameart.org/content/city-kit-suburban |
| Car Kit 3.1 | cars, trucks, traffic cones, boxes | https://opengameart.org/content/car-kit |
| Mini Characters 2.0 | pedestrians and their animations | https://opengameart.org/content/mini-characters |
| Nature Kit 2.1 | grass, park trees, rocks, flowers, statues | https://opengameart.org/content/nature-kit |
| Interface Sounds | all sound effects | https://opengameart.org/content/interface-sounds |
| Kenney Fonts | "Kenvector Future" display font | https://opengameart.org/content/kenney-fonts |

License for all of the above: [Creative Commons Zero 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

Changes made to the originals: the sound effects were converted from OGG to MP3 so they play in
every browser. The models and textures are the unmodified GLB/PNG files from the packs.

## Later stages

The worlds after the city use these extra sources.

| What | Used for | Source | License |
| --- | --- | --- | --- |
| Kenney City Kit (Industrial) 2.0, Food Kit, Mini Skate 2.0, Cube Pets 1.0 | factories, snacks, skate park, pets | https://opengameart.org/content/city-kit-industrial , /food-kit , /mini-skate , /cube-pets | CC0 |
| Kenney Pirate Kit 2.1 | ships on the globe; towers, cannons, barrels and crates on the medieval map | https://opengameart.org/content/pirate-kit | CC0 |
| Kenney Hexagon Kit, Castle Kit, Fantasy Town Kit 2.0 | the medieval map: houses, keeps, walls, siege engines, market stalls, carts, trees | https://opengameart.org/content/hexagon-kit , /castle-kit , /fantasy-town-kit | CC0 |
| Kenney Space Kit 1.0, Space Station Kit | the colony map: habitats, spacecraft, dishes, rocks, craters, crates and consoles | https://opengameart.org/content/space-kit , /space-station-kit | CC0 |
| NASA Blue Marble | the Earth's surface | NASA Earth Observatory, taken from the example images of the `three-globe` package | Public domain |
| Natural Earth 1:110m countries | country outlines you can eat | https://www.naturalearthdata.com via the `world-atlas` package | Public domain |
| Solar System Scope textures | Sun, planets, moons, Saturn's rings, star background | https://www.solarsystemscope.com/textures/ | CC BY 4.0 |
| ESA/Hubble images | nebulae, galaxies, galaxy clusters, deep field | [Image credits](https://jcooksh.github.io/hole-io/credits.html) | CC BY 4.0 |
| Pyramid of Khufu (3D model) by Drummyfish | landmark | https://commons.wikimedia.org/wiki/File:Pyramid_of_Khufu.stl | CC0 |
| Big Ben, Arc de Triomphe, Empire State Building (3D models) by Microsoft | landmarks | https://commons.wikimedia.org/wiki/File:Big_Ben.stl , File:Arc_de_Triomphe.stl , File:Empire_State_Building_(simplified).stl | CC BY 4.0 |

Images were resized and recompressed. Planet textures are 1024 px wide and the starfield is 2048 px wide.
Country outlines were converted from TopoJSON to a compact JSON file. The landmark models
are the original STL files. Towns and cities in the countryside stage are assembled in code from
the Kenney building models, and so are the castle keeps and colony towers on the two extra maps.

## Code

- [three.js](https://threejs.org) r170 (MIT), vendored in `vendor/three/` (core plus the GLTF, OBJ, MTL and STL loaders).

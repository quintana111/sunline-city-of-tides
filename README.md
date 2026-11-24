[![Competition](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

[![Rank](https://make.fun/badge/gta6-01/quintana111/sunline-city-of-tides/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

[![Reward](https://make.fun/badge/gta6-01/quintana111/sunline-city-of-tides/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# Sunline: City of Tides

A single-player open-world crime game in a bright fictional coastal city, built for make.fun's [gta6-01 — Make GTA 6](https://make.fun/bounty/gta6-01) bounty ($1,666 pot, top 100 paid). You are Nia Solis, a courier in Maravela: walk the streets, steal a car, outrun the Civic Sentinels, and run four timed jobs before the last ferry leaves.

## Competition

Entry for make.fun's [gta6-01 bounty](https://make.fun/bounty/gta6-01).

- **Bounty:** Make GTA 6
- **Prize pool:** $1,666
- **Payouts:** Top 100 paid
- **Deadline:** 24 November 2026, 22:00 WIB
- **Judge:** pairwise AI judge on screenshots + source outline; rank by pick rate

## Play

Serve it locally and open it in desktop Chrome — no build step, no network, everything vendored:

```sh
node serve.ts
# open http://localhost:8080
```

- **WASD** move / accelerate + steer · **Mouse** orbit camera · **Shift** run
- **Space** jump on foot / handbrake while driving
- **E** enter / exit a vehicle, start a job at a marker
- **F** punch · **Left mouse** shoot · **R** reload · **Esc** pause · **M** minimap detail

## What's in the city

- **Maravela** — a seeded 10×10-block coastal city: Glassline towers, Sunwash Beach, Pelican Marina, Foundry Quay, Palm Court homes and the Civic Crescent, with an ocean, beach, docks and ~250 buildings, ~100 palms and street lamps, all procedural (three.js r160, vendored under `game/vendor/`).
- **Driving** — five models (Morrow Compact, Sunbird Cab, Kestrel R, Docksider truck, Civic Sentinel cruiser) with arcade handling, chase camera and parked-car colliders.
- **Traffic & pedestrians** — ~30 ambient cars that follow lanes, slow and stop behind traffic, and ~60 pedestrians on sidewalk routes who flee fast vehicles.
- **Wanted system** — 0–5 stars; witnessed crime escalates the response, police pursue on road routes, and breaking line of sight lets the heat cool.
- **Missions** — four timed jobs: First Light Run, Harbour Receipt, Wrong Turn Right Friend, Last Ferry Window — each with a HUD objective banner, route marker and cash reward.
- **Combat & health** — punch and hitscan shooting, health pickups, recovery flow on flatline.
- **HUD, save & audio** — health/cash/stars/speed/clock, dark street-map minimap with police dots, localStorage save, Web Audio synth (oscillators/noise only, no files).

## Run the entry

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the vendored make.fun library (`vendor/makefun-game.ts`, kit copy, unchanged). It resolves every path from its own directory, so it also works grader-style: `cd / && node <path>/main.ts`.

## Layout

```
game/
  index.html            # page + HUD DOM, loads src/main.js as a module
  vendor/ three.min.js  # three.js r160, vendored
  src/ main.js world.js player.js vehicles.js traffic.js
       police.js missions.js combat.js hud.js audio.js save.js shots.js style.css
main.ts  serve.ts  README.md  screenshots/ (4 jpgs, first by name is the cover)
```

All city, character, vehicle, story and art names are invented for this game; no Rockstar Games names, logos, characters, maps or assets are used.

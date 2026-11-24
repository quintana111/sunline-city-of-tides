// main.ts — Sunline: City of Tides (make.fun gta6-01).
// Hands the game in: copies game/ + screenshots/ from beside this file
// into the output directory and writes dossier.json with the vendored
// make.fun library. Node 22, standard library only, no network.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Every path resolves from this script's own directory, never from the
// caller's working directory: the grader may run it from anywhere
// (e.g. `cd / && node <path>/main.ts`).

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The directory this file lives in — the entry root.
const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });

// Copy the playable game and the four screenshots into the output.
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps: only text_max_bytes shapes the bytes; the rest
// refuse an entry the scorer would refuse (more than 4 screenshots or one
// over 256 KiB; more than 993 files in game/ or 48 MiB of game files in
// all, or a path under game/ over 1000 bytes — game/ counts beside the
// output's own 1000-entry cap, with screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

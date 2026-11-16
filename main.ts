// Lumen Radar: a token launch radar entry for make.fun's token-radar-01.
//
// Reads the sealed DefiLlama snapshot (at /input/snapshot.json in the grader,
// or --input <file|dir> here), ranks every pre-token protocol with the model
// in lib/model.ts, and writes the board the gate checks plus the dashboard
// the judge reads:
//
//   /output/board.json    the ranked rows, ranks 1..N by implied value
//   /output/data.js       the same data as one script for the static page
//   /output/dashboard/    this repository's dashboard/, copied
//   /output/screenshots/  this repository's screenshots/, copied
//   /output/dossier.json  buildDossier's summary of the two directories
//
// The run is deterministic: the same snapshot writes the same bytes, twice.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The gate's caps, as the RULES state them: the dossier text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`lumen radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`lumen radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping dotfiles; returns the names copied. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`lumen radar: screenshots/ holds ${shots.length} images: hand in 3 or 4 (the board, a detail view, a filtered view)\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) {
    process.stderr.write(`lumen radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `lumen radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} on the watchlist, ${board.length} pre-token rows ranked, ${radar.live.length} live-token peers shown apart\n` +
    `lumen radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images) and dossier.json under ${out}\n`,
);

#!/usr/bin/env node
/**
 * Fetch script for the audio slots this build could NOT fill.
 *
 * Several sounds the brief asks for have no verified CC0 recording available
 * from the sources reachable while building (see docs/AUDIO-CREDITS.md). They
 * were deliberately left empty rather than filled with oscillator tones.
 *
 * This script is the documented path to filling them. It does not invent audio:
 * it downloads real recorded files from a source you have already checked the
 * licence of, records that licence in the credits ledger, and refuses to run
 * without both.
 *
 * Usage:
 *   node scripts/fetch-extra-audio.mjs --list
 *   node scripts/fetch-extra-audio.mjs --slot crowd-cheer \
 *        --url https://example.org/cc0/crowd-cheer.ogg \
 *        --license "CC0 1.0" --author "Name" --source "https://example.org/page"
 *
 * Nothing runs unless --license, --author and --source are all supplied, because
 * "downloadable" is not the same thing as "royalty-free".
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const LEDGER = resolve(ROOT, 'docs/AUDIO-CREDITS.md');

/**
 * The unfilled slots, with exactly what each one needs. Keep this in step with
 * AUDIO_GAPS in src/core/audio.js.
 */
export const MISSING_SLOTS = [
  {
    slot: 'crowd-cheer',
    dest: 'assets/audio/scene/crowd-cheer.ogg',
    want: 'Grandstand crowd cheering, 4-10 s, loopable tail.',
    why: 'Kenney casino-audio has no crowd; no other reachable source had a verified CC0 crowd recording.',
  },
  {
    slot: 'city-ambience',
    dest: 'assets/audio/scene/city-ambience.ogg',
    want: 'City street room tone, 30 s or longer, loopable. Traffic, market, distant horns.',
    why: 'Chapter one needs Anandapur to sound like a city. No verified CC0 field recording was reachable.',
  },
  {
    slot: 'home-ambience',
    dest: 'assets/audio/scene/home-ambience.ogg',
    want: 'Small interior room tone, loopable. A fan, distant traffic, quiet.',
    why: 'The family argument scenes currently play with no room tone.',
  },
  {
    slot: 'workshop-ambience',
    dest: 'assets/audio/scene/workshop-ambience.ogg',
    want: 'Workshop floor bed, loopable. Impact wrench, metal, a radio.',
    why: 'Chapters four and six need a continuous workshop bed under the dialogue.',
  },
  {
    slot: 'pit-lane-ambience',
    dest: 'assets/audio/scene/pit-lane-ambience.ogg',
    want: 'Pit lane bed, loopable. Air guns, idling engines, footsteps.',
    why: 'The chapter seven paddock scene currently plays with no ambience.',
  },
  {
    slot: 'gear-change',
    dest: 'assets/audio/racing/gear-change.ogg',
    want: 'A recorded sequential gear-change clunk, 0.2-0.5 s, several variants.',
    why: 'A recorded metal click is used as a stand-in today; that substitution is disclosed in the credits.',
  },
  {
    slot: 'background-music',
    dest: 'assets/audio/music/theme-loop.ogg',
    want: 'Full-length looping background music, 60 s or longer, plus a race variant.',
    why: 'Only short recorded stingers (10-20 KB jingles) were available under CC0.',
  },
];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else args._.push(a);
  }
  return args;
}

function printList() {
  console.log('Audio slots this build could not fill with verified CC0 recordings:\n');
  for (const s of MISSING_SLOTS) {
    console.log(`  ${s.slot}`);
    console.log(`    needed : ${s.want}`);
    console.log(`    target : ${s.dest}`);
    console.log(`    reason : ${s.why}\n`);
  }
  console.log('To fill one, re-run with --slot, --url, --license, --author and --source.');
  console.log('The licence details are appended to docs/AUDIO-CREDITS.md so every asset stays attributed.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list || !args.slot) {
    printList();
    return;
  }

  const slot = MISSING_SLOTS.find((s) => s.slot === args.slot);
  if (!slot) {
    console.error(`Unknown slot "${args.slot}". Run with --list to see the slots that need filling.`);
    process.exit(1);
  }
  for (const required of ['url', 'license', 'author', 'source']) {
    if (!args[required] || args[required] === true) {
      console.error(`--${required} is required. An asset is not royalty-free just because it can be downloaded.`);
      process.exit(1);
    }
  }

  const dest = resolve(ROOT, slot.dest);
  await mkdir(dirname(dest), { recursive: true });

  console.log(`Fetching ${args.url}`);
  const res = await fetch(args.url);
  if (!res.ok) {
    console.error(`Download failed with HTTP ${res.status}. Nothing was written.`);
    process.exit(1);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 512) {
    console.error('Refusing to write a file smaller than 512 bytes; that is not a recording.');
    process.exit(1);
  }
  await writeFile(dest, bytes);
  console.log(`Wrote ${slot.dest} (${(bytes.length / 1024).toFixed(1)} KB)`);

  const entry = [
    '',
    `### ${slot.slot}`,
    '',
    `- File: \`${slot.dest}\``,
    `- Purpose: ${slot.want}`,
    `- Licence: ${args.license}`,
    `- Author: ${args.author}`,
    `- Source page: ${args.source}`,
    `- Download URL: ${args.url}`,
    `- Added: ${new Date().toISOString().slice(0, 10)} by scripts/fetch-extra-audio.mjs`,
    '',
  ].join('\n');

  const ledger = await readFile(LEDGER, 'utf8').catch(() => '# Audio credits\n');
  const marker = '<!-- FETCHED-ASSETS -->';
  const next = ledger.includes(marker)
    ? ledger.replace(marker, `${marker}\n${entry}`)
    : `${ledger}\n${marker}\n${entry}`;
  await writeFile(LEDGER, next);
  console.log(`Recorded the licence in ${slot.dest.startsWith('docs') ? LEDGER : 'docs/AUDIO-CREDITS.md'}.`);
  console.log('\nNext: add the file to AUDIO_MANIFEST in src/core/audio.js and remove it from AUDIO_GAPS.');
}

main().catch((err) => {
  console.error(`Could not complete the fetch: ${err?.message ?? err}`);
  process.exit(1);
});

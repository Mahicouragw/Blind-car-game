#!/usr/bin/env node
/**
 * Decides what actually gets published to GitHub Pages.
 *
 * The repository root is not the site. `tests/`, `scripts/`, the markdown docs,
 * `package.json` and `package-lock.json` are all development material: shipping
 * them publishes the dependency tree and the test suite for no benefit and adds
 * weight to every deploy. Uploading `.` also relies on the internals of
 * `actions/upload-pages-artifact` to strip `.git` — which it does, but "the
 * action happens to exclude it" is a weaker guarantee than "we never put it in
 * the directory we upload".
 *
 * So the site is staged into `_site/` from an explicit include list, and this
 * module is the single source of truth for that list. `tests/publish.test.mjs`
 * imports it and asserts the staged tree still contains every file the running
 * game asks for, which is what stops the include list quietly rotting and
 * producing a deploy that 404s on one asset.
 *
 * Usage:
 *   node scripts/publish-list.mjs              # print the list, one path a line
 *   node scripts/publish-list.mjs --stage DIR  # copy the list into DIR
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');

/**
 * Everything the running game can ask for, as paths relative to the repository
 * root. A directory means "all of it, recursively".
 *
 * `docs/circuit-map.svg` is listed as a single file rather than as `docs/`
 * because `src/ui/menuScreens.js` loads that one image for the track map screen,
 * while the rest of `docs/` is prose for people reading the repository.
 */
export const PUBLISH_INCLUDE = [
  'index.html',
  'styles',
  'src',
  'assets',
  'vendor',
  'docs/circuit-map.svg',
];

/** Never published, even if something above starts pointing at them. */
export const PUBLISH_EXCLUDE = new Set([
  '.git',
  '.github',
  'node_modules',
  'tests',
  'scripts',
  'coverage',
  '_site',
]);

/**
 * Any directory whose name starts with a dot is skipped, so no dotfile can be
 * published regardless of how the include list evolves.
 */
function isHidden(name) {
  return name.startsWith('.');
}

function collect(entry, root, out) {
  const full = join(root, entry);
  if (!existsSync(full)) {
    throw new Error(`PUBLISH_INCLUDE lists "${entry}", which does not exist`);
  }
  if (isHidden(entry) || PUBLISH_EXCLUDE.has(entry.split(sep)[0])) return;

  if (statSync(full).isDirectory()) {
    for (const child of readdirSync(full, { withFileTypes: true })) {
      if (isHidden(child.name) || PUBLISH_EXCLUDE.has(child.name)) continue;
      collect(join(entry, child.name), root, out);
    }
    return;
  }
  out.push(entry.split(sep).join('/'));
}

/** The files that make up the site, relative to `root`, with forward slashes. */
export function publishList(root = ROOT) {
  const out = [];
  for (const entry of PUBLISH_INCLUDE) collect(entry, root, out);
  return out.sort();
}

/** Copy the publish list into `dest`, replacing anything already there. */
export function stageSite(dest, root = ROOT) {
  const target = resolve(dest);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  const files = publishList(root);
  for (const rel of files) {
    const to = join(target, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(root, rel), to);
  }
  return files;
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === join(ROOT, 'scripts', 'publish-list.mjs');
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const stageAt = process.argv.indexOf('--stage');
  if (stageAt !== -1) {
    const dest = process.argv[stageAt + 1];
    if (!dest) {
      console.error('--stage needs a directory');
      process.exit(1);
    }
    const files = stageSite(dest);
    const bytes = files.reduce((sum, rel) => sum + statSync(join(dest, rel)).size, 0);
    const shown = relative(ROOT, resolve(dest));
    const where = shown && !shown.startsWith('..') ? shown : resolve(dest);
    console.log(`Staged ${files.length} files (${(bytes / 1e6).toFixed(2)} MB) into ${where}/`);
  } else {
    for (const rel of publishList()) console.log(rel);
  }
}

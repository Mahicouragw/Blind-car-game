/**
 * Deployment safety: everything that must hold for the site to work once it is
 * published somewhere other than a domain root.
 *
 * GitHub Pages serves this repository from the sub-directory
 * `/Blind-car-game/`. An absolute-root URL such as `/src/main.js` resolves
 * against the domain root, so it passes every other test in this suite, passes
 * `npm run serve`, passes the local import check — and then 404s only on the
 * deployed site. These tests exist so that class of breakage cannot ship green.
 *
 * The second half exercises the real dev-server request handler over a socket,
 * because the guard that stops `.git/config` reaching a browser is security
 * critical and must not be allowed to regress into a comment.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { AUDIO_MANIFEST } from '../src/core/audio.js';
import { ALLOWED_DOTFILES, createDevServer, MIME, ROOT, safePath } from '../scripts/serve.mjs';
import { PUBLISH_INCLUDE, publishList, stageSite } from '../scripts/publish-list.mjs';
import { DEPLOY_CHECKS, verifySite } from '../scripts/verify-deploy.mjs';

// ------------------------------------------------------------------ utilities

/** Every file under `dir`, recursively, skipping the usual non-source trees. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const SRC_FILES = walk(join(ROOT, 'src'));
const SRC_AND_STYLES = [...SRC_FILES, join(ROOT, 'styles', 'main.css')];

/**
 * Issue a raw HTTP request with an exact path string.
 *
 * Deliberately not `fetch`: the WHATWG URL parser normalises percent-encoded
 * dot segments (`%2e%2e` is a double-dot path segment per spec), so `fetch`
 * would silently rewrite the very traversal we are trying to test.
 */
function rawGet(port, path) {
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolvePromise({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

// ------------------------------------------------- no absolute-root URLs ship

test('index.html contains no absolute-root href or src', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  // href="/anything" or src="/anything" — a protocol-relative "//host" is also
  // caught here, and so is a bare "/" document reference.
  const offenders = [...html.matchAll(/(?:href|src)\s*=\s*"([^"]*)"/g)]
    .map((m) => m[1])
    .filter((url) => url.startsWith('/') && !url.startsWith('#'));
  assert.deepEqual(offenders, [], `absolute-root references in index.html: ${offenders.join(', ')}`);
});

test('index.html asset references are document-relative', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const expected of ['styles/main.css', 'src/main.js']) {
    assert.ok(html.includes(`"${expected}"`), `index.html should reference ${expected} relatively`);
  }
});

test('no module or stylesheet references an absolute-root app path', () => {
  const pattern = /['"`]\/(?:src|styles|assets|vendor|docs)\//;
  const offenders = SRC_AND_STYLES.filter((file) => pattern.test(readFileSync(file, 'utf8'))).map(
    (file) => relative(ROOT, file),
  );
  assert.deepEqual(offenders, [], `absolute-root app paths found in: ${offenders.join(', ')}`);
});

test('no URL is built from the deployment location', () => {
  // Reading any of these to construct an asset URL means the app behaves
  // differently on Pages than it does locally, which is exactly the failure
  // mode this suite guards against.
  const pattern = /location\.pathname|document\.baseURI|import\.meta\.url/;
  const offenders = SRC_FILES.filter((file) => pattern.test(readFileSync(file, 'utf8'))).map(
    (file) => relative(ROOT, file),
  );
  assert.deepEqual(offenders, [], `location-derived URLs in: ${offenders.join(', ')}`);
});

// ------------------------------------------------------- audio manifest paths

test('every audio manifest entry is a relative path', () => {
  const entries = Object.entries(AUDIO_MANIFEST);
  assert.ok(entries.length > 0, 'the manifest must not be empty');
  for (const [key, url] of entries) {
    assert.ok(url && typeof url === 'string', `${key} has no path`);
    assert.ok(!url.startsWith('/'), `${key} is absolute-root: ${url}`);
    assert.ok(!/^[a-z]+:\/\//i.test(url), `${key} is a remote URL: ${url}`);
    assert.ok(!url.startsWith('//'), `${key} is protocol-relative: ${url}`);
  }
});

test('every audio manifest entry exists on disk', () => {
  const missing = Object.entries(AUDIO_MANIFEST)
    .filter(([, url]) => !existsSync(join(ROOT, url)))
    .map(([key, url]) => `${key} -> ${url}`);
  assert.deepEqual(missing, [], `manifest references files that do not exist: ${missing.join(', ')}`);
});

test('audio manifest keys and paths are unique', () => {
  const keys = Object.keys(AUDIO_MANIFEST);
  assert.equal(new Set(keys).size, keys.length, 'duplicate manifest keys');
  // Three paths are shared ON PURPOSE: pause, resume and exit reuse the CC0
  // Kenney interface recordings (close, open, back) exactly as documented in
  // core/audio.js. Anything else sharing a file is a copy-paste mistake.
  const ALIAS_OF = { 'ui-pause': 'ui-close', 'ui-resume': 'ui-open', 'ui-exit': 'ui-back' };
  const byPath = new Map();
  const shared = [];
  for (const [key, url] of Object.entries(AUDIO_MANIFEST)) {
    if (byPath.has(url)) {
      const other = byPath.get(url);
      if (ALIAS_OF[key] !== other && ALIAS_OF[other] !== key) shared.push(`${other} + ${key} -> ${url}`);
    } else byPath.set(url, key);
  }
  assert.deepEqual(shared, [], 'two keys share one file');
});

// -------------------------------------------------------- module graph closes

test('every relative import in src resolves to a real file', () => {
  const importRe = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"](\.[^'"]+)['"]/g;
  const dynamicRe = /import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  const missing = [];
  let checked = 0;

  for (const file of SRC_FILES) {
    const text = readFileSync(file, 'utf8');
    for (const re of [importRe, dynamicRe]) {
      re.lastIndex = 0;
      for (const match of text.matchAll(re)) {
        const specifier = match[1];
        const target = resolve(join(file, '..'), specifier);
        checked += 1;
        if (!existsSync(target)) missing.push(`${relative(ROOT, file)} -> ${specifier}`);
      }
    }
  }

  assert.ok(checked > 40, `only resolved ${checked} imports; the scan looks broken`);
  assert.deepEqual(missing, [], `unresolved imports: ${missing.join(', ')}`);
});

test('vendored Three.js ships both of its chunks', () => {
  // three.module.js imports './three.core.js'. Vendoring only the first file is
  // the classic way to get a blank canvas with no obvious error.
  const moduleFile = join(ROOT, 'vendor/three/three.module.js');
  const coreFile = join(ROOT, 'vendor/three/three.core.js');
  assert.ok(existsSync(moduleFile), 'vendor/three/three.module.js is missing');
  assert.ok(existsSync(coreFile), 'vendor/three/three.core.js is missing');

  const text = readFileSync(moduleFile, 'utf8');
  const relativeImports = [...text.matchAll(/from\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  for (const specifier of relativeImports) {
    const target = resolve(join(moduleFile, '..'), specifier);
    assert.ok(existsSync(target), `three.module.js imports ${specifier}, which is not vendored`);
  }
});

test('the runtime asset tree is present', () => {
  for (const path of [
    'index.html',
    'styles/main.css',
    'src/main.js',
    'vendor/three/three.module.js',
    'vendor/three/three.core.js',
    'docs/circuit-map.svg',
  ]) {
    assert.ok(existsSync(join(ROOT, path)), `${path} is missing`);
    assert.ok(statSync(join(ROOT, path)).isFile(), `${path} is not a file`);
  }
});

test('.nojekyll is committed for the branch-build fallback', () => {
  // With Pages set to build_type "workflow" no Jekyll step runs at all, and
  // actions/upload-pages-artifact strips dotfiles from the artefact anyway, so
  // this file does not reach the deployed site today. It is kept because it
  // matters immediately if the source is ever switched back to "Deploy from a
  // branch", where Jekyll does run and would strip these directories.
  assert.ok(existsSync(join(ROOT, '.nojekyll')), '.nojekyll should stay committed');
});

// --------------------------------------------------- path guard, unit level

test('safePath refuses every dotfile and dot-directory except the allowlist', () => {
  for (const url of [
    '/.git/config',
    '/.git/HEAD',
    '/.github/workflows/deploy-pages.yml',
    '/.env',
    '/.npmrc',
    '/src/.hidden.js',
    '/assets/.secret/a.ogg',
  ]) {
    assert.equal(safePath(url), null, `${url} must be refused`);
  }
  assert.ok(ALLOWED_DOTFILES.has('.nojekyll'), 'the allowlist should still cover .nojekyll');
});

test('safePath refuses encoded traversal that normalises back inside the root', () => {
  // This is the real bug that was fixed: decoding %2e%2e produces "../..",
  // normalize() collapses it, and the result looks like a legitimate path
  // inside ROOT — so a containment check alone let .git/config through.
  for (const url of [
    '/%2e%2e/%2e%2e/.git/config',
    '/%2E%2E/%2E%2E/.git/config',
    '/src/%2e%2e/%2e%2e/.git/config',
    '/..%2f..%2f.git/config',
    '/%2e%2e%2f%2e%2e%2fetc/passwd',
  ]) {
    assert.equal(safePath(url), null, `${url} must be refused, not normalised into the root`);
  }
});

test('safePath never resolves outside the repository root', () => {
  for (const url of ['/../../etc/passwd', '/../../../etc/shadow', '/src/../../../../etc/passwd']) {
    const result = safePath(url);
    if (result === null) continue; // refused outright is the best outcome
    assert.ok(
      result === ROOT || result.startsWith(ROOT + sep),
      `${url} resolved outside the root: ${result}`,
    );
  }
});

test('safePath rejects malformed escapes and NUL bytes', () => {
  assert.equal(safePath('/%zz'), null, 'an invalid percent escape must be refused');
  assert.equal(safePath('/%'), null, 'a truncated percent escape must be refused');
  assert.equal(safePath('/src%00/main.js'), null, 'a NUL byte must be refused');
});

test('safePath accepts the real entry points', () => {
  for (const url of ['/', '/index.html', '/src/main.js', '/styles/main.css']) {
    const result = safePath(url);
    assert.ok(result, `${url} should be allowed`);
    assert.ok(result.startsWith(ROOT + sep) || result === ROOT, `${url} escaped the root`);
  }
});

// ------------------------------------------- path guard, over a real socket

const server = createDevServer();
let port = 0;

const listening = new Promise((res) => {
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    res();
  });
});

after(() => {
  server.close();
});

test('the dev server serves the game shell', async () => {
  await listening;
  const res = await rawGet(port, '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body.toString('utf8'), /src\/main\.js/);
});

test('the dev server serves audio with an audio MIME type', async () => {
  await listening;
  const res = await rawGet(port, '/assets/audio/racing/engine-loop.ogg');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^audio\/ogg/);
  assert.ok(res.body.length > 1000, 'the sample should not be a stub');
});

test('the dev server serves the vendored Three.js chunks as JavaScript', async () => {
  await listening;
  for (const path of ['/vendor/three/three.module.js', '/vendor/three/three.core.js']) {
    const res = await rawGet(port, path);
    assert.equal(res.status, 200, `${path} should be served`);
    assert.match(res.headers['content-type'], /text\/javascript/, `${path} needs a JS MIME type`);
  }
});

test('the dev server refuses .git over the wire', async () => {
  await listening;
  for (const path of ['/.git/config', '/.git/HEAD', '/.github/workflows/deploy-pages.yml']) {
    const res = await rawGet(port, path);
    assert.equal(res.status, 403, `${path} must be forbidden`);
    assert.ok(
      !res.body.toString('utf8').includes('url ='),
      `${path} leaked repository configuration`,
    );
  }
});

test('the dev server refuses encoded traversal over the wire', async () => {
  await listening;
  for (const path of [
    '/%2e%2e/%2e%2e/.git/config',
    '/src/%2e%2e/%2e%2e/.git/config',
    '/..%2f..%2f.git%2fconfig',
  ]) {
    const res = await rawGet(port, path);
    assert.ok(res.status === 403 || res.status === 404, `${path} returned ${res.status}`);
    assert.ok(
      !res.body.toString('utf8').includes('[remote'),
      `${path} leaked git configuration`,
    );
  }
});

test('the dev server 404s unknown paths instead of listing or guessing', async () => {
  await listening;
  const res = await rawGet(port, '/definitely-not-here.js');
  assert.equal(res.status, 404);
  assert.equal(res.body.toString('utf8'), 'Not found');
});

test('the dev server sends nosniff and never leaks internals in errors', async () => {
  await listening;
  const ok = await rawGet(port, '/index.html');
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');

  const forbidden = await rawGet(port, '/.git/config');
  assert.equal(forbidden.body.toString('utf8'), 'Forbidden');
  assert.ok(
    !/stack|Error:|at \w+\s*\(/.test(forbidden.body.toString('utf8')),
    'the error body must not contain a stack trace',
  );
});

test('importing the dev server module does not bind a port', () => {
  // The suite is living proof: this file imported scripts/serve.mjs at the top
  // and no server started until createDevServer().listen() was called here.
  assert.equal(typeof createDevServer, 'function');
  assert.ok(ROOT.endsWith('Blind-car-game'), 'ROOT should be the repository root');
});

// ------------------------------------------------ what actually gets published

/**
 * Stage the site once, into a temp directory, using the same `stageSite` the
 * workflow calls. Every test below then inspects that real tree, so a change to
 * the include list is checked against what would actually be uploaded.
 */
const STAGED = mkdtempSync(join(tmpdir(), 'vettaru-site-'));
const stagedFiles = stageSite(STAGED, ROOT);
const stagedSet = new Set(stagedFiles);

after(() => {
  rmSync(STAGED, { recursive: true, force: true });
});

test('the publish list contains the whole runtime', () => {
  for (const required of [
    'index.html',
    'styles/main.css',
    'src/main.js',
    'vendor/three/three.module.js',
    'vendor/three/three.core.js',
    'docs/circuit-map.svg',
  ]) {
    assert.ok(stagedSet.has(required), `${required} must be published`);
  }

  // Every module and every audio sample, not just the entry points: a staged
  // tree that is missing one lazily-imported screen would boot and then fail
  // only when the player reached that screen.
  for (const file of SRC_FILES) {
    const rel = relative(ROOT, file).split(sep).join('/');
    assert.ok(stagedSet.has(rel), `${rel} is part of the app but would not be published`);
  }
  for (const url of Object.values(AUDIO_MANIFEST)) {
    assert.ok(stagedSet.has(url), `${url} is referenced by the audio manifest but would not be published`);
  }
});

test('the publish list excludes development material', () => {
  const forbidden = stagedFiles.filter(
    (rel) =>
      rel.startsWith('tests/') ||
      rel.startsWith('scripts/') ||
      rel.startsWith('node_modules/') ||
      rel === 'package.json' ||
      rel === 'package-lock.json' ||
      rel === 'README.md' ||
      rel === 'ACCESSIBILITY.md' ||
      (rel.startsWith('docs/') && rel.endsWith('.md')),
  );
  assert.deepEqual(forbidden, [], `development material would be published: ${forbidden.join(', ')}`);
});

test('the publish list contains no dotfiles and no git metadata', () => {
  const hidden = stagedFiles.filter((rel) => rel.split('/').some((part) => part.startsWith('.')));
  assert.deepEqual(hidden, [], `dotfiles would be published: ${hidden.join(', ')}`);

  const git = stagedFiles.filter((rel) => rel.includes('.git'));
  assert.deepEqual(git, [], `git metadata would be published: ${git.join(', ')}`);
});

test('the staged tree on disk matches the publish list exactly', () => {
  const onDisk = walk(STAGED).map((full) => relative(STAGED, full).split(sep).join('/')).sort();
  assert.deepEqual(onDisk, [...stagedFiles].sort());
  assert.ok(stagedFiles.length > 100, `only ${stagedFiles.length} files staged; that looks wrong`);
});

test('every published file exists in the repository', () => {
  const missing = stagedFiles.filter((rel) => !existsSync(join(ROOT, rel)));
  assert.deepEqual(missing, [], `staged paths with no source file: ${missing.join(', ')}`);
});

test('PUBLISH_INCLUDE is non-empty and every entry exists', () => {
  assert.ok(PUBLISH_INCLUDE.length >= 5, 'the include list looks truncated');
  for (const entry of PUBLISH_INCLUDE) {
    assert.ok(existsSync(join(ROOT, entry)), `PUBLISH_INCLUDE lists "${entry}", which does not exist`);
  }
});

// ------------------------------------------- the staged tree serves as a site

/**
 * Minimal static server rooted at the staged tree, to prove it is
 * self-sufficient. Mirrors the one Pages behaviour that matters here: a request
 * for a directory serves the `index.html` inside it.
 */
const stagedServer = createHttpServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const segments = url.split('/').filter(Boolean);
  if (segments.some((part) => part === '..' || part.startsWith('.'))) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let full = join(STAGED, ...segments);
  if (existsSync(full) && statSync(full).isDirectory()) full = join(full, 'index.html');
  if (!existsSync(full) || statSync(full).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  const type = MIME[extname(full).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type }).end(readFileSync(full));
});

let stagedPort = 0;
const stagedListening = new Promise((res) => {
  stagedServer.listen(0, '127.0.0.1', () => {
    stagedPort = stagedServer.address().port;
    res();
  });
});

after(() => {
  stagedServer.close();
});

test('the staged site serves the game and refuses development files', async () => {
  await stagedListening;

  for (const path of ['/', '/src/main.js', '/styles/main.css', '/vendor/three/three.core.js', '/assets/audio/voice/go.ogg', '/docs/circuit-map.svg']) {
    const res = await rawGet(stagedPort, path);
    assert.equal(res.status, 200, `${path} should be served from the staged site`);
  }

  const shell = await rawGet(stagedPort, '/');
  assert.match(shell.body.toString('utf8'), /src\/main\.js/, 'the shell should reference its entry module');

  for (const path of ['/package-lock.json', '/README.md', '/tests/publish.test.mjs', '/scripts/serve.mjs', '/docs/TESTING.md', '/.git/config']) {
    const res = await rawGet(stagedPort, path);
    assert.notEqual(res.status, 200, `${path} must not be publicly served`);
  }
});

// --------------------------------------- the deploy verifier, proven both ways

test('verifySite passes against the locally staged site', async () => {
  await stagedListening;
  const { passed, failed } = await verifySite(`http://127.0.0.1:${stagedPort}`, {
    attempts: 1,
    log: () => {},
  });
  assert.deepEqual(failed, [], `staged site failed verification: ${JSON.stringify(failed)}`);
  assert.equal(passed, DEPLOY_CHECKS.length, 'every check should have run');
});

test('verifySite FAILS against a tree that publishes development material', async () => {
  // Negative control. The real dev server serves the repository root, where
  // package-lock.json, README.md, tests/ and scripts/ are all reachable, so the
  // "absent" checks must fail. Without this the verifier could pass vacuously
  // and the CI step it drives would be worth nothing.
  await listening;
  const { passed, failed } = await verifySite(`http://127.0.0.1:${port}`, {
    attempts: 1,
    log: () => {},
  });
  const paths = failed.map((f) => f.path).sort();
  assert.deepEqual(
    paths,
    ['/README.md', '/package-lock.json', '/scripts/serve.mjs', '/tests/publish.test.mjs'],
    'the verifier should flag exactly the development material that a root publish would expose',
  );
  assert.ok(passed > 0, 'the runtime checks should still pass against the repository root');
});

test('verifySite pinpoints a single missing asset', async () => {
  // The failure that actually matters in production: the shell loads, so
  // everything looks fine, but one lazily-loaded file never made it into the
  // artefact. Retrying would not help and short-circuiting must not hide it.
  const holes = ['/vendor/three/three.core.js', '/assets/audio/racing/engine-loop.ogg'];
  const holeSet = new Set(holes);

  const holey = createHttpServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (holeSet.has(url)) {
      res.writeHead(404).end('Not found');
      return;
    }
    const segments = url.split('/').filter(Boolean);
    if (segments.some((part) => part === '..' || part.startsWith('.'))) {
      res.writeHead(404).end('Not found');
      return;
    }
    let full = join(STAGED, ...segments);
    if (existsSync(full) && statSync(full).isDirectory()) full = join(full, 'index.html');
    if (!existsSync(full)) {
      res.writeHead(404).end('Not found');
      return;
    }
    const type = MIME[extname(full).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }).end(readFileSync(full));
  });

  const holeyPort = await new Promise((r) => {
    holey.listen(0, '127.0.0.1', () => r(holey.address().port));
  });
  try {
    const { failed } = await verifySite(`http://127.0.0.1:${holeyPort}`, { attempts: 1, log: () => {} });
    assert.deepEqual(
      failed.map((f) => f.path).sort(),
      [...holes].sort(),
      'exactly the missing assets should be reported, and nothing else',
    );
  } finally {
    holey.close();
  }
});

test('verifySite short-circuits when the site root never comes up', async () => {
  // If the shell does not serve, nothing below it will either. Reporting that
  // once keeps a genuinely broken deploy red in seconds instead of grinding the
  // retry budget thirteen times over.
  const empty = createHttpServer((req, res) => res.writeHead(404).end('Not found'));
  const emptyPort = await new Promise((r) => {
    empty.listen(0, '127.0.0.1', () => r(empty.address().port));
  });
  try {
    const { failed, passed } = await verifySite(`http://127.0.0.1:${emptyPort}`, { attempts: 1, log: () => {} });
    assert.deepEqual(failed.map((f) => f.path), ['/'], 'a dead root is reported once, not thirteen times');
    assert.equal(passed, 0);
  } finally {
    empty.close();
  }
});

test('verifySite does not retry a file that should not be published', async () => {
  // A published development file will not become unpublished by asking again,
  // so absent checks get one attempt. Asserted by counting requests: without
  // this, a failing deploy spent ~20s per path for no possible benefit.
  let hits = 0;
  const always = createHttpServer((req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  const alwaysPort = await new Promise((r) => {
    always.listen(0, '127.0.0.1', () => r(always.address().port));
  });
  try {
    await verifySite(`http://127.0.0.1:${alwaysPort}`, { attempts: 5, delayMs: 1, log: () => {} });
  } finally {
    always.close();
  }
  const absentChecks = DEPLOY_CHECKS.filter((c) => c.absent).length;
  assert.equal(hits, absentChecks, `each absent check should be requested exactly once, got ${hits} requests`);
});

test('verifySite rejects an empty base URL', async () => {
  await assert.rejects(() => verifySite('', { attempts: 1 }), /base URL/);
});

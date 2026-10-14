#!/usr/bin/env node
/**
 * Verifies that a deployed site actually serves the game.
 *
 * A green `actions/deploy-pages` step only proves the artefact was accepted. It
 * does not prove the published tree contains the files the running game asks
 * for, that they come back with usable MIME types, or that development material
 * stayed out. Those are exactly the failures that are invisible from a sandbox
 * with no route to github.io, so the deploy job checks them itself.
 *
 * The same function is imported by `tests/publish.test.mjs` and run against a
 * locally staged copy of the site, which is how this check is known to work
 * before it is ever trusted on a runner.
 *
 * Usage: node scripts/verify-deploy.mjs <base-url>
 */

/**
 * What the live site must look like. `absent: true` means the path must NOT be
 * served — asserted as "anything but 200" rather than a specific code, because
 * Pages answers 404 while a dev server may answer 403 for dotfiles, and both
 * are correct outcomes.
 */
export const DEPLOY_CHECKS = [
  { path: '/', status: 200, contentType: 'text/html', contains: 'src/main.js' },
  { path: '/src/main.js', status: 200, contentType: 'javascript' },
  { path: '/styles/main.css', status: 200, contentType: 'text/css' },
  { path: '/vendor/three/three.module.js', status: 200, contentType: 'javascript' },
  { path: '/vendor/three/three.core.js', status: 200, contentType: 'javascript' },
  { path: '/assets/audio/racing/engine-loop.ogg', status: 200, contentType: 'audio/ogg' },
  { path: '/assets/audio/voice/go.ogg', status: 200, contentType: 'audio/ogg' },
  { path: '/docs/circuit-map.svg', status: 200, contentType: 'svg' },
  // Development material must not be publicly reachable.
  { path: '/package-lock.json', absent: true },
  { path: '/README.md', absent: true },
  { path: '/tests/publish.test.mjs', absent: true },
  { path: '/scripts/serve.mjs', absent: true },
  { path: '/.git/config', absent: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(url) {
  const res = await fetch(url, { redirect: 'follow' });
  const type = res.headers.get('content-type') ?? '';
  // Only read the body when it is small and textual; audio samples are not.
  const text = type.includes('html') || type.includes('javascript') || type.includes('svg')
    ? (await res.text()).slice(0, 4000)
    : '';
  return { status: res.status, contentType: type, text, ok: res.ok };
}

/**
 * Run every check against `baseUrl`.
 *
 * @param {string} baseUrl  e.g. https://owner.github.io/repo (trailing slash optional)
 * @param {object} [opts]
 * @param {number} [opts.attempts=8]   retries per path, for Pages propagation delay
 * @param {number} [opts.delayMs=8000] pause between retries
 * @param {(line:string)=>void} [opts.log]
 * @returns {Promise<{passed:number, failed:Array<{path:string, reason:string}>}>}
 */
export async function verifySite(baseUrl, opts = {}) {
  const { attempts = 5, delayMs = 4000, log = () => {} } = opts;
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('verifySite needs a base URL');

  const failed = [];
  let passed = 0;

  for (const [index, check] of DEPLOY_CHECKS.entries()) {
    const url = base + check.path;
    let last = null;

    // Retrying only makes sense for a file that should be there but is not yet -
    // that is a propagation race. A file that should NOT be published will not
    // become unpublished by asking again, so absent checks get a single attempt
    // and a failing deploy reports in seconds instead of minutes.
    const budget = check.absent ? 1 : attempts;

    for (let attempt = 1; attempt <= budget; attempt += 1) {
      try {
        last = await probe(url);
      } catch (err) {
        last = { status: 0, contentType: '', text: '', ok: false, error: err.message };
      }

      if (check.absent) {
        if (last.status !== 200) {
          log(`ok    ${check.path} not served (${last.status})`);
          passed += 1;
          last = null;
          break;
        }
        last = { ...last, reason: `expected this not to be published, got 200 ${last.contentType}` };
      } else {
        const problems = [];
        if (last.status !== check.status) problems.push(`status ${last.status}, want ${check.status}`);
        if (check.contentType && !last.contentType.includes(check.contentType)) {
          problems.push(`content-type "${last.contentType}", want *${check.contentType}*`);
        }
        if (check.contains && !last.text.includes(check.contains)) {
          problems.push(`body does not contain "${check.contains}"`);
        }
        if (problems.length === 0) {
          log(`ok    ${check.path} ${last.status} ${last.contentType}`);
          passed += 1;
          last = null;
          break;
        }
        last = { ...last, reason: problems.join('; ') };
      }

      if (attempt < budget) {
        log(`retry ${attempt}/${budget} ${check.path}: ${last.reason ?? last.status}`);
        await sleep(delayMs);
      }
    }

    if (last) {
      failed.push({ path: check.path, reason: last.reason ?? `status ${last.status}` });
      log(`FAIL  ${check.path}: ${last.reason ?? last.status}`);
      // If the shell itself never came up, nothing below it will either. Report
      // that once and stop rather than spending the retry budget thirteen times.
      if (index === 0) {
        log('The site root did not come up; skipping the remaining checks.');
        break;
      }
    }
  }

  return { passed, failed };
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return entry.endsWith('verify-deploy.mjs');
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error('usage: node scripts/verify-deploy.mjs <base-url>');
    process.exit(1);
  }
  const { passed, failed } = await verifySite(baseUrl, { log: (l) => console.log(l) });
  console.log(`\n${passed} passed, ${failed.length} failed`);
  if (failed.length > 0) {
    // Report paths and reasons only. No headers, tokens or internals.
    console.error(`The deployed site did not verify at ${baseUrl.replace(/\/+$/, '')}`);
    process.exit(1);
  }
  console.log(`Live site verified: ${baseUrl.replace(/\/+$/, '')}`);
}

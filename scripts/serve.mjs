#!/usr/bin/env node
/**
 * Tiny static file server for local development and for the Arena live preview.
 *
 * There is no build step: the game is plain ES modules and vendored assets, so
 * serving the repository root is all that is required. Binds to 0.0.0.0 so it
 * is reachable through the sandbox preview proxy, and it never logs anything
 * beyond the request line - no paths, headers or internals are exposed.
 *
 * Usage: node scripts/serve.mjs [port]
 */

import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const HOST = '0.0.0.0';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Resolve a request path to a file inside the repository, or null.
 *
 * Two things are refused: anything that would escape the root once normalised,
 * and any dotfile or dot-directory. Serving `.git/` would publish the remote
 * URL and object store, which must never reach a public site.
 */
export const ALLOWED_DOTFILES = new Set(['.nojekyll']);

export function safePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null; // a malformed percent-escape is simply not a path we serve
  }
  if (decoded.includes('\0')) return null;

  for (const segment of decoded.split(/[/\\]/)) {
    if (segment.startsWith('.') && !ALLOWED_DOTFILES.has(segment)) return null;
  }

  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = resolve(ROOT, '.' + sep + rel);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  if (full.split(sep).some((segment) => segment.startsWith('.') && !ALLOWED_DOTFILES.has(segment))) return null;
  return full;
}

/**
 * Build the dev server without binding a port, so tests can exercise the real
 * request handler (including the dotfile and traversal refusals) on an
 * ephemeral port instead of only reasoning about `safePath` in isolation.
 */
export function createDevServer() {
  return createServer((req, res) => {
    try {
      let target = safePath(req.url ?? '/');
      if (!target) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
      if (!existsSync(target)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const stat = statSync(target);
      const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, {
        'content-type': type,
        'content-length': stat.size,
        // Development server: do not let a browser cache a module across edits.
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      createReadStream(target).pipe(res);
    } catch {
      // Never leak internals in an error response.
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Server error');
    }
  });
}

// Only bind a port when run as a script. Importing this module for a test must
// not start a server or steal the port the live preview is using.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  createDevServer().listen(PORT, HOST, () => {
    console.log(`Vettaru dev server on http://${HOST}:${PORT}/ (repository root, no build step)`);
  });
}

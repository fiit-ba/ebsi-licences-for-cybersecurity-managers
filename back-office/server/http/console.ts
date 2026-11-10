import { readFile, readdir, lstat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const pages = new Set([
  '',
  'login',
  'register',
  'registry',
  'issue',
  'verify',
  'proposals',
  'audit',
  'organizations',
  'schemas',
  'accounts',
  'admin/auth/user',
  'admin/auth/user/add',
  'lifecycle',
  'governance',
  'accreditation',
  'password_reset',
  'password_reset/complete',
  'password_reset/done',
  'admin/auth/group',
  'admin/auth/group/add',
  'admin',
  'admin/login',
  'admin/password_change',
]);
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.woff2': 'font/woff2',
};
const policy =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

/**
 * Load a fixed console build snapshot for safe static serving.
 *
 * @param directory - Build directory file URL.
 * @returns A request/response handler returning whether it served a known page or asset.
 * @throws Error if outputs are missing, unexpected, oversized or contain symlinks; filesystem
 * errors.
 * @remarks Requests never resolve arbitrary filesystem paths. HTML uses no-store and all responses
 * receive the console CSP.
 */
export async function loadConsoleAssets(directory: URL) {
  const root = fileURLToPath(directory);
  const files = new Map<string, { body: Buffer; type: string; cache: string }>();
  /**
   * Collect permitted build files without following symbolic links.
   *
   * @param relative - Relative directory within the trusted build root.
   * @returns Completion after populating the in-memory asset map.
   * @throws Error for symlinks, unsupported files or files larger than 10 MiB; filesystem errors.
   */
  async function collect(relative = '') {
    for (const name of await readdir(join(root, relative))) {
      const path = join(relative, name);
      const stat = await lstat(join(root, path));
      if (stat.isSymbolicLink())
        throw new Error('Console build outputs cannot contain symbolic links.');
      if (stat.isDirectory()) {
        await collect(path);
        continue;
      }
      if (!stat.isFile() || !types[extname(name)] || stat.size > 10 * 1024 * 1024)
        throw new Error('Unexpected console build output.');
      const file = {
        body: await readFile(join(root, path)),
        type: types[extname(name)] + '; charset=utf-8',
        cache: /-[A-Z0-9]{8}\.(js|css)$/.test(name)
          ? 'public, max-age=31536000, immutable'
          : 'no-store',
      };
      files.set('/console/' + path.split('\\').join('/'), file);
      files.set('/' + path.split('\\').join('/'), file);
    }
  }
  try {
    await collect();
  } catch (error) {
    throw new Error(
      'Console assets are unavailable. Run npm run build:web before starting the server.',
      { cause: error },
    );
  }
  const index = files.get('/console/index.html');
  if (!index) throw new Error('The console build has no index.html.');
  /**
   * Serve a known console page or an exact preloaded asset.
   *
   * @param request - Incoming HTTP request.
   * @param response - Response receiving static content or the console redirect.
   * @returns True when handled; false for unknown paths or unsupported methods.
   * @throws HTTP response-stream errors.
   */
  function serveConsole(request: IncomingMessage, response: ServerResponse) {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) return false;
    const path = request.url?.split('?')[0] ?? '';
    if (path === '/console') {
      response.writeHead(308, { location: '/console/', 'cache-control': 'no-store' });
      response.end();
      return true;
    }
    const page = (path.startsWith('/console/') ? path.slice(9) : path.slice(1)).replace(/\/$/, '');
    const file =
      files.get(path) ??
      (page !== null &&
      (pages.has(page) ||
        /^admin\/auth\/(?:user|group)\/[1-9]\d{0,9}\/(?:change|delete|password)$/.test(page))
        ? index
        : undefined);
    if (!file) return false;
    response.writeHead(200, {
      'content-type': file.type,
      'content-length': file.body.length,
      'cache-control': file.cache,
      'content-security-policy': policy,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
    });
    response.end(request.method === 'HEAD' ? undefined : file.body);
    return true;
  }
  return serveConsole;
}

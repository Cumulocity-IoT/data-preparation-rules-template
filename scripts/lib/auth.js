// Shared credential resolution for test.js and deploy.js.
//
// Resolution is token/session-first to match c8ycli session reuse, with basic
// auth as a fallback only:
//   host:  C8Y_HOST -> C8Y_BASEURL -> --host
//   auth:  C8Y_HEADER -> C8Y_HEADER_AUTHORIZATION -> --header
//   basic: only if both C8Y_USER and C8Y_PASSWORD are set

/**
 * Read a `--flag value` style argument from process.argv.
 * @param {string} flag e.g. "--host"
 * @returns {string | undefined}
 */
function readFlag(flag) {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) {
    return argv[idx + 1];
  }
  return undefined;
}

/**
 * Resolve the Cumulocity base URL and Authorization header.
 * @returns {{ baseUrl: string, authorizationHeader: string }}
 * @throws {Error} with an actionable message when host or credentials are missing.
 */
export function resolveAuth() {
  const host = process.env.C8Y_HOST || process.env.C8Y_BASEURL || readFlag('--host');
  if (!host) {
    throw new Error(
      'No Cumulocity host configured. Set C8Y_HOST (or C8Y_BASEURL), or pass --host <url>.',
    );
  }
  const baseUrl = host.replace(/\/+$/, '');

  const headerAuth =
    process.env.C8Y_HEADER || process.env.C8Y_HEADER_AUTHORIZATION || readFlag('--header');
  if (headerAuth) {
    return { baseUrl, authorizationHeader: headerAuth };
  }

  const user = process.env.C8Y_USER;
  const password = process.env.C8Y_PASSWORD;
  if (user && password) {
    const encoded = Buffer.from(`${user}:${password}`).toString('base64');
    return { baseUrl, authorizationHeader: `Basic ${encoded}` };
  }

  throw new Error(
    'No credentials configured. Provide an Authorization header via C8Y_HEADER ' +
      '(or C8Y_HEADER_AUTHORIZATION / --header), or set both C8Y_USER and C8Y_PASSWORD for basic auth.',
  );
}

/**
 * Detect whether an HTTP status indicates an auth/connectivity failure that
 * should abort the whole run immediately (rather than continuing to other rules).
 */
export function isFatalAuthStatus(status) {
  return status === 401 || status === 403;
}

'use strict';
/**
 * Lightweight CSRF protection (synchronizer token pattern).
 * - A token is generated once per session and exposed to templates via
 *   res.locals.csrfToken (also available as a meta tag in views).
 * - Non-safe methods must send it back either as a form field `_csrf` or the
 *   `X-CSRF-Token` header.
 * - Login endpoints are exempt (protected by rate limiting instead) so API
 *   clients can authenticate without a prior page visit.
 */
const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PATHS = new Set(['/login', '/auth/login']);

function generateToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Attach a CSRF token to the response locals (for templates + meta tag).
function attachCsrf(req, res, next) {
  res.locals.csrfToken = generateToken(req);
  next();
}

// Enforce CSRF on non-safe methods for the mounted router.
function csrfProtect(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();

  const sent = req.body && req.body._csrf
    ? String(req.body._csrf)
    : (req.headers['x-csrf-token'] || '');
  const expected = req.session && req.session.csrfToken;

  if (!expected || !sent || sent !== expected) {
    const message = 'CSRF token missing or invalid. Refresh the page and try again.';
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: message });
    }
    return res.status(403).send(message);
  }
  next();
}

module.exports = { generateToken, attachCsrf, csrfProtect };

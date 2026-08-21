const bcrypt = require('bcrypt');

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Middleware to render admin pages with auth check
function requireAuthView(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.redirect('/admin/login');
}

module.exports = { requireAuth, requireAuthView };

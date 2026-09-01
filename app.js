'use strict';
/**
 * Express application assembly (no listen — server.js boots it).
 * Extracted from the former monolith server.js so the app can be
 * imported by tests without binding a port.
 */
const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const marked = require('marked');
const hljs = require('highlight.js');
const config = require('./config/loader');
const { databasePath } = require('./database/db');
const { attachCsrf, csrfProtect } = require('./middleware/csrf');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');
const importRoutes = require('./routes/import');

const app = express();

app.locals.config = config;
app.locals.bp = config.blueprint;

// ---------- Markdown rendering with syntax highlighting + sanitization ----------
marked.marked.use({
  renderer: {
    code(code, infostring) {
      const langMatch = (infostring || '').match(/\S*/);
      const lang = langMatch ? langMatch[0] : '';
      let highlighted;
      try {
        if (lang && hljs.getLanguage(lang)) {
          highlighted = hljs.highlight(code, { language: lang }).value;
        } else {
          highlighted = hljs.highlightAuto(code).value;
        }
      } catch (err) {
        highlighted = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      const cls = lang ? `hljs language-${lang}` : 'hljs';
      return `<pre><code class="${cls}">${highlighted}</code></pre>`;
    }
  }
});

let sanitizedMarked;
try {
  const createDOMPurify = require('dompurify');
  const { JSDOM } = require('jsdom');
  const window = new JSDOM('').window;
  const DOMPurify = createDOMPurify(window);
  sanitizedMarked = {
    parse: (content) => {
      if (!content) return '';
      return DOMPurify.sanitize(marked.marked.parse(content));
    }
  };
  console.log('✓ DOMPurify sanitization enabled');
} catch (err) {
  console.warn('⚠ DOMPurify init failed, falling back to EJS escaping only:', err.message);
  sanitizedMarked = {
    parse: (content) => {
      if (!content) return '';
      return marked.marked.parse(content);
    }
  };
}
app.locals.marked = sanitizedMarked;

// ---------- Body parsing ----------
app.use(express.json({ limit: config.server.jsonBodyLimit || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: config.server.urlEncodedBodyLimit || '10mb' }));
app.use(methodOverride('_method'));

// ---------- Static assets ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/icon', express.static(path.join(__dirname, 'icon')));
// Vendor files for admin client-side features (live preview / image library)
app.use('/vendor/marked', express.static(path.join(__dirname, 'node_modules', 'marked')));
app.use('/vendor/dompurify', express.static(path.join(__dirname, 'node_modules', 'dompurify', 'dist')));
app.use('/vendor/hljs', express.static(path.join(__dirname, 'node_modules', 'highlight.js', 'styles')));

// ---------- Session (persistent secret survives restarts) ----------
function loadOrCreateSessionSecret() {
  const secretFile = path.join(path.dirname(databasePath()), '.session-secret');
  try {
    if (fs.existsSync(secretFile)) {
      const existing = fs.readFileSync(secretFile, 'utf-8').trim();
      if (existing) return existing;
    }
  } catch (err) {
    console.warn('⚠ Could not read session secret file:', err.message);
  }
  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    console.log('✓ Generated persistent session secret at', secretFile);
  } catch (err) {
    console.warn('⚠ Could not persist session secret, sessions will reset on restart:', err.message);
  }
  return generated;
}

// Trust reverse-proxy headers when configured (required for per-client rate
// limiting behind Nginx). Set config.server.trustProxy (or env TRUST_PROXY)
// to the number of proxy hops, e.g. 1.
if (process.env.TRUST_PROXY || config.server.trustProxy) {
  const hops = Number(process.env.TRUST_PROXY || config.server.trustProxy);
  app.set('trust proxy', Number.isInteger(hops) && hops > 0 ? hops : 1);
}

const sessionSecret = process.env.SESSION_SECRET || config.session.secret || loadOrCreateSessionSecret();

if (process.env.NODE_ENV === 'production' && config.session.cookieSecure !== true) {
  console.warn('⚠ [security] NODE_ENV=production but session.cookieSecure is not true — session cookie is sent without the Secure flag over HTTP. Set session.cookieSecure=true in config.json (or run behind HTTPS).');
}

app.use(session({
  secret: sessionSecret,
  resave: config.session.resave ?? false,
  saveUninitialized: config.session.saveUninitialized ?? false,
  cookie: {
    secure: config.session.cookieSecure ?? (process.env.NODE_ENV === 'production'),
    httpOnly: config.session.cookieHttpOnly ?? true,
    sameSite: config.session.cookieSameSite || 'lax',
    maxAge: (config.session.maxAgeHours || 24) * 60 * 60 * 1000
  }
}));

// Expose a per-session CSRF token to every template.
app.use(attachCsrf);

// Expose the current request path to templates (used for nav active states).
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// ---------- View engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Health check ----------
app.get('/healthz', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), ts: new Date().toISOString() });
});

// ---------- Routes ----------
app.use('/api', apiRoutes);
app.use('/admin', importRoutes);
app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

// ---------- 404 handler ----------
app.use((req, res) => {
  res.status(404).render('404', {
    title: config.errors['404'].title,
    blueprint: config.features.blueprint,
    nMark: config.features.nMark
  });
});

// ---------- Global error handler (logs details, hides internals) ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const ts = new Date().toISOString();
  console.error(`${ts} [error] ${req.method} ${req.originalUrl}: ${err.message}`);
  if (err.stack) console.error(err.stack);
  if (res.headersSent) return next(err);
  res.status(err.status || 500);
  if (req.path.startsWith('/api/')) {
    return res.json({ error: 'Server error' });
  }
  res.type('text/plain').send('Internal Server Error');
});

module.exports = app;

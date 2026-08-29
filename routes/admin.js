'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const config = require('../config/loader');
const db = require('../database/db');
const { requireAuthView } = require('../middleware/auth');
const { generateToken, csrfProtect } = require('../middleware/csrf');
const { loginLimiter } = require('../middleware/rateLimit');

// Decode HTML entities back to raw text
function decodeHtmlEntities(text) {
  if (!text) return text;
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// GET /admin/login
router.get('/login', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/admin');
  }
  res.render('admin-login', {
    title: config.admin.loginTitle || 'Admin Login',
    blueprint: config.features.blueprint,
    nMark: config.features.nMark
  });
});

// POST /admin/login (exempt from CSRF; protected by loginLimiter)
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const renderError = (error) => res.render('admin-login', {
      title: config.admin.loginTitle || 'Admin Login',
      error,
      blueprint: config.features.blueprint,
      nMark: config.features.nMark
    });

    if (!username || !password) {
      return renderError('Username and password required');
    }

    const result = await db.exec('SELECT id, password_hash FROM users WHERE username = ?', [username]);

    if (result.length === 0 || result[0].values.length === 0) {
      return renderError('Invalid credentials');
    }

    const [userId, passwordHash] = result[0].values[0];
    const valid = await bcrypt.compare(password, passwordHash);

    if (!valid) {
      return renderError('Invalid credentials');
    }

    generateToken(req);
    req.session.userId = userId;
    req.session.username = username;

    res.redirect('/admin');
  } catch (err) {
    console.error('Admin login error:', err);
    res.render('admin-login', {
      title: config.admin.loginTitle || 'Admin Login',
      error: 'Server error',
      blueprint: config.features.blueprint,
      nMark: config.features.nMark
    });
  }
});

// Everything below requires a valid CSRF token for non-safe methods.
router.use(csrfProtect);

// GET /admin - Dashboard
router.get('/', requireAuthView, async (req, res) => {
  try {
    const postsResult = await db.exec('SELECT * FROM posts ORDER BY created_at DESC');
    const posts = postsResult.length > 0 ? postsResult[0].values.map((row) => ({
      id: row[0],
      title: row[1],
      slug: row[3],
      published: row[7],
      created_at: row[8]
    })) : [];

    res.render('admin-dashboard', {
      title: config.admin.dashboardTitle || 'Admin Dashboard',
      posts,
      username: req.session.username,
      blueprint: config.features.blueprint,
      nMark: config.features.nMark
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Server error');
  }
});

// GET /admin/new - New post editor
router.get('/new', requireAuthView, (req, res) => {
  res.render('admin-editor', {
    title: config.admin.editor.titleNew || 'New Post',
    post: null,
    username: req.session.username,
    blueprint: config.features.blueprint,
    nMark: config.features.nMark
  });
});

// GET /admin/edit/:id - Edit post
router.get('/edit/:id', requireAuthView, async (req, res) => {
  try {
    const result = await db.exec('SELECT * FROM posts WHERE id = ?', [req.params.id]);

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).send('Post not found');
    }

    const row = result[0].values[0];
    const tagsResult = await db.exec(
      'SELECT t.name FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?',
      [row[0]]
    );
    const tags = tagsResult.length > 0 ? tagsResult[0].values.map((t) => t[0]) : [];

    res.render('admin-editor', {
      title: config.admin.editor.titleEdit || 'Edit Post',
      post: {
        id: row[0],
        title: row[1],
        title_en: row[2],
        slug: row[3],
        content: row[4],
        excerpt: row[5],
        cover_image: row[6],
        published: row[7],
        tags: tags.join(', ')
      },
      username: req.session.username,
      blueprint: config.features.blueprint,
      nMark: config.features.nMark
    });
  } catch (err) {
    console.error('Edit post error:', err);
    res.status(500).send('Server error');
  }
});

// POST /admin/preview - Preview post
router.post('/preview', requireAuthView, (req, res) => {
  const body = req.body;

  let tagList = [];
  if (body.tags) {
    tagList = Array.isArray(body.tags)
      ? body.tags.map((t) => String(t).trim()).filter(Boolean)
      : String(body.tags).split(',').map((t) => String(t).trim()).filter(Boolean);
  }

  const published = body.published === 'on' || body.published === true || body.published === 'true';

  res.render('admin-preview', {
    title: (config.admin.previewTitlePrefix || 'Preview · ') + (body.title || '未命名'),
    post: {
      title: body.title || '未命名标题',
      title_en: body.title_en || '',
      slug: body.slug || '',
      content: decodeHtmlEntities(body.content) || '',
      excerpt: body.excerpt || '',
      tags: tagList,
      published,
      created_at: new Date().toISOString()
    },
    username: req.session.username,
    blueprint: config.features.blueprint,
    nMark: config.features.nMark
  });
});

// POST /admin/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    res.redirect('/admin/login');
  });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { requireAuthView } = require('../middleware/auth');

const DB_PATH = path.join(__dirname, '..', 'data', 'blog.db');

// Helper to get database connection
async function getDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    return new SQL.Database(fileBuffer);
  }
  return new SQL.Database();
}

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

// Helper to get database connection
async function getDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    return new SQL.Database(fileBuffer);
  }
  return new SQL.Database();
}

// GET /admin/login
router.get('/login', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/admin');
  }
  res.render('admin-login', {
    title: 'Admin Login',
    blueprint: true,
    nMark: true
  });
});

// POST /admin/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.render('admin-login', {
        title: 'Admin Login',
        error: 'Username and password required',
        blueprint: true,
        nMark: true
      });
    }

    const db = await getDb();
    const result = db.exec("SELECT id, password_hash FROM users WHERE username = ?", [username]);

    if (result.length === 0 || result[0].values.length === 0) {
      db.close();
      return res.render('admin-login', {
        title: 'Admin Login',
        error: 'Invalid credentials',
        blueprint: true,
        nMark: true
      });
    }

    const [userId, passwordHash] = result[0].values[0];
    const valid = await bcrypt.compare(password, passwordHash);

    if (!valid) {
      db.close();
      return res.render('admin-login', {
        title: 'Admin Login',
        error: 'Invalid credentials',
        blueprint: true,
        nMark: true
      });
    }

    req.session.userId = userId;
    req.session.username = username;
    db.close();

    res.redirect('/admin');
  } catch (err) {
    res.render('admin-login', {
      title: 'Admin Login',
      error: 'Server error',
      blueprint: true,
      nMark: true
    });
  }
});

// GET /admin - Dashboard
router.get('/', requireAuthView, async (req, res) => {
  try {
    const db = await getDb();
    const postsResult = db.exec("SELECT * FROM posts ORDER BY created_at DESC");
    const posts = postsResult.length > 0 ? postsResult[0].values.map(row => ({
      id: row[0],
      title: row[1],
      slug: row[3],
      published: row[7],
      created_at: row[8]
    })) : [];
    db.close();

    res.render('admin-dashboard', {
      title: 'Admin Dashboard',
      posts,
      username: req.session.username,
      blueprint: true,
      nMark: true
    });
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// GET /admin/new - New post editor
router.get('/new', requireAuthView, (req, res) => {
  res.render('admin-editor', {
    title: 'New Post',
    post: null,
    username: req.session.username,
    blueprint: true,
    nMark: true
  });
});

// GET /admin/edit/:id - Edit post
router.get('/edit/:id', requireAuthView, async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec("SELECT * FROM posts WHERE id = ?", [req.params.id]);

    if (result.length === 0 || result[0].values.length === 0) {
      db.close();
      return res.status(404).send('Post not found');
    }

    const row = result[0].values[0];
    const tagsResult = db.exec(
      "SELECT t.name FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?",
      [row[0]]
    );
    const tags = tagsResult.length > 0 ? tagsResult[0].values.map(t => t[0]) : [];

    db.close();

    res.render('admin-editor', {
      title: 'Edit Post',
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
      blueprint: true,
      nMark: true
    });
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// POST /admin/preview - Preview post
router.post('/preview', requireAuthView, (req, res) => {
  const body = req.body;

  // Parse tags - handle both comma-separated string and array
  let tagList = [];
  if (body.tags) {
    if (Array.isArray(body.tags)) {
      tagList = body.tags.map(t => t.trim()).filter(t => t);
    } else {
      tagList = body.tags.split(',').map(t => t.trim()).filter(t => t);
    }
  }

  const published = body.published === 'on' || body.published === true || body.published === 'true';

  res.render('admin-preview', {
    title: 'Preview · ' + (body.title || '未命名'),
    post: {
      title: body.title || '未命名标题',
      title_en: body.title_en || '',
      slug: body.slug || '',
      content: decodeHtmlEntities(body.content) || '',
      excerpt: body.excerpt || '',
      tags: tagList,
      published: published,
      created_at: new Date().toISOString()
    },
    username: req.session.username,
    blueprint: true,
    nMark: true
  });
});

// POST /admin/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    res.redirect('/admin/login');
  });
});

module.exports = router;

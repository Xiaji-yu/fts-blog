'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config/loader');
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { generateToken, csrfProtect } = require('../middleware/csrf');
const { loginLimiter, apiLimiter } = require('../middleware/rateLimit');
const cache = require('../lib/cache');

const UPLOAD_DIR = path.join(__dirname, '..', config.upload.directory || 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const allowedTypes = config.upload.allowedTypes.join('|');
// Anchored patterns: extension like ".jpeg" and mimetype like "image/jpeg".
const extRegex = new RegExp(`^\\.(${allowedTypes})$`, 'i');
const mimeRegex = new RegExp(`^image/(${allowedTypes})$`, 'i');

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const extname = extRegex.test(path.extname(file.originalname).toLowerCase());
    const mimetype = mimeRegex.test(file.mimetype.toLowerCase());
    if (extname && mimetype) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  },
  limits: { fileSize: config.upload.maxFileSizeMB * 1024 * 1024 }
});

// Simple input validation helpers
function slugifySlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function validatePostInput({ title, slug, content }) {
  if (!title || !String(title).trim()) return '标题不能为空 · Title is required';
  if (!slug || !String(slug).trim()) return 'Slug 不能为空 · Slug is required';
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Slug 仅允许小写字母、数字和连字符';
  if (!content || !String(content).trim()) return '内容不能为空 · Content is required';
  if (String(title).length > 200) return '标题过长 · Title too long';
  return null;
}

function normalizeTags(tags) {
  if (!tags) return [];
  const list = Array.isArray(tags) ? tags : String(tags).split(',');
  return list.map((t) => String(t).trim()).filter(Boolean);
}

function invalidatePublicCache() {
  cache.invalidateAll();
}

// Rate limit the whole API generously, then protect mutations with CSRF.
router.use(apiLimiter);

// ===== AUTH ROUTES =====

// POST /api/auth/login (exempt from CSRF; protected by loginLimiter)
router.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await db.exec('SELECT id, password_hash FROM users WHERE username = ?', [username]);

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const [userId, passwordHash] = result[0].values[0];
    const valid = await bcrypt.compare(password, passwordHash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Regenerate the session (defeats session fixation) and mint a fresh
    // CSRF token for the authenticated session. The token is returned so
    // programmatic clients can use the admin API.
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.userId = userId;
    req.session.username = username;
    const csrfToken = generateToken(req);

    res.json({ message: 'Login successful', user: { id: userId, username }, csrfToken });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/csrf - Obtain a CSRF token for the current session
router.get('/auth/csrf', (req, res) => {
  res.json({ csrfToken: generateToken(req) });
});

// Everything below requires CSRF for non-safe methods.
router.use(csrfProtect);

// POST /api/auth/logout
router.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ message: 'Logout successful' });
  });
});

// ===== POST ROUTES =====

// GET /api/posts - List all published posts (paginated)
router.get('/posts', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || config.pagination.defaultLimit));
    const offset = (page - 1) * limit;

    const result = await db.exec(
      `SELECT p.*, GROUP_CONCAT(t.name) as tags
       FROM posts p
       LEFT JOIN post_tags pt ON p.id = pt.post_id
       LEFT JOIN tags t ON pt.tag_id = t.id
       WHERE p.published = 1
       GROUP BY p.id
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const posts = result.length > 0 ? result[0].values.map(rowToPost) : [];
    const countResult = await db.exec('SELECT COUNT(*) FROM posts WHERE published = 1');
    const total = countResult.length > 0 ? countResult[0].values[0][0] : 0;

    res.json({
      posts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('List posts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

function rowToPost(row) {
  return {
    id: row[0],
    title: row[1],
    title_en: row[2],
    slug: row[3],
    content: row[4],
    excerpt: row[5],
    cover_image: row[6],
    published: row[7],
    created_at: row[8],
    updated_at: row[9],
    view_count: row[10] !== undefined ? row[10] : 0,
    tags: row[11] ? row[11].split(',') : []
  };
}

async function getTagsForPost(postId) {
  const tagsResult = await db.exec(
    'SELECT t.name FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?',
    [postId]
  );
  return tagsResult.length > 0 ? tagsResult[0].values.map((t) => t[0]) : [];
}

// GET /api/posts/:slug - Get single post by slug
router.get('/posts/:slug', async (req, res) => {
  try {
    const result = await db.exec('SELECT * FROM posts WHERE slug = ? AND published = 1', [req.params.slug]);

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const row = result[0].values[0];
    const tags = await getTagsForPost(row[0]);

    res.json({ ...rowToPost(row), tags });
  } catch (err) {
    console.error('Get post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/posts/id/:id - Get single post by ID (admin)
router.get('/posts/id/:id', requireAuth, async (req, res) => {
  try {
    const result = await db.exec('SELECT * FROM posts WHERE id = ?', [req.params.id]);

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const row = result[0].values[0];
    const tags = await getTagsForPost(row[0]);

    res.json({ ...rowToPost(row), tags });
  } catch (err) {
    console.error('Get post by id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts - Create new post (admin)
router.post('/posts', requireAuth, async (req, res) => {
  try {
    const { title, title_en, slug, content, excerpt, published, tags } = req.body;

    const validationError = validatePostInput({ title, slug, content });
    if (validationError) return res.status(400).json({ error: validationError });

    const now = new Date().toISOString();
    const postId = await db.transaction(async (tx) => {
      tx.run(
        'INSERT INTO posts (title, title_en, slug, content, excerpt, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [title, title_en || null, slugifySlug(slug), content, excerpt || null, published ? 1 : 0, now, now]
      );
      const id = tx.lastInsertRowid();
      await insertTags(tx, id, normalizeTags(tags));
      return id;
    });

    invalidatePublicCache();
    res.status(201).json({ message: 'Post created', id: postId });
  } catch (err) {
    console.error('Create post error:', err);
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Slug 已存在 · A post with this slug already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

function isUniqueViolation(err) {
  return err && /UNIQUE constraint failed/i.test(err.message || '');
}

async function insertTags(tx, postId, tagList) {
  for (const tagName of tagList) {
    const tagResult = tx.exec('SELECT id FROM tags WHERE name = ?', [tagName]);
    let tagId;
    if (tagResult.length === 0 || tagResult[0].values.length === 0) {
      tx.run('INSERT INTO tags (name) VALUES (?)', [tagName]);
      tagId = tx.lastInsertRowid();
    } else {
      tagId = tagResult[0].values[0][0];
    }
    tx.run('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)', [postId, tagId]);
  }
}

// PUT /api/posts/:id - Update post (admin)
router.put('/posts/:id', requireAuth, async (req, res) => {
  try {
    const { title, title_en, slug, content, excerpt, published, tags } = req.body;
    const postId = req.params.id;

    const validationError = validatePostInput({ title, slug, content });
    if (validationError) return res.status(400).json({ error: validationError });

    const now = new Date().toISOString();
    // published comes as "on" from checkbox or boolean
    const publishedVal = (published === 'on' || published === true || published === 'true') ? 1 : 0;

    await db.transaction(async (tx) => {
      tx.run(
        'UPDATE posts SET title = ?, title_en = ?, slug = ?, content = ?, excerpt = ?, published = ?, updated_at = ? WHERE id = ?',
        [title, title_en || null, slugifySlug(slug), content, excerpt || null, publishedVal, now, postId]
      );
      tx.run('DELETE FROM post_tags WHERE post_id = ?', [postId]);
      await insertTags(tx, postId, normalizeTags(tags));
    });

    invalidatePublicCache();
    res.json({ message: 'Post updated' });
  } catch (err) {
    console.error('Update post error:', err);
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Slug 已存在 · A post with this slug already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/posts/:id - Delete post (admin)
router.delete('/posts/:id', requireAuth, async (req, res) => {
  try {
    await db.transaction(async (tx) => {
      tx.run('DELETE FROM post_tags WHERE post_id = ?', [req.params.id]);
      tx.run('DELETE FROM posts WHERE id = ?', [req.params.id]);
    });
    invalidatePublicCache();
    res.json({ message: 'Post deleted' });
  } catch (err) {
    console.error('Delete post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== TAG ROUTES =====

// GET /api/tags - List all tags (published posts only, with counts)
router.get('/tags', async (req, res) => {
  try {
    const result = await db.exec(
      `SELECT t.id, t.name, COUNT(pt.post_id) as post_count
       FROM tags t
       LEFT JOIN post_tags pt ON t.id = pt.tag_id
       LEFT JOIN posts p ON pt.post_id = p.id AND p.published = 1
       WHERE p.id IS NOT NULL
       GROUP BY t.id
       ORDER BY post_count DESC, t.name`
    );
    const tags = result.length > 0 ? result[0].values.map((row) => ({ id: row[0], name: row[1], post_count: row[2] })) : [];
    res.json({ tags });
  } catch (err) {
    console.error('List tags error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tags - Create tag (admin)
router.post('/tags', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Tag name is required' });
    }
    await db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [String(name).trim()]);
    invalidatePublicCache();
    res.status(201).json({ message: 'Tag created' });
  } catch (err) {
    console.error('Create tag error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== UPLOAD ROUTES =====

// POST /api/upload - Upload image (admin)
router.post('/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({
    message: 'File uploaded successfully',
    filename: req.file.filename,
    path: '/uploads/' + req.file.filename
  });
});

// GET /api/uploads - List uploaded images (admin)
router.get('/uploads', requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR)
      .filter((f) => extRegex.test(path.extname(f).toLowerCase()))
      .map((name) => {
        const stat = fs.statSync(path.join(UPLOAD_DIR, name));
        return { name, size: stat.size, mtime: stat.mtime.toISOString(), url: '/uploads/' + name };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json({ uploads: files });
  } catch (err) {
    console.error('List uploads error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/uploads/:filename - Delete an uploaded image (admin)
router.delete('/uploads/:filename', requireAuth, (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!filePath.startsWith(UPLOAD_DIR)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    fs.unlinkSync(filePath);
    res.json({ message: 'File deleted', filename });
  } catch (err) {
    console.error('Delete upload error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== PASSWORD CHANGE =====

// PUT /api/auth/password - Change password (admin)
router.put('/auth/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < (config.auth.minPasswordLength || 6)) {
      return res.status(400).json({ error: 'New password must be at least ' + (config.auth.minPasswordLength || 6) + ' characters' });
    }

    const result = await db.exec('SELECT password_hash FROM users WHERE id = ?', [req.session.userId]);

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [currentHash] = result[0].values[0];
    const valid = await bcrypt.compare(currentPassword, currentHash);

    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, config.auth.bcryptRounds || 10);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.session.userId]);

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

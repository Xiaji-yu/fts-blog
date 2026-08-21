const express = require('express');
const router = express.Router();
const initSqlJs = require('sql.js');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');

const DB_PATH = path.join(__dirname, '..', 'data', 'blog.db');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Helper to get database connection
async function getDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    return new SQL.Database(fileBuffer);
  }
  return new SQL.Database();
}

// Helper to save database (serialized writes prevent race conditions)
const saveDbQueue = [];
let saveDbProcessing = false;

function withTimeout(promise, ms = 30000) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Database save timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timeoutId)), timeoutPromise]);
}

async function saveDb(db) {
  return new Promise((resolve, reject) => {
    saveDbQueue.push({ db, resolve, reject });
    processSaveDbQueue();
  });
}

async function processSaveDbQueue() {
  if (saveDbProcessing || saveDbQueue.length === 0) return;
  saveDbProcessing = true;

  const { db, resolve, reject } = saveDbQueue.shift();
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    await withTimeout(fs.promises.writeFile(DB_PATH, buffer), 30000);
    db.close();
    resolve();
  } catch (err) {
    console.error('saveDb error:', err);
    db.close();
    reject(err);
  } finally {
    saveDbProcessing = false;
    if (saveDbQueue.length > 0) {
      processSaveDbQueue();
    }
  }
}

// ===== AUTH ROUTES =====

// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const db = await getDb();
    const result = db.exec("SELECT id, password_hash FROM users WHERE username = ?", [username]);

    if (result.length === 0 || result[0].values.length === 0) {
      db.close();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const [userId, passwordHash] = result[0].values[0];
    const valid = await bcrypt.compare(password, passwordHash);

    if (!valid) {
      db.close();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId = userId;
    req.session.username = username;
    db.close();

    res.json({ message: 'Login successful', user: { id: userId, username } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/logout
router.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logout successful' });
  });
});

// ===== POST ROUTES =====

// GET /api/posts - List all published posts (paginated)
router.get('/posts', async (req, res) => {
  try {
    const db = await getDb();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const result = db.exec(
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

    const posts = result.length > 0 ? result[0].values.map(row => ({
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
      tags: row[10] ? row[10].split(',') : []
    })) : [];

    // Get total count
    const countResult = db.exec("SELECT COUNT(*) FROM posts WHERE published = 1");
    const total = countResult.length > 0 ? countResult[0].values[0][0] : 0;

    db.close();

    res.json({
      posts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/posts/:slug - Get single post by slug
router.get('/posts/:slug', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(
      "SELECT * FROM posts WHERE slug = ? AND published = 1",
      [req.params.slug]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      db.close();
      return res.status(404).json({ error: 'Post not found' });
    }

    const row = result[0].values[0];
    const tagsResult = db.exec(
      "SELECT t.name FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?",
      [row[0]]
    );
    const tags = tagsResult.length > 0 ? tagsResult[0].values.map(t => t[0]) : [];

    db.close();

    res.json({
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
      tags
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/posts/id/:id - Get single post by ID (admin)
router.get('/posts/id/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec("SELECT * FROM posts WHERE id = ?", [req.params.id]);

    if (result.length === 0 || result[0].values.length === 0) {
      db.close();
      return res.status(404).json({ error: 'Post not found' });
    }

    const row = result[0].values[0];
    const tagsResult = db.exec(
      "SELECT t.name FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?",
      [row[0]]
    );
    const tags = tagsResult.length > 0 ? tagsResult[0].values.map(t => t[0]) : [];

    db.close();

    res.json({
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
      tags
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts - Create new post (admin)
router.post('/posts', requireAuth, async (req, res) => {
  try {
    const { title, title_en, slug, content, excerpt, published, tags } = req.body;

    if (!title || !slug || !content) {
      return res.status(400).json({ error: 'Title, slug, and content are required' });
    }

    const db = await getDb();
    const now = new Date().toISOString();

    db.run(
      "INSERT INTO posts (title, title_en, slug, content, excerpt, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [title, title_en || null, slug, content, excerpt || null, published ? 1 : 0, now, now]
    );

    const postId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];

    // Handle tags - support both comma-separated string and array
    if (tags) {
      const tagList = Array.isArray(tags)
        ? tags.map(t => t.trim()).filter(t => t)
        : String(tags).split(',').map(t => t.trim()).filter(t => t);

      for (const tagName of tagList) {
        if (!tagName.trim()) continue;

        // Insert tag if not exists
        const tagResult = db.exec("SELECT id FROM tags WHERE name = ?", [tagName.trim()]);
        let tagId;
        if (tagResult.length === 0 || tagResult[0].values.length === 0) {
          db.run("INSERT INTO tags (name) VALUES (?)", [tagName.trim()]);
          tagId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];
        } else {
          tagId = tagResult[0].values[0][0];
        }

        // Link post to tag
        db.run("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)", [postId, tagId]);
      }
    }

    await saveDb(db);

    res.status(201).json({ message: 'Post created', id: postId });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/posts/:id - Update post (admin)
router.put('/posts/:id', requireAuth, async (req, res) => {
  try {
    const { title, title_en, slug, content, excerpt, published, tags } = req.body;
    const postId = req.params.id;

    if (!title || !slug || !content) {
      return res.status(400).json({ error: 'Title, slug, and content are required' });
    }

    const db = await getDb();
    const now = new Date().toISOString();

    // published comes as "on" from checkbox or boolean
    const publishedVal = (published === 'on' || published === true || published === 'true') ? 1 : 0;

    db.run(
      "UPDATE posts SET title = ?, title_en = ?, slug = ?, content = ?, excerpt = ?, published = ?, updated_at = ? WHERE id = ?",
      [title, title_en || null, slug, content, excerpt || null, publishedVal, now, postId]
    );

    // Remove old tags
    db.run("DELETE FROM post_tags WHERE post_id = ?", [postId]);

    // Handle tags - support both comma-separated string and array
    if (tags) {
      const tagList = Array.isArray(tags)
        ? tags.map(t => t.trim()).filter(t => t)
        : String(tags).split(',').map(t => t.trim()).filter(t => t);

      for (const tagName of tagList) {
        const tagResult = db.exec("SELECT id FROM tags WHERE name = ?", [tagName]);
        let tagId;
        if (tagResult.length === 0 || tagResult[0].values.length === 0) {
          db.run("INSERT INTO tags (name) VALUES (?)", [tagName]);
          tagId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];
        } else {
          tagId = tagResult[0].values[0][0];
        }

        db.run("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)", [postId, tagId]);
      }
    }

    await saveDb(db);

    res.json({ message: 'Post updated' });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// DELETE /api/posts/:id - Delete post (admin)
router.delete('/posts/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    db.run("DELETE FROM post_tags WHERE post_id = ?", [req.params.id]);
    db.run("DELETE FROM posts WHERE id = ?", [req.params.id]);
    await saveDb(db);

    res.json({ message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== TAG ROUTES =====

// GET /api/tags - List all tags
router.get('/tags', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec("SELECT id, name FROM tags ORDER BY name");
    const tags = result.length > 0 ? result[0].values.map(row => ({ id: row[0], name: row[1] })) : [];
    db.close();

    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tags - Create tag (admin)
router.post('/tags', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    const db = await getDb();
    db.run("INSERT OR IGNORE INTO tags (name) VALUES (?)", [name.trim()]);
    await saveDb(db);

    res.status(201).json({ message: 'Tag created' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== UPLOAD ROUTE =====

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

// ===== PASSWORD CHANGE =====

// PUT /api/auth/password - Change password (admin)
router.put('/auth/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const db = await getDb();
    const result = db.exec("SELECT password_hash FROM users WHERE id = ?", [req.session.userId]);

    if (result.length === 0 || result[0].values.length === 0) {
      db.close();
      return res.status(404).json({ error: 'User not found' });
    }

    const [currentHash] = result[0].values[0];
    const valid = await bcrypt.compare(currentPassword, currentHash);

    if (!valid) {
      db.close();
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    db.run("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, req.session.userId]);
    await saveDb(db);

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

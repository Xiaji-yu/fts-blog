const express = require('express');
const router = express.Router();
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const marked = require('marked');

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

// GET / - Homepage
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(
      `SELECT p.*, GROUP_CONCAT(t.name) as tags
       FROM posts p
       LEFT JOIN post_tags pt ON p.id = pt.post_id
       LEFT JOIN tags t ON pt.tag_id = t.id
       WHERE p.published = 1
       GROUP BY p.id
       ORDER BY p.created_at DESC`
    );

    let posts = [];
    let postCount = 0;

    if (result.length > 0) {
      const countResult = db.exec("SELECT COUNT(*) FROM posts WHERE published = 1");
      postCount = countResult.length > 0 ? countResult[0].values[0][0] : 0;

      posts = result[0].values.map(row => ({
        id: row[0],
        title: row[1],
        title_en: row[2],
        slug: row[3],
        excerpt: row[5],
        cover_image: row[6],
        created_at: row[8],
        tags: row[10] ? row[10].split(',') : []
      }));
    }

    db.close();

    res.render('index', {
      title: '夏祭博客 · Xiaji\'s Blog',
      posts,
      postCount,
      blueprint: true,
      nMark: true
    });
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// GET /post/:id - Single post page
router.get('/post/:id', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(
      "SELECT * FROM posts WHERE id = ? AND published = 1",
      [req.params.id]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      db.close();
      return res.status(404).render('404', {
        title: '404 - Not Found',
        blueprint: true,
        nMark: true
      });
    }

    const row = result[0].values[0];
    const tagsResult = db.exec(
      "SELECT t.name FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?",
      [row[0]]
    );
    const tags = tagsResult.length > 0 ? tagsResult[0].values.map(t => t[0]) : [];

    // Calculate reading time (avg 200 chars/min)
    const wordCount = row[4].length;
    const readTime = Math.max(1, Math.ceil(wordCount / 200));

    db.close();

    res.render('post', {
      title: row[1],
      post: {
        id: row[0],
        title: row[1],
        title_en: row[2],
        slug: row[3],
        content: row[4],
        excerpt: row[5],
        cover_image: row[6],
        created_at: row[8],
        tags
      },
      readTime,
      blueprint: true,
      nMark: true
    });
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// GET /api - API info page
router.get('/api', (req, res) => {
  res.render('api-info', {
    title: 'API Documentation',
    blueprint: true,
    nMark: true
  });
});

module.exports = router;

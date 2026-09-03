'use strict';
const express = require('express');
const router = express.Router();
const config = require('../config/loader');
const db = require('../database/db');
const cache = require('../lib/cache');
const viewCounter = require('../lib/viewCounter');

const BASE_URL = (config.site.url || config.server.publicUrl || 'http://localhost:3000').replace(/\/+$/, '');

const POST_SELECT = `p.*, GROUP_CONCAT(t.name) as tags`;

async function fetchPublishedPosts({ tag, limit, offset, search }) {
  let sql = `
    SELECT ${POST_SELECT}
    FROM posts p
    LEFT JOIN post_tags pt ON p.id = pt.post_id
    LEFT JOIN tags t ON pt.tag_id = t.id
    WHERE p.published = 1
  `;
  const params = [];

  if (tag) {
    sql += ` AND p.id IN (
      SELECT pt2.post_id FROM post_tags pt2 JOIN tags t2 ON t2.id = pt2.tag_id WHERE t2.name = ?
    )`;
    params.push(tag);
  }

  if (search) {
    sql += ` AND (p.title LIKE ? ESCAPE '\\' OR p.excerpt LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\')`;
    const pattern = '%' + escapeLike(search) + '%';
    params.push(pattern, pattern, pattern);
  }

  sql += ` GROUP BY p.id ORDER BY p.created_at DESC`;

  if (limit) {
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset || 0);
  }

  const result = await db.exec(sql, params);
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    title: row[1],
    title_en: row[2],
    slug: row[3],
    excerpt: row[5],
    cover_image: row[6],
    created_at: row[8],
    view_count: row[10] !== undefined ? row[10] : 0,
    read_time: Math.max(1, Math.ceil((row[4] ? row[4].length : 0) / (config.site.readingTimeCharsPerMinute || 200))),
    tags: row[11] ? row[11].split(',') : []
  }));
}

/**
 * Aggregate "blueprint library" stats for the homepage status panel.
 * Single query, cached at the route level like the post list itself.
 */
async function fetchSiteStats() {
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM posts p WHERE p.published = 1) AS post_count,
      (SELECT COUNT(DISTINCT t.id) FROM tags t
         JOIN post_tags pt ON t.id = pt.tag_id
         JOIN posts p ON p.id = pt.post_id
       WHERE p.published = 1) AS tag_count,
      (SELECT COALESCE(SUM(view_count), 0) FROM posts p WHERE p.published = 1) AS view_total,
      (SELECT COALESCE(SUM(LENGTH(content)), 0) FROM posts p WHERE p.published = 1) AS char_total,
      (SELECT MAX(updated_at) FROM posts p WHERE p.published = 1) AS last_updated
  `;
  const result = await db.exec(sql);
  if (result.length === 0) return null;
  const row = result[0].values[0];
  return {
    postCount: row[0],
    tagCount: row[1],
    viewTotal: row[2],
    charTotal: row[3],
    lastUpdated: row[4] || null
  };
}

/** Most-viewed published posts, used for the "hot drawings" strip. */
async function fetchHotPosts(limit = 3) {
  const result = await db.exec(
    `SELECT id, title, view_count
     FROM posts
     WHERE published = 1
     ORDER BY view_count DESC, created_at DESC, id DESC
     LIMIT ?`,
    [limit]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    title: row[1],
    view_count: row[2]
  }));
}

async function countPublished({ tag, search }) {
  let sql = 'SELECT COUNT(*) FROM posts p WHERE p.published = 1';
  const params = [];
  if (tag) {
    sql += ` AND p.id IN (SELECT pt2.post_id FROM post_tags pt2 JOIN tags t2 ON t2.id = pt2.tag_id WHERE t2.name = ?)`;
    params.push(tag);
  }
  if (search) {
    sql += ` AND (p.title LIKE ? ESCAPE '\\' OR p.excerpt LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\')`;
    const pattern = '%' + escapeLike(search) + '%';
    params.push(pattern, pattern, pattern);
  }
  const result = await db.exec(sql, params);
  return result.length > 0 ? result[0].values[0][0] : 0;
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (m) => '\\' + m);
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toRfc822(dateStr) {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

// GET / - Homepage (latest 12 posts + preview, no pagination)
router.get('/', async (req, res) => {
  try {
    const limit = 12;
    const cacheKey = 'homepage:1';

    let data = cache.get(cacheKey);
    if (!data) {
      const [posts, total, stats, hotPosts] = await Promise.all([
        fetchPublishedPosts({ limit, offset: 0 }),
        countPublished({}),
        fetchSiteStats(),
        fetchHotPosts(3)
      ]);
      data = { posts, total, stats, hotPosts };
      cache.set(cacheKey, data);
    }

    res.render('index', {
      title: `${config.site.name} · ${config.site.tagline}`,
      posts: data.posts,
      postCount: data.total,
      stats: data.stats,
      hotPosts: data.hotPosts,
      hasMore: data.total > limit,
      blueprint: config.features.blueprint,
      nMark: config.features.nMark
    });
  } catch (err) {
    console.error('Homepage error:', err);
    res.status(500).send('Server error');
  }
});

// GET /posts - Full archive (all published posts, scrollable list)
router.get('/posts', async (req, res) => {
  try {
    const cacheKey = 'posts:all';

    let posts = cache.get(cacheKey);
    if (!posts) {
      posts = await fetchPublishedPosts({});
      cache.set(cacheKey, posts);
    }

    const stats = await fetchSiteStats();

    res.render('posts', {
      title: `全部图纸 · All Posts — ${config.site.name}`,
      posts,
      postCount: posts.length,
      stats,
      blueprint: config.features.blueprint,
      nMark: config.features.nMark
    });
  } catch (err) {
    console.error('Posts page error:', err);
    res.status(500).send('Server error');
  }
});

// GET /post/:id - Single post page
router.get('/post/:id', async (req, res) => {
  try {
    const result = await db.exec('SELECT * FROM posts WHERE id = ? AND published = 1', [req.params.id]);

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).render('404', {
        title: config.errors['404'].title,
        blueprint: config.features.blueprint,
        nMark: config.features.nMark
      });
    }

    const row = result[0].values[0];
    const tagsResult = await db.exec(
      'SELECT t.name FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?',
      [row[0]]
    );
    const tags = tagsResult.length > 0 ? tagsResult[0].values.map((t) => t[0]) : [];

    // Reading time (avg chars/min from config)
    const wordCount = row[4] ? row[4].length : 0;
    const readTime = Math.max(1, Math.ceil(wordCount / (config.site.readingTimeCharsPerMinute || 200)));

    // View counter (debounced, batched — not a full-file write per view)
    viewCounter.increment(row[0]);

    // Previous / next navigation (older / newer by created_at, id as tiebreaker)
    const prevResult = await db.exec(
      'SELECT id, title FROM posts WHERE published = 1 AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT 1',
      [row[8], row[8], row[0]]
    );
    const nextResult = await db.exec(
      'SELECT id, title FROM posts WHERE published = 1 AND (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at ASC, id ASC LIMIT 1',
      [row[8], row[8], row[0]]
    );
    const prevPost = prevResult.length > 0 ? { id: prevResult[0].values[0][0], title: prevResult[0].values[0][1] } : null;
    const nextPost = nextResult.length > 0 ? { id: nextResult[0].values[0][0], title: nextResult[0].values[0][1] } : null;

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
        view_count: row[10] !== undefined ? row[10] : 0,
        tags
      },
      readTime,
      prevPost,
      nextPost,
      blueprint: config.features.blueprint,
      nMark: config.features.nMark
    });
  } catch (err) {
    console.error('Post page error:', err);
    res.status(500).send('Server error');
  }
});

// GET /tags - Tag index with post counts
router.get('/tags', async (req, res) => {
  try {
    let tags = cache.get('tags:all');
    if (!tags) {
      const result = await db.exec(
        `SELECT t.name, COUNT(pt.post_id) as post_count
         FROM tags t
         LEFT JOIN post_tags pt ON t.id = pt.tag_id
         LEFT JOIN posts p ON pt.post_id = p.id AND p.published = 1
         WHERE p.id IS NOT NULL
         GROUP BY t.id
         ORDER BY post_count DESC, t.name`
      );
      tags = result.length > 0 ? result[0].values.map((row) => ({ name: row[0], post_count: row[1] })) : [];
      cache.set('tags:all', tags);
    }
    res.render('tags', {
      title: `标签 · Tags — ${config.site.name}`,
      tags,
      blueprint: config.features.blueprint,
      nMark: config.features.nMark,
      noSplash: true
    });
  } catch (err) {
    console.error('Tags page error:', err);
    res.status(500).send('Server error');
  }
});

// GET /tag/:name - Posts for a tag
router.get('/tag/:name', async (req, res) => {
  try {
    // Express already decodes the route param once; do not decode again.
    const name = req.params.name;
    const [posts, total] = await Promise.all([
      fetchPublishedPosts({ tag: name, limit: 100 }),
      countPublished({ tag: name })
    ]);
    res.render('search', {
      title: `#${name} — ${config.site.name}`,
      heading: `标签 · Tag: #${name}`,
      query: name,
      mode: 'tag',
      posts,
      total,
      blueprint: config.features.blueprint,
      nMark: config.features.nMark,
      noSplash: true
    });
  } catch (err) {
    console.error('Tag page error:', err);
    res.status(500).send('Server error');
  }
});

// GET /search - Full-text-ish search across published posts
router.get('/search', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) {
      return res.render('search', {
        title: `搜索 · Search — ${config.site.name}`,
        heading: '搜索 · SEARCH',
        query: '',
        mode: 'search',
        posts: [],
        total: 0,
        blueprint: config.features.blueprint,
        nMark: config.features.nMark,
        noSplash: true
      });
    }
    const [posts, total] = await Promise.all([
      fetchPublishedPosts({ search: query, limit: 50 }),
      countPublished({ search: query })
    ]);
    res.render('search', {
      title: `搜索 "${query}" — ${config.site.name}`,
      heading: `搜索 · Search: "${query}"`,
      query,
      mode: 'search',
      posts,
      total,
      blueprint: config.features.blueprint,
      nMark: config.features.nMark,
      noSplash: true
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).send('Server error');
  }
});

// GET /random - Jump to a random published post (fun way to rediscover content)
router.get('/random', async (req, res) => {
  try {
    const result = await db.exec('SELECT id FROM posts WHERE published = 1 ORDER BY RANDOM() LIMIT 1');
    if (result.length === 0 || result[0].values.length === 0) {
      return res.redirect('/');
    }
    res.redirect('/post/' + result[0].values[0][0]);
  } catch (err) {
    console.error('Random post error:', err);
    res.redirect('/');
  }
});

// GET /feed.xml - RSS 2.0 feed
router.get('/feed.xml', async (req, res) => {
  try {
    const posts = await fetchPublishedPosts({ limit: 20 });
    const items = posts.map((post) => {
      const description = (post.excerpt || (post.title + ' — ' + (post.title_en || ''))).slice(0, 500);
      return `
  <item>
    <title>${escapeXml(post.title)}</title>
    <link>${BASE_URL}/post/${post.id}</link>
    <guid isPermaLink="true">${BASE_URL}/post/${post.id}</guid>
    <pubDate>${toRfc822(post.created_at)}</pubDate>
    <description>${escapeXml(description)}</description>
  </item>`;
    }).join('');

    const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(config.site.name)}</title>
    <link>${BASE_URL}</link>
    <description>${escapeXml(config.site.description || config.site.tagline || '')}</description>
    <atom:link href="${BASE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;

    res.type('application/rss+xml; charset=utf-8').send(feed);
  } catch (err) {
    console.error('Feed error:', err);
    res.status(500).send('Server error');
  }
});

// GET /api - API info page
router.get('/api', (req, res) => {
  res.render('api-info', {
    title: config.api.pageTitle,
    blueprint: config.features.blueprint,
    nMark: config.features.nMark,
    noSplash: true
  });
});

module.exports = router;

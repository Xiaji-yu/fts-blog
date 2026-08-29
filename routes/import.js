'use strict';
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const config = require('../config/loader');
const db = require('../database/db');
const { requireAuth, requireAuthView } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/csrf');
const cache = require('../lib/cache');
const { normalizeYamlValue, parseFrontmatter, convertObsidianSyntax } = require('../lib/obsidian');

const OBSIDIAN_DIR = path.join(__dirname, '..', config.import.obsidianDir || '经验');

// All non-safe methods require a valid CSRF token.
router.use(csrfProtect);

// GET /admin/import - Import page
router.get('/import', requireAuthView, (req, res) => {
  res.render('admin-import', {
    title: 'Import from Obsidian',
    username: req.session.username,
    blueprint: true,
    nMark: true
  });
});

// Generate a URL-safe slug from a filename (keeps CJK characters)
function slugFromFilename(filename) {
  const base = path.basename(filename, config.import.fileExtension || '.md');
  return base
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function insertPostWithTags(tx, { title, titleEn, slug, content, excerpt, tags }) {
  const now = new Date().toISOString();
  tx.run(
    `INSERT INTO posts (title, title_en, slug, content, excerpt, published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    [title, titleEn, slug, content, excerpt, now, now]
  );
  const postId = tx.lastInsertRowid();

  const tagList = Array.isArray(tags)
    ? tags.map((t) => String(t).trim()).filter(Boolean)
    : String(tags || '').split(',').map((t) => String(t).trim()).filter(Boolean);

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
  return postId;
}

// Sanitize errors before exposing them to the admin UI (never leak SQLite internals).
function sanitizeImportError(message) {
  if (/UNIQUE constraint failed/i.test(message || '')) {
    return 'duplicate slug（该文章已存在，跳过）';
  }
  return String(message || 'Unknown error').slice(0, 200);
}

// POST /admin/import/directory - Scan 经验/ folder and import all .md files
router.post('/import/directory', requireAuthView, async (req, res) => {
  try {
    if (!fs.existsSync(OBSIDIAN_DIR)) {
      return res.json({
        success: false,
        imported: 0,
        failed: 0,
        details: { imported: [], failed: [{ error: `${config.import.obsidianDirLabel || '经验/'} 目录不存在` }] }
      });
    }

    const files = fs.readdirSync(OBSIDIAN_DIR)
      .filter((f) => f.endsWith(config.import.fileExtension || '.md'))
      .sort();

    if (files.length === 0) {
      return res.json({ success: true, imported: 0, failed: 0, details: { imported: [], failed: [] } });
    }

    const result = await db.transaction(async (tx) => {
      const imported = [];
      const failed = [];

      // Build slug -> id map for internal wiki links
      const slugMapResult = tx.exec("SELECT slug, id FROM posts WHERE slug IS NOT NULL AND slug != ''");
      const slugToIdMap = {};
      for (const row of slugMapResult[0]?.values || []) {
        slugToIdMap[row[0]] = row[1];
      }

      for (const filename of files) {
        try {
          // Path traversal protection: strip directory components and verify
          const sanitized = path.basename(filename);
          if (sanitized !== filename) {
            failed.push({ filename, error: 'Invalid filename: path traversal detected' });
            continue;
          }
          const filePath = path.join(OBSIDIAN_DIR, sanitized);
          if (!filePath.startsWith(OBSIDIAN_DIR)) {
            failed.push({ filename, error: 'Path traversal detected' });
            continue;
          }

          const rawContent = fs.readFileSync(filePath, 'utf-8');
          const { frontmatter, content: markdownContent } = parseFrontmatter(rawContent);

          const normalized = {};
          for (const [key, value] of Object.entries(frontmatter)) {
            normalized[key] = normalizeYamlValue(value);
          }

          const title = normalized.title || path.basename(filename, config.import.fileExtension || '.md');
          const titleEn = normalized.title_en || '';
          const slug = slugFromFilename(filename);

          const excerptMatch = markdownContent.match(/^(.+?)(?:\n\n|$)/s);
          const excerpt = excerptMatch ? excerptMatch[1].substring(0, config.import.excerptMaxLength || 200) : '';

          const convertedContent = convertObsidianSyntax(markdownContent, slugToIdMap);

          // Skip if post with this slug already exists (idempotent re-import)
          const existing = tx.exec('SELECT id FROM posts WHERE slug = ?', [slug]);
          if (existing.length > 0 && existing[0].values.length > 0) {
            imported.push({ filename, title, slug, skipped: true });
            continue;
          }

          await insertPostWithTags(tx, {
            title, titleEn, slug, content: convertedContent, excerpt, tags: normalized.tags
          });
          imported.push({ filename, title, slug });
        } catch (err) {
          failed.push({ filename, error: sanitizeImportError(err.message) });
        }
      }
      return { imported, failed };
    });

    cache.invalidateAll();
    res.json({
      success: true,
      imported: result.imported.length,
      failed: result.failed.length,
      details: result
    });
  } catch (err) {
    console.error('Directory import failed:', err);
    res.status(500).json({ error: 'Directory import failed: ' + err.message });
  }
});

// POST /admin/import - Process imported files (client-side parsed content)
router.post('/import', requireAuthView, async (req, res) => {
  try {
    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const result = await db.transaction(async (tx) => {
      const imported = [];
      const failed = [];

      const slugMapResult = tx.exec("SELECT slug, id FROM posts WHERE slug IS NOT NULL AND slug != ''");
      const slugToIdMap = {};
      for (const row of slugMapResult[0]?.values || []) {
        slugToIdMap[row[0]] = row[1];
      }

      for (const file of files) {
        try {
          const { filename, content, frontmatter } = file;

          // Client may already have converted syntax; parse frontmatter again
          const { frontmatter: parsedFrontmatter, content: markdownContent } = parseFrontmatter(content || '');
          const mergedFrontmatter = { ...parsedFrontmatter, ...frontmatter };

          const title = mergedFrontmatter.title || path.basename(filename, config.import.fileExtension || '.md');
          const titleEn = mergedFrontmatter.title_en || '';
          const slug = slugFromFilename(filename);

          const excerptMatch = markdownContent.match(/^(.+?)(?:\n\n|$)/s);
          const excerpt = excerptMatch ? excerptMatch[1].substring(0, config.import.excerptMaxLength || 200) : '';

          const convertedContent = convertObsidianSyntax(markdownContent, slugToIdMap);

          // Skip if post with this slug already exists (idempotent re-import)
          const existing = tx.exec('SELECT id FROM posts WHERE slug = ?', [slug]);
          if (existing.length > 0 && existing[0].values.length > 0) {
            imported.push({ filename, title, slug, skipped: true });
            continue;
          }

          await insertPostWithTags(tx, {
            title, titleEn, slug, content: convertedContent, excerpt, tags: mergedFrontmatter.tags
          });
          imported.push({ filename, title, slug });
        } catch (err) {
          failed.push({ filename: file.filename, error: sanitizeImportError(err.message) });
        }
      }
      return { imported, failed };
    });

    cache.invalidateAll();
    res.json({
      success: true,
      imported: result.imported.length,
      failed: result.failed.length,
      details: result
    });
  } catch (err) {
    console.error('Import failed:', err);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

// GET /api/import/status - Get import status
router.get('/import/status', requireAuth, async (req, res) => {
  try {
    const result = await db.exec('SELECT COUNT(*) as count FROM posts WHERE published = 1');
    const published = result.length > 0 ? result[0].values[0][0] : 0;

    const totalResult = await db.exec('SELECT COUNT(*) as count FROM posts');
    const total = totalResult.length > 0 ? totalResult[0].values[0][0] : 0;

    res.json({ total, published, drafts: total - published });
  } catch (err) {
    console.error('Import status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

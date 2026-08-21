const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const initSqlJs = require('sql.js');
const bcrypt = require('bcrypt');
const { requireAuth, requireAuthView } = require('../middleware/auth');

const DB_PATH = path.join(__dirname, '..', 'data', 'blog.db');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const OBSIDIAN_DIR = path.join(__dirname, '..', '经验');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
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

// GET /admin/import - Import page
router.get('/import', requireAuthView, (req, res) => {
  res.render('admin-import', {
    title: 'Import from Obsidian',
    username: req.session.username,
    blueprint: true,
    nMark: true
  });
});

// Helper: Normalize YAML-parsed values (dates, etc.)
function normalizeYamlValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

// POST /admin/import/directory - Scan 经验/ folder and import all .md files
router.post('/import/directory', requireAuthView, async (req, res) => {
  try {
    if (!fs.existsSync(OBSIDIAN_DIR)) {
      return res.json({
        success: false,
        imported: 0,
        failed: 0,
        details: { imported: [], failed: [{ error: '经验/ 目录不存在' }] }
      });
    }

    const files = fs.readdirSync(OBSIDIAN_DIR)
      .filter(f => f.endsWith('.md'))
      .sort();

    if (files.length === 0) {
      return res.json({
        success: true,
        imported: 0,
        failed: 0,
        details: { imported: [], failed: [] }
      });
    }

    const db = await getDb();
    const now = new Date().toISOString();
    const imported = [];
    const failed = [];

    // Build slug -> id map for internal wiki links
    const slugMapResult = db.exec("SELECT slug, id FROM posts WHERE slug IS NOT NULL AND slug != ''");
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

        // Normalize frontmatter values
        const normalized = {};
        for (const [key, value] of Object.entries(frontmatter)) {
          normalized[key] = normalizeYamlValue(value);
        }

        const title = normalized.title || path.basename(filename, '.md');
        const titleEn = normalized.title_en || '';
        const slug = path.basename(filename, '.md')
          .toLowerCase()
          .replace(/[^a-z0-9一-龥]+/g, '-')
          .replace(/^-+|-+$/g, '');

        const excerptMatch = markdownContent.match(/^(.+?)(?:\n\n|$)/s);
        const excerpt = excerptMatch ? excerptMatch[1].substring(0, 200) : '';

        const convertedContent = convertObsidianSyntax(markdownContent, slugToIdMap);

        // Skip if post with this slug already exists (idempotent re-import)
        const existing = db.exec("SELECT id FROM posts WHERE slug = ?", [slug]);
        if (existing.length > 0 && existing[0].values.length > 0) {
          imported.push({ filename, title, slug, skipped: true });
          continue;
        }

        db.run(
          `INSERT INTO posts (title, title_en, slug, content, excerpt, published, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          [title, titleEn, slug, convertedContent, excerpt, now, now]
        );

        const postId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];

        // Handle tags
        const tags = normalized.tags;
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

        imported.push({ filename, title, slug });
      } catch (err) {
        failed.push({ filename, error: err.message });
      }
    }

    const saveResult = await saveDb(db);

    res.json({
      success: true,
      imported: imported.length,
      failed: failed.length,
      details: { imported, failed }
    });
  } catch (err) {
    res.status(500).json({ error: 'Directory import failed: ' + err.message });
  }
});

// POST /admin/import - Process imported files
router.post('/import', requireAuthView, async (req, res) => {
  try {
    const { files, options } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const db = await getDb();
    const now = new Date().toISOString();
    const imported = [];
    const failed = [];

    // Build slug -> id map for internal wiki links
    const slugMapResult = db.exec("SELECT slug, id FROM posts WHERE slug IS NOT NULL AND slug != ''");
    const slugToIdMap = {};
    for (const row of slugMapResult[0]?.values || []) {
      slugToIdMap[row[0]] = row[1];
    }

    for (const file of files) {
      try {
        const { filename, content, frontmatter } = file;

        // Parse frontmatter from content
        const { frontmatter: parsedFrontmatter, content: markdownContent } = parseFrontmatter(content);

        // Merge frontmatter (client-side takes precedence)
        const mergedFrontmatter = { ...parsedFrontmatter, ...frontmatter };

        // Extract title from frontmatter or filename
        const title = mergedFrontmatter.title || path.basename(filename, '.md');
        const titleEn = mergedFrontmatter.title_en || '';

        // Generate slug from filename
        const slug = path.basename(filename, '.md')
          .toLowerCase()
          .replace(/[^a-z0-9一-龥]+/g, '-')
          .replace(/^-+|-+$/g, '');

        // Extract excerpt (first paragraph after frontmatter)
        const excerptMatch = markdownContent.match(/^(.+?)(?:\n\n|$)/s);
        const excerpt = excerptMatch ? excerptMatch[1].substring(0, 200) : '';

        // Convert Obsidian-specific syntax
        const convertedContent = convertObsidianSyntax(markdownContent, slugToIdMap);

        // Insert post
        db.run(
          `INSERT INTO posts (title, title_en, slug, content, excerpt, published, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          [title, titleEn, slug, convertedContent, excerpt, now, now]
        );

        const postId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];

        // Handle tags from frontmatter
        if (frontmatter?.tags) {
          const tagList = Array.isArray(frontmatter.tags)
            ? frontmatter.tags
            : String(frontmatter.tags).split(',').map(t => t.trim()).filter(t => t);

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

        imported.push({ filename, title, slug });
      } catch (err) {
        failed.push({ filename: file.filename, error: err.message });
      }
    }

    const saveResult = await saveDb(db);

    res.json({
      success: true,
      imported: imported.length,
      failed: failed.length,
      details: { imported, failed }
    });
  } catch (err) {
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

// Helper: Parse YAML frontmatter from markdown
// Only treats --- as frontmatter delimiter when it occupies a line by itself
// (avoids confusing content-level horizontal rules with frontmatter end)
function parseFrontmatter(content) {
  // Strip UTF-8 BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  const lines = content.split('\n');

  if (lines[0].trim() !== '---') {
    return { frontmatter: {}, content: content };
  }

  // Find the closing --- (must be on its own line, after at least one content line)
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, content: content };
  }

  const frontmatterText = lines.slice(1, endIndex).join('\n').trim();
  const markdownContent = lines.slice(endIndex + 1).join('\n');

  let frontmatter = {};
  try {
    frontmatter = yaml.load(frontmatterText, { schema: yaml.SAFE_SCHEMA }) || {};
  } catch (err) {
    // If YAML parsing fails, return empty frontmatter
  }

  return { frontmatter, content: markdownContent };
}

// Helper: Convert Obsidian-specific syntax to standard Markdown
// slugToIdMap: optional map of slug -> post id for internal wiki links
function convertObsidianSyntax(content, slugToIdMap = {}) {
  const lines = content.split('\n');
  const result = [];
  let inCallout = false;
  let calloutType = '';
  let calloutIcon = '';
  let calloutLines = [];

  const calloutTypeMap = {
    'note': 'ℹ️', 'info': 'ℹ️',
    'warning': '⚠️', 'danger': '🚨',
    'tip': '💡', 'important': '❗',
    'question': '❓'
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect multi-line callout: > [!type]
    const calloutMatch = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/);
    if (calloutMatch) {
      inCallout = true;
      calloutType = calloutMatch[1].toUpperCase();
      calloutIcon = calloutTypeMap[calloutMatch[1].toLowerCase()] || '📝';
      const firstLine = calloutMatch[2].trim();
      calloutLines = firstLine ? [`> ${calloutIcon} **${calloutType}** ${firstLine}`] : [`> ${calloutIcon} **${calloutType}**`];
      continue;
    }

    if (inCallout) {
      // Check if this line is still part of the callout (starts with >)
      if (line.startsWith('>') || line.trim() === '') {
        if (line.trim() === '') {
          calloutLines.push('>');
        } else {
          calloutLines.push(line);
        }
        continue;
      } else {
        // End of callout
        inCallout = false;
        result.push(...calloutLines);
        result.push(''); // Empty line after callout
        calloutLines = [];
      }
    }

    // Handle table rows - escape pipes inside cell content
    const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|');
    const isTableSeparator = /^\|?[\s\-:]+\|[\s\-:]+\|?$/.test(line.trim());

    if (isTableRow && !isTableSeparator) {
      // Escape pipes inside table cells
      result.push(escapeTablePipes(line));
      continue;
    }

    // Convert embeds ![[file]] before wiki links (avoid conflict)
    let processed = line.replace(/!\[\[([^\]]+)\]\]/g, (match, file) => {
      const ext = path.extname(file).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
        return `![${file}](/uploads/${file})`;
      }
      return `[${file}](/uploads/${file})`;
    });

    // Convert wiki links [[Link]] or [[Link|Alias]]
    processed = processed.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, link, alias) => {
      const text = alias || link;
      const slug = link.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '');
      const postId = slugToIdMap[slug];
      if (postId) {
        return `[${text}](/post/${postId})`;
      }
      return `[${text}](/post/${slug})`;
    });

    result.push(processed);
  }

  // Flush remaining callout
  if (inCallout) {
    result.push(...calloutLines);
  }

  return result.join('\n');
}

// Helper: Escape pipe characters inside markdown table cells
function escapeTablePipes(line) {
  const trimmed = line.trim();
  // Split by | but be careful with escaped pipes \|
  const parts = trimmed.split('|');

  return parts.map(part => {
    // Unescape already escaped pipes, then re-escape all pipes
    return part.replace(/\\\|/g, '|').replace(/\|/g, '\\|');
  }).join('|');
}

// GET /api/import/status - Get import status
router.get('/import/status', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec("SELECT COUNT(*) as count FROM posts WHERE published = 1");
    const published = result.length > 0 ? result[0].values[0][0] : 0;

    const totalResult = db.exec("SELECT COUNT(*) as count FROM posts");
    const total = totalResult.length > 0 ? totalResult[0].values[0][0] : 0;

    db.close();

    res.json({
      total,
      published,
      drafts: total - published
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

#!/usr/bin/env python3
"""Deploy import fixes to the blog server via SSH."""

import paramiko
import sys

import os
if not os.path.exists('deploy_config.py'):
    raise SystemExit('Missing deploy_config.py — copy deploy_config.example.py to deploy_config.py and fill in credentials.')
try:
    from deploy_config import HOST, USER, PASS
except ImportError as e:
    raise SystemExit('deploy_config.py exists but is missing HOST/USER/PASS — add the missing variable(s) and retry.') from e

def ssh_exec(client, cmd, description=''):
    print(f'\n--- {description} ---')
    print(f'$ {cmd}')
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(out)
    if err:
        print(f'STDERR: {err}')
    return out, err

def main():
    print(f'Connecting to {HOST} as {USER}...')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS, timeout=15)
    print('Connected!')

    # ============================================================
    # 1. Fix routes/import.js
    # ============================================================

    # Add OBSIDIAN_DIR constant after UPLOAD_DIR
    ssh_exec(client, """sed -i "/const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');/a\\
const OBSIDIAN_DIR = path.join(__dirname, '..', '经验');" /var/www/fts-blog/routes/import.js""",
             'Add OBSIDIAN_DIR constant')

    # Add normalizeYamlValue helper + POST /admin/import/directory route
    # Insert before the existing POST /admin/import route
    ssh_exec(client, r"""cat > /tmp/new_directory_route.js << 'ENDOFSCRIPT'
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

    for (const filename of files) {
      try {
        const filePath = path.join(OBSIDIAN_DIR, filename);
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        const { frontmatter, content: markdownContent } = parseFrontmatter(rawContent);

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

        const convertedContent = convertObsidianSyntax(markdownContent);

        db.run(
          `INSERT INTO posts (title, title_en, slug, content, excerpt, published, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          [title, titleEn, slug, convertedContent, excerpt, now, now]
        );

        const postId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];

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

    saveDb(db);
    db.close();

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
ENDOFSCRIPT
echo "Written new route to /tmp/new_directory_route.js""", 'Prepare new directory route')

    # Insert the new route before the POST /admin/import route
    ssh_exec(client, r"""python3 -c "
import re

with open('/var/www/fts-blog/routes/import.js', 'r') as f:
    content = f.read()

with open('/tmp/new_directory_route.js', 'r') as f:
    new_route = f.read()

# Insert before '// POST /admin/import - Process imported files'
pattern = r'(\/\/ POST \/admin\/import - Process imported files)'
replacement = new_route + '\n\\1'
content = re.sub(pattern, replacement, content)

with open('/var/www/fts-blog/routes/import.js', 'w') as f:
    f.write(content)

print('Directory route inserted successfully')
"
""", 'Insert directory route into import.js')

    # Fix parseFrontmatter function
    ssh_exec(client, r"""python3 -c "
import re

with open('/var/www/fts-blog/routes/import.js', 'r') as f:
    content = f.read()

old_parse = '''// Helper: Parse YAML frontmatter from markdown
// Only treats --- as frontmatter delimiter when it occupies a line by itself
// (avoids confusing content-level horizontal rules with frontmatter end)
function parseFrontmatter(content) {
  const lines = content.split('\\n');

  if (lines[0].trim() !== '---') {
    return { frontmatter: {}, content: content };
  }

  // Find the closing --- (must be on its own line, after at least one content line)
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\\s*\$/\.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, content: content };
  }

  const frontmatterText = lines.slice(1, endIndex).join('\\n').trim();
  const markdownContent = lines.slice(endIndex + 1).join('\\n');

  let frontmatter = {};
  try {
    frontmatter = yaml.load(frontmatterText) || {};
  } catch (err) {
    // If YAML parsing fails, return empty frontmatter
  }

  return { frontmatter, content: markdownContent };
}'''

new_parse = '''// Helper: Parse YAML frontmatter from markdown
// Only treats --- as frontmatter delimiter when it occupies a line by itself
// (avoids confusing content-level horizontal rules with frontmatter end)
function parseFrontmatter(content) {
  const lines = content.split('\\n');

  if (lines[0].trim() !== '---') {
    return { frontmatter: {}, content: content };
  }

  // Find the closing --- (must be on its own line, after at least one content line)
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\\s*\$/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, content: content };
  }

  const frontmatterText = lines.slice(1, endIndex).join('\\n').trim();
  const markdownContent = lines.slice(endIndex + 1).join('\\n');

  let frontmatter = {};
  try {
    frontmatter = yaml.load(frontmatterText) || {};
  } catch (err) {
    // If YAML parsing fails, return empty frontmatter
  }

  return { frontmatter, content: markdownContent };
}'''

if old_parse in content:
    content = content.replace(old_parse, new_parse)
    print('parseFrontmatter already fixed (no change needed)')
else:
    # The file should already have the correct version from our earlier edit
    print('parseFrontmatter not found in expected form, checking...')
    if 'function parseFrontmatter' in content:
        print('parseFrontmatter exists, should be correct version')
    else:
        print('WARNING: parseFrontmatter not found!')

with open('/var/www/fts-blog/routes/import.js', 'w') as f:
    f.write(content)
"
""", 'Verify parseFrontmatter is correct')

    # ============================================================
    # 2. Fix views/admin-import.ejs
    # ============================================================

    # Add scan button before the upload zone
    ssh_exec(client, r"""python3 -c "
with open('/var/www/fts-blog/views/admin-import.ejs', 'r') as f:
    content = f.read()

old_marker = '  <div class=\"upload-zone\" id=\"dropZone\">'
new_block = '''  <div style=\"background: var(--bg-card); border: 1px solid var(--border); padding: var(--spacing-md); margin-bottom: var(--spacing-md); text-align: center;\">
    <p style=\"color: var(--fg-dim); margin-bottom: var(--spacing-sm);\">
      从 <strong>经验/</strong> 目录批量导入所有 .md 文件（跳过已导入的）
    </p>
    <button id=\"scanBtn\" class=\"btn btn-outline\">
      扫描经验目录 · SCAN & IMPORT
    </button>
  </div>

  <div class=\"upload-zone\" id=\"dropZone\">'''

if old_marker in content:
    content = content.replace(old_marker, new_block, 1)
    print('Scan button block inserted')
else:
    print('ERROR: upload zone marker not found!')

with open('/var/www/fts-blog/views/admin-import.ejs', 'w') as f:
    f.write(content)
"
""", 'Insert scan directory button in admin-import.ejs')

    # Add scan button JavaScript handler
    ssh_exec(client, r"""python3 -c "
with open('/var/www/fts-blog/views/admin-import.ejs', 'r') as f:
    content = f.read()

old_marker = '// Import button'
new_js = '''// Scan & Import button
const scanBtn = document.getElementById('scanBtn');
if (scanBtn) {
  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = '扫描中... · SCANNING...';
    statusDiv.style.display = 'block';
    statusDiv.innerHTML = '<p style=\"color: var(--fg-dim);\">正在扫描 经验/ 目录...</p>';

    try {
      const response = await fetch('/admin/import/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const result = await response.json();

      if (result.success) {
        let html = '<p style=\"color: var(--fg); margin-bottom: 0.5rem;\"><strong>扫描完成</strong></p>';
        html += '<p style=\"color: var(--fg-dim); font-size: 0.9rem;\">';
        html += '成功导入: <strong>' + result.imported + '</strong> 篇<br>';
        html += '失败: <strong>' + result.failed + '</strong> 篇</p>';

        if (result.details.imported.length > 0) {
          html += '<div style=\"margin-top: 1rem;\"><strong style=\"font-size: 0.85rem; color: var(--fg);\">导入的文章:</strong><ul style=\"margin-top: 0.5rem; padding-left: 1.5rem; color: var(--fg-dim);\">';
          result.details.imported.forEach(function(f) { html += '<li>' + f.title + ' (' + f.slug + ')</li>'; });
          html += '</ul></div>';
        }

        if (result.details.failed.length > 0) {
          html += '<div style=\"margin-top: 1rem;\"><strong style=\"font-size: 0.85rem; color: var(--accent);\">失败的文件:</strong><ul style=\"margin-top: 0.5rem; padding-left: 1.5rem; color: var(--accent);\">';
          result.details.failed.forEach(function(f) { html += '<li>' + f.filename + ': ' + f.error + '</li>'; });
          html += '</ul></div>';
        }

        html += '<a href=\"/admin\" class=\"btn btn-outline btn-sm\" style=\"margin-top: 1rem; display: inline-flex;\">→ 返回管理后台</a>';
        statusDiv.innerHTML = html;
      } else {
        statusDiv.innerHTML = '<p style=\"color: var(--accent);\">错误: ' + result.error + '</p>';
      }
    } catch (err) {
      statusDiv.innerHTML = '<p style=\"color: var(--accent);\">扫描失败: ' + err.message + '</p>';
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = '扫描经验目录 · SCAN & IMPORT';
    }
  });
}

// Import button'''

if old_marker in content:
    content = content.replace(old_marker, new_js, 1)
    print('Scan button JS handler inserted')
else:
    print('ERROR: Import button marker not found!')

with open('/var/www/fts-blog/views/admin-import.ejs', 'w') as f:
    f.write(content)
"
""", 'Insert scan button JavaScript in admin-import.ejs')

    # ============================================================
    # 3. Verify changes
    # ============================================================
    ssh_exec(client, 'head -16 /var/www/fts-blog/routes/import.js', 'Verify import.js head')
    ssh_exec(client, "grep -c 'import/directory' /var/www/fts-blog/routes/import.js", 'Count directory route references')
    ssh_exec(client, "grep -c 'scanBtn' /var/www/fts-blog/views/admin-import.ejs", 'Count scanBtn references')
    ssh_exec(client, "grep -c '经验/' /var/www/fts-blog/views/admin-import.ejs", 'Count 经验 references in ejs')

    # ============================================================
    # 4. Restart blog
    # ============================================================
    ssh_exec(client, 'pm2 restart blog', 'Restart blog with pm2')
    ssh_exec(client, 'sleep 2 && pm2 status', 'Check pm2 status')

    client.close()
    print('\n=== All done! ===')

if __name__ == '__main__':
    main()

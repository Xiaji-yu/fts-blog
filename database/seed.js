'use strict';
/**
 * Seed sample posts when the database has none. Imported by database/init.js
 * during server startup; runs inside a transaction (atomic).
 */
const db = require('./db');

const samplePosts = [
  {
    title: '构建工程蓝图风格的博客系统',
    title_en: 'Building an Engineering Blueprint Blog System',
    slug: 'building-blueprint-blog',
    excerpt: '探索如何将工程图纸美学融入现代Web设计，创建具有技术感的博客界面。',
    content: '## 设计理念\n\n这个博客系统的设计灵感来源于**工程蓝图**和**技术图纸**。\n\n### 核心特征\n\n1. **Monochrome 配色** - 黑白为主的色彩系统\n2. **技术规格块** - 模拟工程图纸中的元数据标注\n3. **罗盘标记** - 右上角的 "N" 罗盘指示器\n4. **质检印章** - 带有红色边框的认证标记\n\n### 技术栈\n\n- **后端**: Node.js + Express\n- **数据库**: SQLite (sql.js)\n- **前端**: 纯 HTML/CSS/JS + EJS 模板\n- **认证**: bcrypt + express-session',
    tags: ['设计', '前端', 'CSS']
  },
  {
    title: 'SQLite 在 Node.js 中的应用实践',
    title_en: 'SQLite in Node.js: Practical Applications',
    slug: 'sqlite-nodejs-practice',
    excerpt: '探讨如何在 Node.js 项目中使用 SQLite 作为轻量级数据库解决方案。',
    content: '## 为什么选择 SQLite？\n\nSQLite 是一个**嵌入式数据库**，不需要独立的服务器进程。\n\n### 优势\n\n- **零配置** - 无需安装或管理数据库服务器\n- **单文件** - 整个数据库存储在一个文件中\n- **ACID 兼容** - 支持完整的 ACID 事务\n- **跨平台** - 可在任何支持文件系统的平台上运行',
    tags: ['数据库', 'Node.js', '后端']
  },
  {
    title: '极简主义 Web 设计原则',
    title_en: 'Minimalist Web Design Principles',
    slug: 'minimalist-web-design',
    excerpt: '探讨极简主义设计在Web应用中的应用，以及如何通过减法创造更好的用户体验。',
    content: '## 少即是多\n\n极简主义设计的核心原则是**去除一切不必要的元素**。\n\n### 关键原则\n\n1. **留白是设计元素** - 空白区域不是浪费\n2. **色彩克制** - 限制调色板\n3. **字体层级** - 通过大小、粗细建立信息层次\n4. **一致性** - 重复使用相同的模式和间距',
    tags: ['设计', 'UX', '极简主义']
  }
];

async function seedIfEmpty() {
  return db.transaction(async (tx) => {
    const countResult = tx.exec('SELECT COUNT(*) AS count FROM posts');
    const count = countResult[0] ? countResult[0].values[0][0] : 0;
    if (count > 0) return { seeded: 0, skipped: true };

    const now = new Date().toISOString();
    let seeded = 0;
    for (const post of samplePosts) {
      tx.run(
        `INSERT INTO posts (title, title_en, slug, content, excerpt, published, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [post.title, post.title_en, post.slug, post.content, post.excerpt, now, now]
      );
      const postId = tx.lastInsertRowid();
      for (const tagName of post.tags) {
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
      seeded++;
    }
    console.log(`✓ Seeded ${seeded} sample posts`);
    return { seeded, skipped: false };
  });
}

module.exports = { seedIfEmpty, samplePosts };

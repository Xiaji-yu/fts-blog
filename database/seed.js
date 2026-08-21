const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, 'data', 'blog.db');

async function seedPosts() {
  const SQL = await initSqlJs();

  if (!fs.existsSync(DB_PATH)) {
    console.log('Database not found. Run database/init.js first.');
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);

  // Check if posts already exist
  const countResult = db.exec("SELECT COUNT(*) FROM posts");
  const postCount = countResult.length > 0 ? countResult[0].values[0][0] : 0;

  if (postCount > 0) {
    console.log(`Database already has ${postCount} posts. Skipping seed.`);
    db.close();
    return;
  }

  const now = new Date().toISOString();

  // Sample posts
  const posts = [
    {
      title: '构建工程蓝图风格的博客系统',
      title_en: 'Building an Engineering Blueprint Blog System',
      slug: 'building-blueprint-blog',
      excerpt: '探索如何将工程图纸美学融入现代Web设计，创建具有技术感的博客界面。',
      content: `## 设计理念

这个博客系统的设计灵感来源于**工程蓝图**和**技术图纸**。我们将工业设计的精确感与极简主义美学相结合。

### 核心特征

1. **Monochrome 配色** - 黑白为主的色彩系统，强调内容本身
2. **技术规格块** - 模拟工程图纸中的元数据标注
3. **罗盘标记** - 右上角的 "N" 罗盘指示器
4. **质检印章** - 带有红色边框的认证标记

### 技术栈

- **后端**: Node.js + Express
- **数据库**: SQLite (sql.js)
- **前端**: 纯 HTML/CSS/JS + EJS 模板
- **认证**: bcrypt + express-session

### 代码示例

\`\`\`javascript
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello, Blueprint!');
});
\`\`\`

这种设计哲学强调：**形式追随功能**，每一个视觉元素都服务于信息传达。`,
      tags: ['设计', '前端', 'CSS']
    },
    {
      title: 'SQLite 在 Node.js 中的应用实践',
      title_en: 'SQLite in Node.js: Practical Applications',
      slug: 'sqlite-nodejs-practice',
      excerpt: '探讨如何在 Node.js 项目中使用 SQLite 作为轻量级数据库解决方案。',
      content: `## 为什么选择 SQLite？

SQLite 是一个**嵌入式数据库**，不需要独立的服务器进程。对于小型到中型项目，它是理想的选择。

### 优势

- **零配置** - 无需安装或管理数据库服务器
- **单文件** - 整个数据库存储在一个文件中
- **ACID 兼容** - 支持完整的 ACID 事务
- **跨平台** - 可在任何支持文件系统的平台上运行

### 在 Node.js 中使用

我们使用 \`sql.js\` 库，它是 SQLite 的 JavaScript 移植版本（基于 WebAssembly）。

\`\`\`javascript
const initSqlJs = require('sql.js');
const fs = require('fs');

async function initDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(\`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    )
  \`);

  return db;
}
\`\`\`

### 性能考虑

对于博客这类读多写少的应用，SQLite 的性能完全足够。建议定期备份数据库文件。`,
      tags: ['数据库', 'Node.js', '后端']
    },
    {
      title: '极简主义 Web 设计原则',
      title_en: 'Minimalist Web Design Principles',
      slug: 'minimalist-web-design',
      excerpt: '探讨极简主义设计在Web应用中的应用，以及如何通过减法创造更好的用户体验。',
      content: `## 少即是多

极简主义设计的核心原则是**去除一切不必要的元素**，让内容成为主角。

### 关键原则

1. **留白是设计元素** - 空白区域不是浪费，而是呼吸空间
2. **色彩克制** - 限制调色板，建立视觉层级
3. **字体层级** - 通过大小、粗细建立信息层次
4. **一致性** - 重复使用相同的模式和间距

### 在博客中的应用

- 使用单一字体族（中文 + 等宽英文字体组合）
- 限制颜色使用（主色 + 辅助色 + 中性色）
- 通过间距而非装饰线分隔内容
- 技术规格块替代传统导航

### 心理效应

研究表明，简洁的界面设计能够：
- 提高用户注意力集中度
- 降低认知负荷
- 增强内容可读性
- 提升专业感

## 总结

极简主义不是简单，而是**精心设计的简单**。每一个保留的元素都有其存在的理由。`,
      tags: ['设计', 'UX', '极简主义']
    }
  ];

  for (const post of posts) {
    db.run(
      `INSERT INTO posts (title, title_en, slug, content, excerpt, published, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [post.title, post.title_en, post.slug, post.content, post.excerpt, now, now]
    );

    const postId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];

    // Insert tags
    for (const tagName of post.tags) {
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

  // Save database
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);

  console.log(`✓ Seeded ${posts.length} sample posts`);

  db.close();
}

seedPosts().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});

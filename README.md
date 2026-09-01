# FTS-BLOG · 工程蓝图博客系统

**Frontend Test Suite - Blog** | Engineering Blueprint Aesthetic

一个基于工程蓝图/技术图纸风格的博客系统，支持从 Obsidian 笔记库直接导入文章。

## 🚀 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 运行测试
npm test

# 启动服务器（前台运行）
npm start
# 或开发模式（nodemon 自动重启）
npm run dev

# 访问
# 主页: http://localhost:3000
# 管理后台: http://localhost:3000/admin
# API 文档: http://localhost:3000/api
```

### 生产环境（PM2）

```bash
# 安装 PM2（全局）
npm install -g pm2

# 使用 PM2 配置文件启动（自动设置 NODE_ENV=production）
pm2 start ecosystem.config.js

# 常用命令
pm2 status              # 查看进程状态
pm2 logs blog           # 查看日志
pm2 restart blog        # 重启
pm2 stop blog           # 停止
pm2 delete blog         # 删除进程

# 更新代码
cd /var/www/fts-blog
git pull origin main
npm ci --omit=dev
pm2 restart blog

> **重要**: `git pull` 只会拉取代码，**不会**自动安装新的依赖包。
> 新增依赖（如 `highlight.js`、`express-rate-limit`）必须执行 `npm ci --omit=dev`（或 `npm install --production`）后才能启动，否则会报 `Cannot find module 'highlight.js'` 类似错误。

# 开机自启
pm2 startup && pm2 save
```

> **建议**: 在 `ecosystem.config.js` 的 `env` 中设置一个随机 `SESSION_SECRET`，
> 未设置时会自动生成并持久化到 `data/.session-secret`（跨重启保持登录态）。
>
> **反向代理**: 若博客位于 Nginx 等反向代理之后，务必设置 `TRUST_PROXY=1`
> （`ecosystem.config.js` 已默认配置），否则登录限流会按代理 IP 全局生效。

## ⚙️ 个性化配置

博客的所有可定制项都集中在 `config.json` 中。首次部署时：

```bash
cp config.example.json config.json
```

配置加载器（`config/loader.js`）内置了完整默认值，`config.json` 只需覆盖你想改的项。

### 配置段说明

| 段 | 用途 |
|---|---|
| `site` | 站点名称、描述、图号前缀、阅读速度、`url`（RSS/OG 使用的规范站点地址） |
| `author` | 署名、项目名、版本号 |
| `blueprint` | 蓝图前缀、所有 UI 标签文本 |
| `admin` | 管理后台标题、按钮文案、表单标签 |
| `api` | API 文档页面标题、基础 URL |
| `footer` | 公网安备/ICP 备案号及链接 |
| `errors` | 404 等错误页面的文案 |
| `server` | 端口、内外网 URL |
| `database` | 数据库路径、保存超时 |
| `auth` | 默认用户名、密码策略、bcrypt 轮数 |
| `session` | 会话过期时间、cookie 安全选项（`cookieSecure` 可强制 HTTPS cookie） |
| `security` | 登录/API 速率限制 |
| `upload` | 上传目录、大小限制、允许的文件类型 |
| `import` | Obsidian 笔记目录、callout 图标映射 |
| `features` | 蓝图风格、DOMPurify 等开关 |
| `pagination` | 文章列表默认每页数量 |

> **注意**: `config.json` 已加入 `.gitignore`，不会被提交到仓库。`config.example.json` 是模板文件。

## 🔐 管理员凭证

- **用户名**: 由 `config.json` → `auth.defaultUsername` 决定（默认 `admin`）
- **密码**: 首次启动时自动生成随机密码，格式为 `{密码前缀}-{随机6字节hex}`，请登录后立即修改

## 📝 Obsidian 导入功能

### 使用方法

1. 登录管理后台: http://localhost:3000/admin
2. 点击 "📥 导入 Obsidian" 按钮
3. 拖拽或选择 .md 文件（或点击 "扫描经验目录" 直接导入 `经验/` 下的全部笔记）
4. 点击 "开始导入"

### 支持的 Obsidian 语法

- ✅ YAML frontmatter (title, date, tags 等)
- ✅ Wiki 链接 `[[Link]]` → `[Link](/post/:id)`
- ✅ 图片嵌入 `![[image.png]]` → `/uploads/...`
- ✅ Callout 语法 `> [!note]` → 引用块
- ✅ 标签自动提取
- ✅ 表格单元格管道符自动转义
- ✅ 批量导入（幂等：同 slug 跳过）

## 🔌 路由 / API 端点

### 公开页面

| 路径 | 说明 |
|---|---|
| `/` | 首页（分页） |
| `/post/:id` | 文章页（阅读时长、浏览量、上一篇/下一篇） |
| `/tags` | 标签索引 |
| `/tag/:name` | 标签归档 |
| `/search?q=` | 站内搜索 |
| `/feed.xml` | RSS 2.0 订阅 |
| `/healthz` | 健康检查 |
| `/api` | API 文档页 |

### 公开 API

- `GET /api/posts` - 已发布文章列表（分页）
- `GET /api/posts/:slug` - 按 slug 获取文章
- `GET /api/tags` - 所有标签（含文章数）

### 管理 API（需要登录 + CSRF Token）

- `POST /api/auth/login` - 登录（限流保护，无需 CSRF）
- `POST /api/auth/logout` - 登出
- `PUT /api/auth/password` - 修改密码
- `POST /api/posts` / `PUT /api/posts/:id` / `DELETE /api/posts/:id` - 文章 CRUD
- `GET /api/posts/id/:id` - 按 ID 获取文章
- `POST /api/tags` - 创建标签
- `POST /api/upload` - 上传图片
- `GET /api/uploads` - 图片列表
- `DELETE /api/uploads/:filename` - 删除图片
- `GET /admin/import/status` - 导入统计（管理端）

> 除登录外的所有写操作都要求 CSRF Token：表单以 `_csrf` 字段提交，
> fetch 请求以 `X-CSRF-Token` 请求头发送（页面 `<meta name="csrf-token">` 中获取）。
> 编程方式调用 API 时，令牌来自 `POST /api/auth/login` 响应中的 `csrfToken` 字段，
> 或 `GET /api/auth/csrf`（同一会话）。登录接口受速率限制保护，无需 CSRF。

## 🎨 设计特点

- **经典蓝图配色**: 深海军蓝背景 + 青色网格线
- **技术规格块**: 图号/比例等元数据标注
- **罗盘 "N" 标记**: 右上角固定定位
- **双语标题**: 中文 + 英文等宽字体
- **卡片系统**: 带技术注释的博客文章卡片
- **代码高亮**: 服务端 marked + highlight.js，GitHub Dark 主题

## 🛠 技术栈

- **后端**: Node.js + Express
- **数据库**: SQLite (sql.js)，统一数据访问层 `database/db.js`（串行写 + 事务回滚）
- **迁移**: 顺序迁移 `database/migrations.js`（schema_migrations 表）
- **前端**: HTML/CSS/JS + EJS 模板
- **认证**: bcrypt + express-session + CSRF + 登录限流
- **Markdown**: marked + highlight.js + DOMPurify（XSS 净化）
- **测试**: Node 内置 test runner（`npm test`）

## 📁 项目结构

```text
fts-blog/
├── server.js                  # 入口：初始化数据库 + 启动监听
├── app.js                     # Express 应用装配（可被测试直接导入）
├── ecosystem.config.js        # PM2 生产配置
├── package.json               # 依赖配置
├── config.json                # 个性化配置（不提交到仓库）
├── config.example.json        # 配置模板
├── config/
│   └── loader.js              # 配置加载器（内置默认值 + 深度合并）
├── database/
│   ├── db.js                  # 统一数据访问层（单例 + 串行写 + 事务）
│   ├── migrations.js          # 顺序数据库迁移
│   ├── init.js                # 初始化：迁移 + 管理员 + 种子数据
│   └── seed.js                # 示例文章种子
├── lib/
│   ├── obsidian.js            # Obsidian 语法转换（可单测）
│   └── cache.js               # 内存 TTL 缓存
├── middleware/
│   ├── auth.js                # 认证中间件
│   ├── csrf.js                # CSRF 防护
│   └── rateLimit.js           # 登录/API 限流
├── routes/
│   ├── api.js                 # REST API + 上传 + 图片库
│   ├── admin.js               # 管理页面
│   ├── public.js              # 公开页面 + RSS + 搜索 + 标签
│   └── import.js              # Obsidian 导入
├── public/
│   └── css/
│       └── style.css          # 蓝图风格 CSS
├── views/
│   ├── index.ejs              # 主页（分页）
│   ├── post.ejs               # 文章页（TOC/上下篇/浏览量）
│   ├── tags.ejs               # 标签索引
│   ├── search.ejs             # 搜索/标签归档
│   ├── 404.ejs                # 404 页面
│   ├── api-info.ejs           # API 文档
│   ├── admin-*.ejs            # 管理后台（登录/仪表盘/编辑器/导入/预览）
│   └── partials/
│       ├── header.ejs         # 头部（OG/RSS/CSRF meta/高亮样式）
│       └── footer.ejs         # 底部（备案 + 标签/搜索/RSS 链接）
├── uploads/                   # 图片上传目录
├── data/                      # SQLite 数据库 + session secret
├── 经验/                       # Obsidian 笔记源目录
├── examples/                  # 导入示例文件
├── test/                      # node:test 自动化测试
├── deploy_config.example.py   # 部署凭证模板（复制为 deploy_config.py 并填写）
└── deploy_*.py                # 远程部署脚本（PM2/SSH，凭证从 deploy_config.py 读取）
```

## 🧪 测试

```bash
npm test
```

- `test/obsidian.test.js` — frontmatter 解析与 Obsidian 语法转换
- `test/db.test.js` — 数据层（迁移幂等、读写、事务回滚/提交）
- `test/api.test.js` — 端到端（登录、CSRF、文章 CRUD、RSS、搜索、限流）

测试使用独立的临时数据库（`test/.tmp/`），不影响 `data/blog.db`。

## 📝 许可证

MIT

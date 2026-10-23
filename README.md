# FTS-BLOG · 工程蓝图博客系统

**Frontend Test Suite - Blog** | Engineering Blueprint Aesthetic

一个基于工程蓝图/技术图纸风格的博客系统，支持从 Obsidian 笔记库直接导入文章。
内置「蓝图 / 纸墨」双主题，可一键切换。

## ✨ 功能亮点

- **双主题**：工程蓝图（默认）与纸墨风格，选择保存在浏览器，首屏无闪烁
- **Obsidian 导入**：frontmatter、Wiki 链接、图片嵌入、Callout、表格一次转换
- **完整后台**：文章 CRUD、Markdown 实时预览、图片上传与图片库、密码修改
- **站内体验**：首页统计面板、热门图纸、搜索、随机跳转、文章 TOC、阅读进度
- **安全**：bcrypt + session + CSRF + 登录/API 限流 + DOMPurify
- **零构建**：EJS 服务端渲染，`git pull` + `npm ci` + `pm2 reload` 即可上线
- **一键部署**：`scripts/deploy.sh` 自动拉代码、装依赖、跑测试、重启、健康检查

## 📦 环境要求

- Node.js **>= 20.19.0**（见 `package.json` 的 `engines`）
- npm
- 生产环境建议使用 PM2 托管
- 可选：Nginx / Caddy 等反向代理

## 🚀 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 可选：创建个人配置（不提交到仓库）
cp config.example.json config.json

# 运行测试
npm test

# 启动服务器（前台运行）
npm start
# 或开发模式（nodemon 自动重启）
npm run dev
```

访问：

| 地址 | 说明 |
|---|---|
| http://localhost:3000 | 主页 |
| http://localhost:3000/admin | 管理后台 |
| http://localhost:3000/api | API 文档 |
| http://localhost:3000/healthz | 健康检查 |

> 首次启动会自动创建管理员并打印随机密码，见下方「管理员凭证」。

## 🚢 生产部署（PM2）

### 首次部署

```bash
# 1. 拉取代码
git clone git@github.com:Xiaji-yu/fts-blog.git /var/www/fts-blog
cd /var/www/fts-blog

# 2. 安装生产依赖
npm ci --omit=dev

# 3. 个人配置（可选；不创建则使用内置默认值）
cp config.example.json config.json
# 编辑 config.json：站点名、域名、备案号、端口、TRUST_PROXY 等

# 4. 用 PM2 启动（ecosystem 会把 NODE_ENV 设为 production）
pm2 start ecosystem.config.js

# 5. 保存进程列表并设置开机自启
pm2 save
pm2 startup    # 按输出的提示执行一次
```

首次启动时管理员的随机密码会打印在日志里：

```bash
# 进程名默认是 blog；用 APP_NAME 启动过的话换成实际名字，如 fts-blog
pm2 logs blog --lines 50 --nostream
# ✓ Admin user created (username: admin, password: admin-xxxxxxxxxxxx)
```

登录后请立即在后台修改密码。

> PM2 进程名默认是 `blog`（`ecosystem.config.js`）。如果部署时用
> `APP_NAME=fts-blog pm2 start ecosystem.config.js`，进程名就是 `fts-blog`。

### 日常更新：一键部署

```bash
cd /var/www/fts-blog
bash scripts/deploy.sh
```

脚本按顺序执行，任一步失败立即退出：

1. 检查运行用户（禁止 root / sudo）和 PM2、Node
2. 自动从 `pm2 jlist` 找到 `pm_cwd` 指向本仓库的进程
3. `git pull --ff-only`（工作区有未提交改动会拒绝）
4. `npm ci --omit=dev`
5. `npm test`
6. `pm2 reload <进程名> --update-env`
7. 轮询 `/healthz`，成功后 `pm2 save`

> `pm2 reload --update-env` 会把脚本里的 `TRUST_PROXY=1` 写进进程环境；
> 健康检查成功后再 `pm2 save`，服务器重启后环境仍然有效。

### 脚本参数

| 用法 | 作用 |
|---|---|
| `bash scripts/deploy.sh` | 自动识别 PM2 进程并更新 |
| `APP_NAME=fts-blog bash scripts/deploy.sh` | 手动指定 PM2 服务名 |
| `PORT=3000 bash scripts/deploy.sh` | 覆盖健康检查端口 |
| `HEALTH_URL=http://127.0.0.1:3000/healthz bash scripts/deploy.sh` | 完全自定义健康检查地址 |
| `SKIP_TESTS=1 bash scripts/deploy.sh` | 跳过测试直接上线 |
| `ALLOW_DIRTY=1 bash scripts/deploy.sh` | 允许带未提交改动部署 |
| `TRUST_PROXY=0 bash scripts/deploy.sh` | 关闭 trust proxy（直连、无反向代理时） |

端口解析优先级：`PORT` 环境变量 → PM2 进程的 `env.PORT` → `config.json` 的
`server.port` → `3000`。

### 部署故障排查

**脚本提示「PM2 里没有 xxx，但端口 3000 已被占用」**

说明端口被占，但占用者不是当前用户的 PM2 进程。先确认：

```bash
pm2 ls
ss -ltnp | grep :3000
```

- 如果服务在 PM2 里但名字不同：`APP_NAME=<真实名字> bash scripts/deploy.sh`
- 如果服务由 systemd 管理：`systemctl status <服务名>`，部署时改用
  `systemctl restart <服务名>`
- 如果服务是直接 `node server.js` 起的：建议迁移到 PM2，便于统一更新

**日志出现 `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`**

Express 收到 `X-Forwarded-For` 但没有开 trust proxy。确认反向代理存在后执行：

```bash
TRUST_PROXY=1 pm2 reload <进程名> --update-env
pm2 save
```

也可以永久写进 `config.json`：

```json
{ "server": { "trustProxy": 1 } }
```

**健康检查失败**

```bash
curl -v http://127.0.0.1:3000/healthz
pm2 logs <进程名> --lines 50 --nostream
```

常见原因：端口与 `PORT` 不一致、数据库文件权限、依赖未安装完整。

**回滚**

脚本不会自动回滚。需要回滚时：

```bash
git log --oneline -5
git checkout <上一个可用提交>
bash scripts/deploy.sh
```

### 反向代理示例（Nginx）

```nginx
server {
    listen 443 ssl http2;
    server_name blog.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

有反向代理时保持 `TRUST_PROXY=1`，限流才能按真实客户端 IP 计数。

### 备份

需要备份的只有三处（都不在 git 里）：

```bash
tar czf fts-blog-backup-$(date +%F).tar.gz config.json data uploads
```

- `config.json`：站点配置
- `data/`：SQLite 数据库、session secret
- `uploads/`：上传的图片

## ⚙️ 个性化配置

所有可定制项都在 `config.json` 中。配置加载器（`config/loader.js`）内置完整默认值，
`config.json` 只需覆盖想改的项。

```bash
cp config.example.json config.json
```

### 配置段说明

| 段 | 用途 |
|---|---|
| `site` | 站点名称、描述、图号前缀、阅读速度、`url`（RSS/OG 规范地址；不设置时按请求的域名/协议自动推导） |
| `author` | 署名、项目名、版本号 |
| `blueprint` | 蓝图前缀、所有 UI 标签文本 |
| `admin` | 管理后台标题、按钮文案、表单标签 |
| `api` | API 文档页面标题、基础 URL |
| `footer` | 公网安备/ICP 备案号及链接 |
| `errors` | 404 等错误页面的文案 |
| `server` | 端口、内外网 URL、`trustProxy`（代理跳数）、请求体大小限制 |
| `database` | 数据库路径、保存超时 |
| `auth` | 默认用户名、密码策略、bcrypt 轮数 |
| `session` | 会话过期时间、cookie 安全选项（`cookieSecure` 可强制 HTTPS cookie） |
| `security` | 登录/API 速率限制 |
| `upload` | 上传目录、大小限制、允许的文件类型 |
| `import` | Obsidian 笔记目录（默认 `经验`）、callout 图标映射 |
| `features` | `nMark`、DOMPurify 等开关 |
| `pagination` | 文章列表默认每页数量 |

> `config.json` 已加入 `.gitignore`，不会提交到仓库；`config.example.json` 是模板。

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `config.server.port`（3000） | 监听端口，优先级高于配置文件 |
| `TRUST_PROXY` | 生产脚本注入 `1` | 反向代理跳数；直连时设为 `0` |
| `SESSION_SECRET` | 自动生成到 `data/.session-secret` | 会话签名密钥，跨重启保持登录态 |
| `NODE_ENV` | `production`（ecosystem） | 生产环境会启用 Secure cookie 等行为 |
| `FTS_DB_PATH` | `config.database.path` | 覆盖数据库文件路径（测试也用它隔离临时库） |

## 🔐 管理员凭证

- **用户名**：`config.json` → `auth.defaultUsername`（默认 `admin`）
- **密码**：首次启动时自动生成随机密码，格式为 `{密码前缀}-{随机6字节hex}`，
  打印在启动日志里；请登录后立即修改

如果忘记了密码，可以在服务器上执行：

```bash
pm2 logs <进程名> --lines 100 --nostream | grep "Admin user created"
```

密码只在首次创建时打印，之后无法从日志找回；必要时可清空 `users` 表重新初始化
（会丢失后台账号，不影响文章）。

## 📝 Obsidian 导入功能

### 使用方法

1. 登录管理后台：http://localhost:3000/admin
2. 点击「📥 导入 Obsidian」
3. 拖拽或选择 `.md` 文件，或点击「扫描经验目录」导入 `经验/` 下的全部笔记
4. 点击「开始导入」

笔记目录可以在 `config.json` 的 `import.obsidianDir` 中修改。

### 支持的 Obsidian 语法

- ✅ YAML frontmatter（title、date、tags 等）
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
| `/` | 首页（分页 + 状态面板 + 热门图纸 + 站内搜索） |
| `/posts` | 全部文章归档（鼓轮列表） |
| `/post/:id` | 文章页（阅读时长、浏览量、TOC、上一篇/下一篇） |
| `/random` | 随机跳转到一篇已发布文章 |
| `/tags` | 标签索引 |
| `/tag/:name` | 标签归档 |
| `/search?q=` | 站内搜索 |
| `/feed.xml` | RSS 2.0 订阅 |
| `/healthz` | 健康检查（`{ ok, uptime, ts }`） |
| `/api` | API 文档页 |

### 公开 API

- `GET /api/posts` — 已发布文章列表（分页）
- `GET /api/posts/:slug` — 按 slug 获取文章
- `GET /api/tags` — 所有标签（含文章数）
- `GET /api/auth/csrf` — 获取当前会话的 CSRF Token

### 管理 API（需要登录 + CSRF Token）

- `POST /api/auth/login` — 登录（限流保护，无需 CSRF）
- `POST /api/auth/logout` — 登出
- `PUT /api/auth/password` — 修改密码
- `GET /api/posts/id/:id` — 按 ID 获取文章
- `POST /api/posts` / `PUT /api/posts/:id` / `DELETE /api/posts/:id` — 文章 CRUD
- `POST /api/tags` — 创建标签
- `POST /api/upload` — 上传图片
- `GET /api/uploads` — 图片列表
- `DELETE /api/uploads/:filename` — 删除图片
- `GET /admin/import/status` — 导入统计（管理端页面）

> 除登录外的所有写操作都要求 CSRF Token：表单以 `_csrf` 字段提交，
> fetch 请求以 `X-CSRF-Token` 请求头发送（从 `<meta name="csrf-token">` 获取）。
> 编程方式调用 API 时，令牌来自 `POST /api/auth/login` 响应中的 `csrfToken` 字段，
> 或 `GET /api/auth/csrf`。登录接口受速率限制保护，无需 CSRF。

## 🎨 设计特点

- **双主题切换**：导航栏右侧的「纸墨 / 蓝图」按钮，管理后台固定在右上角。
  选择保存在 `localStorage`（键名 `fts-theme`），并在首屏绘制前应用，刷新不闪烁。
  - **蓝图（默认）**：深海军蓝背景 + 青色网格线，工程图纸气质
  - **纸墨**：米白纸面 + 墨黑细线，与 `xiaji-home` / `dashboard` / `Moments`
    共用同一套色板（`#f5f4f1` / `#111` / `#cbc9c3`）；蓝色光晕、扫描线、
    鼠标光晕关闭，背景换成极淡墨点阵
- **技术规格块**：图号/比例等元数据标注
- **罗盘「N」标记**：右上角固定定位
- **双语标题**：中文 + 英文等宽字体
- **卡片系统**：带技术注释的博客文章卡片（含阅读时长、浏览量）
- **代码高亮**：服务端 marked + highlight.js；蓝图用 GitHub Dark，
  纸墨用 GitHub Light，随主题自动切换
- **顶部导航**：全站公开页导航（首页/归档/标签/搜索/RSS），当前页高亮
- **首页状态面板**：图纸数、标签数、总浏览、总字数、最后更新
- **热门图纸**：按浏览量排序的 Top 3 速览条
- **首页搜索 + 随机图纸**：快速检索与随机发现（`/random`）
- **阅读进度条 + 回到顶部**：全局滚动辅助（尊重 `prefers-reduced-motion`）
- **趣味细节**：首页标语打字机效果、蓝图扫描线扫过标题区

### 主题实现

配色以 RGB 通道变量定义在 `public/css/style.css` 的 `:root` 中，纸墨主题在
`public/css/theme-paper.css` 里用 `html[data-theme="paper"]` 覆盖：

```css
html[data-theme="paper"] {
  --bg: #f5f4f1;
  --tint-rgb: 17, 17, 17;
  --accent: #111111;
  /* ... */
}
```

增加第三套主题只需：

1. 新建 `public/css/theme-xxx.css`，覆盖 `html[data-theme="xxx"]` 下的变量
2. 在 `views/partials/header.ejs` 中引入该文件
3. 在 `public/js/main.js` 的 `initTheme()` 里扩展切换逻辑
   （当前是 `blueprint ↔ paper` 二选一，可改成按数组循环）

## 🛠 技术栈

- **后端**：Node.js + Express
- **数据库**：SQLite (sql.js)，统一数据访问层 `database/db.js`（串行写 + 事务回滚）
- **迁移**：顺序迁移 `database/migrations.js`（`schema_migrations` 表）
- **前端**：HTML/CSS/JS + EJS 模板，无构建步骤
- **认证**：bcrypt + express-session + CSRF + 登录限流
- **Markdown**：marked + highlight.js + DOMPurify（XSS 净化）
- **测试**：Node 内置 test runner（`npm test`）

## 📁 项目结构

```text
fts-blog/
├── server.js                  # 入口：初始化数据库 + 启动监听
├── app.js                     # Express 应用装配（可被测试直接导入）
├── ecosystem.config.js        # PM2 生产配置（支持 APP_NAME 覆盖进程名）
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
│   ├── slug.js                # slug 生成与校验
│   ├── viewCounter.js         # 浏览量统计
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
├── scripts/
│   └── deploy.sh              # 生产一键更新（pull + npm ci + 测试 + reload + 健康检查）
├── public/
│   ├── css/
│   │   ├── style.css          # 基础 + 蓝图主题（默认）
│   │   └── theme-paper.css    # 纸墨主题（变量覆盖 + 组件适配）
│   └── js/
│       └── main.js            # 主题切换、滚动、TOC、灯箱、复制代码等
├── views/
│   ├── index.ejs              # 主页（分页）
│   ├── post.ejs               # 文章页（TOC/上下篇/浏览量）
│   ├── tags.ejs               # 标签索引
│   ├── search.ejs             # 搜索/标签归档
│   ├── 404.ejs                # 404 页面
│   ├── api-info.ejs           # API 文档
│   ├── admin-*.ejs            # 管理后台（登录/仪表盘/编辑器/导入/预览）
│   └── partials/
│       ├── header.ejs         # 头部（主题、OG/RSS/CSRF meta、高亮样式）
│       └── footer.ejs         # 底部（备案 + 标签/搜索/RSS 链接）
├── uploads/                   # 图片上传目录（不提交）
├── data/                      # SQLite 数据库 + session secret（不提交）
├── 经验/                       # Obsidian 笔记源目录
├── examples/                  # 导入示例文件
└── test/                      # node:test 自动化测试
```

## 🧪 测试

```bash
npm test
```

- `test/obsidian.test.js` — frontmatter 解析与 Obsidian 语法转换
- `test/db.test.js` — 数据层（迁移幂等、读写、事务回滚/提交）
- `test/api.test.js` — 端到端（登录、CSRF、文章 CRUD、RSS、搜索、限流、健康检查）
- `test/slug.test.js` — slug 生成与校验规则

测试使用独立的临时数据库（`test/.tmp/`），不影响 `data/blog.db`。

## 📝 许可证

MIT

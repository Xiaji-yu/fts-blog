# FTS-BLOG · 工程蓝图博客系统

**Frontend Test Suite - Blog** | Engineering Blueprint Aesthetic

一个基于工程蓝图/技术图纸风格的博客系统，支持从 Obsidian 笔记库直接导入文章。

## 🚀 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 启动服务器（前台运行）
node server.js

# 访问
# 主页: http://localhost:3000
# 管理后台: http://localhost:3000/admin
# API 文档: http://localhost:3000/api
```

### 生产环境（PM2）

```bash
# 安装 PM2（全局）
npm install -g pm2

# 启动博客（后台守护进程）
pm2 start server.js --name blog

# 设置开机自启
pm2 startup
pm2 save

# 常用命令
pm2 status              # 查看进程状态
pm2 logs blog           # 查看日志
pm2 restart blog        # 重启
pm2 stop blog           # 停止
pm2 delete blog         # 删除进程
```

## 🔐 管理员凭证

- **用户名**: `admin`
- **密码**: 首次启动时自动生成随机密码，请登录后立即修改

## 📝 Obsidian 导入功能

### 使用方法

1. 登录管理后台: http://localhost:3000/admin
2. 点击 "📥 导入 Obsidian" 按钮
3. 拖拽或选择 .md 文件
4. 点击 "开始导入"

### 支持的 Obsidian 语法

- ✅ YAML frontmatter (title, date, tags 等)
- ✅ Wiki 链接 `[[Link]]` → `[Link](/post/slug)`
- ✅ 图片嵌入 `![[image.png]]`
- ✅ Callout 语法 `> [!note]` → 引用块
- ✅ 标签自动提取
- ✅ 批量导入

### Obsidian 文件示例

```markdown
---
title: 我的笔记
date: 2026-08-18
tags: [技术, 前端]
---

# 我的笔记

这是一篇从 Obsidian 导入的笔记。

## 相关链接

- [[另一篇笔记]]
- ![[diagram.png]]

> [!note] 重要提示
> 这是 Obsidian 的 callout 语法

## 代码示例

```javascript
const greeting = "Hello, Obsidian!";
```
```

## 🎨 设计特点

- **经典蓝图配色**: 深海军蓝背景 + 青色网格线
- **技术规格块**: 图号/比例等元数据标注
- **罗盘 "N" 标记**: 右上角固定定位
- **双语标题**: 中文 + 英文等宽字体
- **卡片系统**: 带技术注释的博客文章卡片

## 🔌 REST API 端点

### 公开接口

- `GET /api/posts` - 获取已发布文章列表（分页）
- `GET /api/posts/:slug` - 根据 slug 获取单篇文章
- `GET /api/tags` - 获取所有标签

### 管理接口（需要认证）

- `POST /api/auth/login` - 管理员登录
- `POST /api/auth/logout` - 管理员登出
- `POST /api/posts` - 创建新文章
- `PUT /api/posts/:id` - 更新文章
- `DELETE /api/posts/:id` - 删除文章

## 📁 项目结构

```
fts-blog/
├── server.js              # Express 主入口
├── package.json           # 依赖配置
├── database/
│   ├── init.js            # SQLite 初始化
│   └── seed.js            # 示例文章
├── middleware/
│   └── auth.js            # 认证中间件
├── routes/
│   ├── api.js             # REST API
│   ├── admin.js           # 管理页面
│   ├── public.js          # 公开页面
│   └── import.js          # Obsidian 导入
├── public/
│   ├── css/style.css      # 蓝图风格 CSS
│   └── js/main.js         # 前端 JS
├── views/                 # EJS 模板
│   ├── index.ejs          # 主页
│   ├── post.ejs           # 文章页
│   ├── admin-dashboard.ejs # 管理后台
│   ├── admin-editor.ejs   # 文章编辑器
│   ├── admin-import.ejs   # Obsidian 导入
│   └── 404.ejs            # 404 页面
├── uploads/               # 图片上传目录
└── data/                  # SQLite 数据库
```

## 🛠 技术栈

- **后端**: Node.js + Express
- **数据库**: SQLite (sql.js)
- **前端**: HTML/CSS/JS + EJS 模板
- **认证**: bcrypt + express-session
- **Markdown**: marked
- **YAML**: js-yaml

## 📝 许可证

MIT

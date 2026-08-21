const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const EXAMPLE_PATH = path.join(__dirname, '..', 'config.example.json');

// Built-in defaults — match config.example.json so the app works out of the box
const defaults = {
  site: {
    name: "夏祭博客",
    shortName: "夏祭",
    description: "夏祭 · 个人前端试验场",
    tagline: "Xiaji · Frontend Proving Ground",
    descriptionLong: "夏祭的个人前端试验场。每张「图纸」是一件独立的作品，探索前端技术的边界。",
    author: "夏祭",
    drawingPrefix: "FTS-BLOG",
    readingTimeCharsPerMinute: 200
  },
  author: {
    name: "夏祭",
    project: "Frontend Test Suite · FTS-BLOG",
    version: "v1.0"
  },
  blueprint: {
    enabled: true,
    prefix: "FTS",
    version: "v1.0",
    labels: {
      drawingNumber: "图号",
      scale: "比例",
      system: "系统",
      interface: "接口",
      operation: "操作",
      authorDesign: "设计/绘制",
      authorProject: "工程",
      registration: "备案",
      drawingNotFound: "图纸未找到",
      authenticate: "AUTHENTICATE"
    },
    showCompassMarker: true
  },
  admin: {
    defaultUsername: "admin",
    navBrand: "FTS-ADMIN",
    systemLabel: "FTS",
    pageTitle: "管理后台",
    pageTitleEn: "Admin Panel · Authentication Required",
    dashboardTitle: "控制面板",
    dashboardTitleEn: "Dashboard · Content Management System",
    newPostLabel: "+ 新建图纸 · NEW POST",
    importLabel: "📥 导入 Obsidian · IMPORT",
    noPostsMessage: "暂无图纸。点击上方按钮创建第一篇文章。",
    importTitle: "Obsidian 导入",
    importTitleEn: "Import from Obsidian Vault",
    editor: {
      titleNew: "新建图纸",
      titleNewEn: "New Drawing",
      titleEdit: "编辑图纸",
      titleEditEn: "Edit Drawing",
      labels: {
        title: "标题 · Title (中文)",
        titleEn: "英文标题 · Title (EN)",
        slug: "URL标识 · Slug",
        slugHint: "仅允许小写字母、数字和连字符 · Only lowercase letters, numbers, and hyphens",
        excerpt: "摘要 · Excerpt",
        content: "内容 · Content (Markdown)",
        tags: "标签 · Tags (逗号分隔)",
        published: "发布 · Published"
      },
      buttons: {
        preview: "预览 · PREVIEW →",
        create: "创建 · CREATE →",
        update: "更新 · UPDATE →",
        cancel: "取消 · CANCEL"
      }
    },
    previewWindowWidth: 1400,
    previewWindowHeight: 900
  },
  api: {
    baseUrl: "http://localhost:3000/api",
    systemLabel: "FTS-API",
    pageTitle: "API 文档",
    pageTitleEn: "RESTful API Documentation",
    sections: {
      publicEndpoints: "公开接口 · Public Endpoints",
      adminEndpoints: "管理接口 · Admin Endpoints (需要认证)",
      authentication: "认证方式 · Authentication",
      example: "示例 · Example"
    },
    loginExample: {
      username: "admin",
      passwordHint: "YOUR_PASSWORD"
    }
  },
  footer: {
    beianUrl: "http://www.beian.gov.cn/",
    beianLabel: "公网安备",
    beianNumber: "沪公网安备31011202022181号",
    icpUrl: "https://beian.miit.gov.cn/",
    icpNumber: "沪ICP备2026007186号"
  },
  errors: {
    "404": {
      title: "404 - Not Found",
      subtitle: "Not Found · 图纸未找到",
      errorCode: "ERR_404",
      message: "请求的资源不存在",
      body: "该图纸编号不存在或已被移除。",
      bodyEn: "The drawing you requested does not exist or has been removed.",
      stamp: "图纸未找到",
      backLink: "← 返回首页 · BACK TO INDEX"
    }
  },
  post: {
    backToIndex: "← BACK TO INDEX"
  },
  server: {
    port: 3000,
    publicUrl: "http://localhost:3000",
    adminUrl: "http://localhost:3000/admin",
    apiUrl: "http://localhost:3000/api",
    jsonBodyLimit: "10mb",
    urlEncodedBodyLimit: "10mb"
  },
  database: {
    path: "data/blog.db",
    saveTimeoutMs: 30000
  },
  auth: {
    defaultUsername: "admin",
    defaultPasswordPrefix: "admin",
    bcryptRounds: 10,
    minPasswordLength: 6
  },
  session: {
    secret: null,
    secretLength: 64,
    resave: false,
    saveUninitialized: false,
    cookieSecure: false,
    cookieHttpOnly: true,
    cookieSameSite: "lax",
    maxAgeHours: 24
  },
  upload: {
    directory: "uploads",
    maxFileSizeMB: 5,
    allowedTypes: ["jpeg", "jpg", "png", "gif", "webp"],
    nameStrategy: "timestamp-random"
  },
  pagination: {
    defaultLimit: 10
  },
  import: {
    obsidianDir: "经验",
    obsidianDirLabel: "经验/",
    fileExtension: ".md",
    excerptMaxLength: 200,
    allowedImageExtensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"],
    calloutIconMap: {
      note: "ℹ️",
      info: "ℹ️",
      warning: "⚠️",
      danger: "🚨",
      tip: "💡",
      important: "❗",
      question: "❓"
    },
    yamlSchema: "SAFE_SCHEMA"
  },
  features: {
    enableDOMPurify: true,
    fallbackToEscapingOnly: true,
    blueprint: true,
    nMark: true
  },
  markdown: {
    sanitizeEnabled: true
  }
};

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

let config;

try {
  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const userConfig = JSON.parse(raw);
    config = deepMerge(defaults, userConfig);
    console.log('✓ Config loaded from', CONFIG_PATH);
  } else {
    config = { ...defaults };
    console.log('ℹ No config.json found, using built-in defaults');
    console.log('  Copy config.example.json to config.json to customize.');
  }
} catch (err) {
  console.error('⚠ Config error:', err.message);
  console.error('  Falling back to built-in defaults.');
  config = { ...defaults };
}

module.exports = config;

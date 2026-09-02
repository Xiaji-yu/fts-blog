'use strict';
// End-to-end API test — boots the real app against an isolated temp DB.
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const cache = require('../lib/cache');

// Isolated per-file directory: node --test runs test files in parallel, so
// each file must own its temp dir (see db.test.js for its own).
process.env.FTS_DB_PATH = path.join(__dirname, '.tmp', 'api', 'test-' + process.pid + '.db');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'test-pass-123';

let server;
let baseUrl;
let cookies = {};

function setCookies(setCookieHeader) {
  if (!setCookieHeader) return;
  const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const line of list) {
    const pair = line.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}

function cookieHeader() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function request(method, urlPath, { json, headers = {}, form } = {}) {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: {
      'Cookie': cookieHeader(),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...headers
    },
    body: json ? JSON.stringify(json) : (form ? new URLSearchParams(form).toString() : undefined)
  });
  setCookies(res.headers.getSetCookie ? res.headers.getSetCookie() : res.headers.get('set-cookie'));
  return res;
}

async function getCsrfFrom(urlPath) {
  const res = await request('GET', urlPath);
  const html = await res.text();
  const m = html.match(/<meta name="csrf-token" content="([^"]+)">/);
  assert.ok(m, 'csrf meta tag found on ' + urlPath);
  return m[1];
}

before(async () => {
  const { initDatabase } = require('../database/init');
  const db = require('../database/db');
  await initDatabase();
  // Set a known password for the seeded admin user (faster bcrypt rounds).
  await db.run('UPDATE users SET password_hash = ? WHERE username = ?', [await bcrypt.hash(ADMIN_PASS, 4), ADMIN_USER]);

  const app = require('../app');
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});

after(() => {
  server?.close();
  try {
    fs.rmSync(path.dirname(process.env.FTS_DB_PATH), { recursive: true, force: true });
  } catch (err) {
    // ignore cleanup errors
  }
});

test('healthz responds ok', async () => {
  const res = await request('GET', '/healthz');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
});

test('public endpoints respond', async () => {
  const home = await request('GET', '/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /夏祭|FTS/);

  const feed = await request('GET', '/feed.xml');
  assert.equal(feed.status, 200);
  const feedText = await feed.text();
  assert.match(feedText, /<rss version="2\.0"/);
  assert.match(feedText, /<item>/);

  const tags = await request('GET', '/tags');
  assert.equal(tags.status, 200);

  const search = await request('GET', '/search?q=SQLite');
  assert.equal(search.status, 200);
  const searchText = await search.text();
  assert.match(searchText, /SQLite/);
});

test('homepage shows nav, status panel, hero actions and hot strip', async () => {
  const res = await request('GET', '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /nav-links/, 'top navigation rendered');
  assert.match(html, /status-panel/, 'stats panel rendered');
  assert.match(html, /hero-actions/, 'hero search/random actions rendered');
  assert.match(html, /随机图纸|RANDOM/, 'random button rendered');
  assert.match(html, /hot-section/, 'hot drawings strip rendered');
  assert.match(html, /post-grid/, 'card grid rendered');
  assert.match(html, /查看更多|VIEW ALL POSTS/, 'view-all button rendered');
});

test('homepage shows "view all" when more than 12 posts', async () => {
  // Seed enough posts to exceed the homepage limit of 12.
  const db = require('../database/db');
  const baseTime = new Date().toISOString();
  for (let i = 0; i < 10; i++) {
    await db.run(
      `INSERT INTO posts (title, slug, content, published, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [`Extra Post ${i}`, `extra-post-${i}`, `content ${i}`, baseTime, baseTime]
    );
  }
  cache.invalidateAll();

  const res = await request('GET', '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /查看更多|VIEW ALL POSTS/, 'view-all button rendered when over limit');
  assert.match(html, /post-grid/, 'card grid rendered');
  assert.match(html, /card-title/, 'card titles rendered');
});

test('/posts archive shows all published posts as a drum list', async () => {
  const res = await request('GET', '/posts');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /全部图纸|ALL POSTS/, 'archive title rendered');
  assert.match(html, /drum-viewport/, 'drum viewport rendered');
  assert.match(html, /drum-item/, 'drum items rendered');
  assert.match(html, /drum-track/, 'drum track rendered');
  const itemCount = (html.match(/drum-item/g) || []).length;
  assert.ok(itemCount >= 3, 'multiple drum items rendered, got ' + itemCount);
});

test('random redirects to a published post (or home when none)', async () => {
  const res = await request('GET', '/random');
  assert.equal(res.status, 200); // 302 followed to the target post
  assert.match(res.url, /\/post\/\d+$/, 'landed on a post page, got: ' + res.url);
  const html = await res.text();
  assert.match(html, /hljs|title-block/, 'post page rendered');
});

test('login then CSRF-protected post creation works end to end', async () => {
  const tokenBeforeLogin = await getCsrfFrom('/admin/login');

  const loginRes = await request('POST', '/api/auth/login', { json: { username: ADMIN_USER, password: ADMIN_PASS } });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.ok(loginData.csrfToken, 'login response includes csrfToken');
  assert.notEqual(loginData.csrfToken, tokenBeforeLogin, 'csrf token rotates on login (session regenerated)');

  // Mutation without CSRF token must be rejected.
  const noCsrf = await request('POST', '/api/posts', {
    json: { title: 'x', slug: 'x', content: 'x' }
  });
  assert.equal(noCsrf.status, 403);

  // /api/auth/csrf returns the same token for the authenticated session.
  const csrfRes = await request('GET', '/api/auth/csrf');
  assert.equal(csrfRes.status, 200);
  const csrfData = await csrfRes.json();
  assert.equal(csrfData.csrfToken, loginData.csrfToken);

  // Admin pages render with the rotated token too.
  const tokenOnAdmin = await getCsrfFrom('/admin');
  assert.equal(tokenOnAdmin, loginData.csrfToken);

  const createRes = await request('POST', '/api/posts', {
    json: { title: '测试文章', title_en: 'Test Post', slug: 'test-post', content: '## 正文\n\n代码块:\n\n```js\nconst a = 1;\n```', excerpt: '摘要', tags: ['测试', 'Node.js'], published: true },
    headers: { 'X-CSRF-Token': loginData.csrfToken }
  });
  assert.equal(createRes.status, 201);
  const { id } = await createRes.json();

  // Duplicate slug returns 409, not a leaked 500.
  const dupRes = await request('POST', '/api/posts', {
    json: { title: '重复', slug: 'test-post', content: 'x' },
    headers: { 'X-CSRF-Token': loginData.csrfToken }
  });
  assert.equal(dupRes.status, 409);

  // Listed and searchable
  const list = await request('GET', '/api/posts');
  const listData = await list.json();
  assert.ok(listData.posts.some((p) => p.id === id));

  const searchRes = await request('GET', '/search?q=' + encodeURIComponent('测试文章'));
  const searchText = await searchRes.text();
  assert.match(searchText, /测试文章/);

  // Rendered post page contains highlighted code
  const postRes = await request('GET', '/post/' + id);
  assert.equal(postRes.status, 200);
  const postText = await postRes.text();
  assert.match(postText, /hljs/);

  // view_count incremented (flush the debounced counter first)
  const viewCounter = require('../lib/viewCounter');
  await viewCounter.flush();
  const detail = await request('GET', '/api/posts/test-post');
  const detailData = await detail.json();
  assert.ok(detailData.view_count >= 1);

  // Tag page reachable (tag name with % must not 500 — double-decode fix)
  const tagRes = await request('GET', '/tag/' + encodeURIComponent('测试'));
  assert.equal(tagRes.status, 200);

  // Delete
  const delRes = await request('DELETE', '/api/posts/' + id, { headers: { 'X-CSRF-Token': loginData.csrfToken } });
  assert.equal(delRes.status, 200);

  // Logout with CSRF
  const logoutRes = await request('POST', '/api/auth/logout', { headers: { 'X-CSRF-Token': loginData.csrfToken } });
  assert.equal(logoutRes.status, 200);
});

test('login rate limiter rejects rapid attempts', async () => {
  // Exhaust the per-window budget, then verify a 429.
  let lastStatus = 0;
  for (let i = 0; i < 30; i++) {
    const res = await request('POST', '/api/auth/login', { json: { username: 'admin', password: 'wrong' } });
    lastStatus = res.status;
    if (lastStatus === 429) break;
  }
  assert.equal(lastStatus, 429);
});

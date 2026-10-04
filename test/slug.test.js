'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SLUG_PATTERN, SLUG_PATTERN_SOURCE, slugify } = require('../lib/slug');

test('slugify: keeps lowercase ascii, digits, hyphens and CJK', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('部署Astrbot+NapCat搭建QQ机器人'), '部署astrbot-napcat搭建qq机器人');
  assert.equal(slugify('🐧 Linux 高级命令大全 (100条)'), 'linux-高级命令大全-100条');
  assert.equal(slugify('  --already--clean--  '), 'already-clean');
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  assert.equal(slugify('🐧'), '');
});

test('every slug the importer generates passes post validation', () => {
  const dir = path.join(__dirname, '..', '经验');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  assert.ok(files.length > 0, 'sample 经验/ files present');
  for (const file of files) {
    const slug = slugify(file.replace(/\.md$/, ''));
    assert.ok(SLUG_PATTERN.test(slug), `slug from "${file}" passes SLUG_PATTERN: ${slug}`);
  }
});

test('SLUG_PATTERN_SOURCE compiles with the v flag (browsers compile <input pattern> in v mode)', () => {
  // An unescaped '-' inside a character class is a SyntaxError in 'v' mode
  // in ANY position (leading, trailing, middle), and an uncompilable pattern
  // attribute makes the control reject every value — this pin guards the
  // editor's pattern attribute.
  assert.doesNotThrow(() => new RegExp(`^(?:${SLUG_PATTERN_SOURCE})$`, 'v'));
  assert.doesNotThrow(() => new RegExp(`^(?:${SLUG_PATTERN_SOURCE})$`, 'u'));
  assert.doesNotThrow(() => new RegExp(`^(?:${SLUG_PATTERN_SOURCE})$`));
  // Same semantics in every mode
  const reV = new RegExp(`^(?:${SLUG_PATTERN_SOURCE})$`, 'v');
  assert.ok(reV.test('部署astrbot-napcat搭建qq机器人'));
  assert.ok(reV.test('linux-高级命令大全-100条'));
  assert.ok(reV.test('my-post-42'));
  assert.ok(!reV.test('has space'));
  assert.ok(!reV.test('🐧'));
  assert.ok(!reV.test('大写混合X'));
});

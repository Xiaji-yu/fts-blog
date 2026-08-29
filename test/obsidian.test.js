'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFrontmatter, convertObsidianSyntax, escapeTablePipes, normalizeYamlValue } = require('../lib/obsidian');

test('parseFrontmatter: extracts YAML fields and strips the block', () => {
  const input = '---\ntitle: 我的笔记\ndate: 2026-08-18\ntags: [技术, 前端]\n---\n\n# 正文\n';
  const { frontmatter, content } = parseFrontmatter(input);
  assert.equal(frontmatter.title, '我的笔记');
  assert.deepEqual(frontmatter.tags, ['技术', '前端']);
  assert.match(content, /# 正文/);
});

test('parseFrontmatter: no frontmatter returns content unchanged', () => {
  const input = '# 没有 frontmatter 的文章\n\n正文内容';
  const { frontmatter, content } = parseFrontmatter(input);
  assert.deepEqual(frontmatter, {});
  assert.equal(content, input);
});

test('parseFrontmatter: BOM is stripped', () => {
  const input = '\uFEFF---\ntitle: BOM\n---\n正文';
  const { frontmatter, content } = parseFrontmatter(input);
  assert.equal(frontmatter.title, 'BOM');
  assert.equal(content, '正文');
});

test('parseFrontmatter: invalid YAML falls back to empty frontmatter', () => {
  const input = '---\ntitle: [unclosed\n---\n正文';
  const { frontmatter, content } = parseFrontmatter(input);
  assert.deepEqual(frontmatter, {});
  assert.equal(content, '正文');
});

test('convertObsidianSyntax: wiki links map to /post/:id via slugToIdMap', () => {
  const out = convertObsidianSyntax('[[另一篇笔记]] 和 [[笔记|别名]]', { '另一篇笔记': 42 });
  assert.equal(out, '[另一篇笔记](/post/42) 和 [别名](/post/笔记)');
});

test('convertObsidianSyntax: image embeds become /uploads references', () => {
  const out = convertObsidianSyntax('![[diagram.png]] 和 ![[notes.pdf]]');
  assert.match(out, /!\[diagram\.png\]\(\/uploads\/diagram\.png\)/);
  assert.match(out, /\[notes\.pdf\]\(\/uploads\/notes\.pdf\)/);
});

test('convertObsidianSyntax: callout becomes blockquote with icon', () => {
  const out = convertObsidianSyntax('> [!warning] 注意\n> 这是一条警告');
  assert.match(out, /^> ⚠️ \*\*WARNING\*\* 注意\n> 这是一条警告/);
});

test('convertObsidianSyntax: table pipes are escaped', () => {
  const out = convertObsidianSyntax('| 名称 | 值 |\n| --- | --- |\n| a|b | c |');
  assert.ok(out.includes('a\\|b'));
});

test('escapeTablePipes: preserves already-escaped pipes', () => {
  assert.equal(escapeTablePipes('| a\\|b | c |'), '| a\\|b | c |');
});

test('normalizeYamlValue: converts Date instances to ISO strings', () => {
  const d = new Date('2026-01-02T03:04:05Z');
  assert.equal(normalizeYamlValue(d), '2026-01-02T03:04:05.000Z');
  assert.equal(normalizeYamlValue('plain'), 'plain');
});

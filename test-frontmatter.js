// Test frontmatter parsing
const content = `---
title: 前端技术笔记
date: 2026-08-18
tags: [前端, JavaScript, CSS]
description: 从 Obsidian 导入的前端技术笔记
---

# 前端技术笔记

这是一篇从 Obsidian 导入的示例笔记。`;

function parseFrontmatter(content) {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    console.log('No frontmatter match');
    return { frontmatter: {}, content: content };
  }

  console.log('Match found!');
  console.log('Group 1 (frontmatter):', match[1]);
  console.log('Group 2 (content):', match[2]);

  try {
    const yaml = require('js-yaml');
    const frontmatter = yaml.load(match[1]);
    const markdownContent = match[2];
    return { frontmatter, content: markdownContent };
  } catch (err) {
    console.log('YAML parse error:', err.message);
    return { frontmatter: {}, content: content };
  }
}

const result = parseFrontmatter(content);
console.log('\nResult frontmatter:', JSON.stringify(result.frontmatter));
console.log('\nResult content preview:', result.content.substring(0, 100));

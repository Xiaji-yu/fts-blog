'use strict';
/**
 * Obsidian-specific Markdown helpers, extracted from routes/import.js so they
 * can be unit-tested independently.
 */
const path = require('path');
const yaml = require('js-yaml');
const config = require('../config/loader');

// Normalize YAML-parsed values (dates, etc.)
function normalizeYamlValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

// Parse YAML frontmatter from markdown. Only treats --- as frontmatter
// delimiter when it occupies a line by itself (avoids confusing content-level
// horizontal rules with frontmatter end).
function parseFrontmatter(content) {
  if (typeof content !== 'string') return { frontmatter: {}, content: '' };
  // Strip UTF-8 BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  const lines = content.split('\n');

  if (!lines.length || lines[0].trim() !== '---') {
    return { frontmatter: {}, content: content };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, content: content };
  }

  const frontmatterText = lines.slice(1, endIndex).join('\n').trim();
  const markdownContent = lines.slice(endIndex + 1).join('\n');

  let frontmatter = {};
  try {
    frontmatter = yaml.load(frontmatterText, { schema: yaml.SAFE_SCHEMA }) || {};
  } catch (err) {
    // If YAML parsing fails, return empty frontmatter
  }

  return { frontmatter, content: markdownContent };
}

// Escape pipe characters inside markdown table cells.
// A pipe is kept as-is when it is a table delimiter (first/last char), already
// escaped (preceded by backslash), or clearly a column separator (surrounded
// by spaces). Other pipes are treated as cell content and escaped.
function escapeTablePipes(line) {
  const trimmed = line.trim();
  let out = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '|') {
      const isBoundary = i === 0 || i === trimmed.length - 1;
      const alreadyEscaped = out.endsWith('\\');
      const prevIsSpace = out.endsWith(' ');
      const nextIsSpace = i + 1 < trimmed.length ? /\s/.test(trimmed[i + 1]) : true;
      if (isBoundary || alreadyEscaped || (prevIsSpace && nextIsSpace)) {
        out += ch;
      } else {
        out += '\\|';
      }
    } else {
      out += ch;
    }
  }
  return out;
}

// Convert Obsidian-specific syntax to standard Markdown.
// slugToIdMap: optional map of slug -> post id for internal wiki links.
function convertObsidianSyntax(content, slugToIdMap = {}) {
  const lines = content.split('\n');
  const result = [];
  let inCallout = false;
  let calloutType = '';
  let calloutIcon = '';
  let calloutLines = [];

  const calloutTypeMap = config.import.calloutIconMap || {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect multi-line callout: > [!type]
    const calloutMatch = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/);
    if (calloutMatch) {
      inCallout = true;
      calloutType = calloutMatch[1].toUpperCase();
      calloutIcon = calloutTypeMap[calloutMatch[1].toLowerCase()] || '📝';
      const firstLine = calloutMatch[2].trim();
      calloutLines = firstLine ? [`> ${calloutIcon} **${calloutType}** ${firstLine}`] : [`> ${calloutIcon} **${calloutType}**`];
      continue;
    }

    if (inCallout) {
      // Check if this line is still part of the callout (starts with >)
      if (line.startsWith('>') || line.trim() === '') {
        calloutLines.push(line.trim() === '' ? '>' : line);
        continue;
      } else {
        // End of callout
        inCallout = false;
        result.push(...calloutLines);
        result.push(''); // Empty line after callout
        calloutLines = [];
      }
    }

    // Handle table rows - escape pipes inside cell content
    const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|');
    const isTableSeparator = /^\|?[\s\-:]+\|[\s\-:]+\|?$/.test(line.trim());

    if (isTableRow && !isTableSeparator) {
      result.push(escapeTablePipes(line));
      continue;
    }

    // Convert embeds ![[file]] before wiki links (avoid conflict)
    let processed = line.replace(/!\[\[([^\]]+)\]\]/g, (match, file) => {
      const ext = path.extname(file).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
        return `![${file}](/uploads/${file})`;
      }
      return `[${file}](/uploads/${file})`;
    });

    // Convert wiki links [[Link]] or [[Link|Alias]]
    processed = processed.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, link, alias) => {
      const text = alias || link;
      const slug = link.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '');
      const postId = slugToIdMap[slug];
      if (postId) {
        return `[${text}](/post/${postId})`;
      }
      return `[${text}](/post/${slug})`;
    });

    result.push(processed);
  }

  // Flush remaining callout
  if (inCallout) {
    result.push(...calloutLines);
  }

  return result.join('\n');
}

module.exports = { normalizeYamlValue, parseFrontmatter, escapeTablePipes, convertObsidianSyntax };

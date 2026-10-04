'use strict';
/**
 * Single source of truth for slug rules, shared by the admin API, the
 * Obsidian importer and the editor template so they can never drift apart.
 *
 * Slugs keep lowercase ASCII letters, digits, hyphens and CJK ideographs
 * (U+4E00–U+9FA5) so posts imported from CJK-titled Obsidian files keep
 * their original, human-readable URLs. Everything else normalizes to '-'.
 *
 * NOTE: SLUG_PATTERN_SOURCE must stay compilable with the RegExp 'v' flag —
 * browsers compile <input pattern> attributes in 'v' (UnicodeSets) mode,
 * where an unescaped '-' inside a character class is a SyntaxError in ANY
 * position (leading, trailing or middle). Always write it escaped as '\-'.
 * An uncompilable pattern attribute makes the control reject every value.
 */
const SLUG_PATTERN_SOURCE = '[a-z0-9一-龥\\-]+';
const SLUG_PATTERN = new RegExp(`^${SLUG_PATTERN_SOURCE}$`);

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { SLUG_PATTERN, SLUG_PATTERN_SOURCE, slugify };

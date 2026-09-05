// URL slug helpers shared by the editor (routes, links) and the static
// exporter (published file paths) — divergence would change published
// routes vs editor links, so both sides import this one copy.

/**
 * normalizes a string into a url slug segment
 * @param {string} value
 * @returns {string}
 */
export function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * an entry's own slug, or one derived from its name (older entries)
 * @param {{ slug?: string, name: string }} entry
 * @returns {string}
 */
export const entrySlug = (entry) => entry.slug || slugify(entry.name)

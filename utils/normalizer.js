/**
 * Normalize a design name for consistent matching.
 *
 * Applies factory-specific filters (passed as a filters object) and
 * a small set of global replacements so common spelling variants
 * collapse to the same token (e.g. "grey" / "gray").
 *
 * @param {string} designName
 * @param {object} filters  - { ignoreTokensAnywhere, ignoreTokensPrefixes, ignoreTokensSuffixes, faceSuffixes }
 * @returns {string}
 */
function normalizeDesignName(designName, filters = {}) {
  if (!designName) return "";

  const {
    ignoreTokensAnywhere = [],
    ignoreTokensPrefixes = [],
    ignoreTokensSuffixes = [],
    faceSuffixes = [],
  } = filters;

  const tokens = designName
    .toLowerCase()
    .replace(/grey/g, "gray")
    .replace(/cremah/g, "crema")
    .replace(/bej\b/g, "beige")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const cleaned = tokens.filter((t) => !ignoreTokensAnywhere.includes(t));

  while (cleaned.length > 0 && ignoreTokensPrefixes.includes(cleaned[0])) {
    cleaned.shift();
  }

  while (cleaned.length > 0 && ignoreTokensSuffixes.includes(cleaned[cleaned.length - 1])) {
    cleaned.pop();
  }

  // Strip face suffixes (r1, bp, lp, …) — faces all map to the same base design
  while (cleaned.length > 1 && faceSuffixes.includes(cleaned[cleaned.length - 1])) {
    cleaned.pop();
  }

  return cleaned.join(" ");
}

module.exports = { normalizeDesignName };
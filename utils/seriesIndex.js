const { loadMetadata } = require("./metadata");

// ─── WHY THIS EXISTS ──────────────────────────────────────────────────────────
//
// Problem: when a user types "tc brown" without specifying a surface, the bot
// searches ALL surfaces. The first surface searched (e.g. "magic") has no tc
// designs — so Fuse matches "brown" against "magic choco" and returns the
// wrong answer. This happens because Fuse is comparing "tc brown" against a
// pool of names that don't share the same series, so "brown" in common is
// enough to get a misleadingly confident score.
//
// Fix: build a map at startup of { firstWord → Set<surfaceKey> } for each
// factory, derived directly from designs.json. When the user's first word
// is a known series prefix (e.g. "tc", "magic", "express"), restrict the
// surface search to ONLY the surfaces that contain that series. This prevents
// "tc brown" from ever being matched against the magic surface bucket.
//
// The map is built once when the module first loads and cached in memory.
// It's derived from the real data so it never goes stale without a metadata
// regeneration.

let cache = null; // { factoryName: Map<prefix, Set<surfaceKey>> }

function buildSeriesIndex() {
  const { raw } = loadMetadata();
  const result = {};

  for (const [factoryName, factoryData] of Object.entries(raw)) {
    const prefixMap = new Map(); // prefix → Set<"type/size/surface">

    for (const [typeKey, typeBucket] of Object.entries(factoryData || {})) {
      for (const [sizeKey, sizeBucket] of Object.entries(typeBucket || {})) {
        for (const [surfKey, bucket] of Object.entries(sizeBucket || {})) {
          for (const designName of Object.keys(bucket)) {
            const firstWord = designName
              .toLowerCase()
              .trim()
              .split(/[\s_-]+/)[0];

            if (!firstWord || firstWord.length < 2) continue;

            if (!prefixMap.has(firstWord)) prefixMap.set(firstWord, new Set());
            // Store as "type|surface" so callers can filter by type too
            prefixMap.get(firstWord).add(`${typeKey}|${surfKey}`);
          }
        }
      }
    }

    result[factoryName] = prefixMap;
  }

  return result;
}

function getSeriesIndex() {
  if (!cache) {
    cache = buildSeriesIndex();
    const totalPrefixes = Object.values(cache).reduce((n, m) => n + m.size, 0);
    console.log(`[SERIES INDEX] Built: ${totalPrefixes} series prefixes across ${Object.keys(cache).length} factories`);
  }
  return cache;
}

/**
 * Given a user's design input and a factory name, return the set of surface
 * keys that the matching series lives in — or null if the first word isn't
 * a known series prefix (meaning: don't restrict, search all surfaces).
 *
 * @param {string} factoryName
 * @param {string} userInput       - raw user-typed design name
 * @param {string} typeKey         - "jpg" or "live"
 * @returns {string[]|null}        - locked surface keys, or null = no lock
 */
function getLockedSurfaces(factoryName, userInput, typeKey) {
  const index = getSeriesIndex();
  const prefixMap = index[factoryName];
  if (!prefixMap) return null;

  const firstWord = userInput
    .toLowerCase()
    .trim()
    .split(/[\s_-]+/)[0];

  if (!firstWord || firstWord.length < 2) return null;

  const bucketKeys = prefixMap.get(firstWord);
  if (!bucketKeys || bucketKeys.size === 0) return null;

  // Filter to the requested type and extract just the surface keys
  const surfaces = [];
  for (const key of bucketKeys) {
    const [keyType, keySurf] = key.split("|");
    if (keyType === typeKey) surfaces.push(keySurf);
  }

  if (surfaces.length === 0) return null;

  console.log(`  [SERIES LOCK] "${firstWord}" → surfaces: [${surfaces.join(", ")}] in ${typeKey}`);
  return surfaces;
}

module.exports = { getLockedSurfaces };
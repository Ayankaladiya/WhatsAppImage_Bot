const Fuse = require("fuse.js");
const { normalizeDesignName } = require("./normalizer");

// =============================================================================
// INDEX CACHE
// =============================================================================
//
// One index per:
//
//     factory + type + size + surface
//
// This is important because a design name is NOT globally unique.
//
// The real identity is:
//
//     factory + type + size + surface + design
// =============================================================================

const indexCache = new Map();

// =============================================================================
// VARIANTS
// =============================================================================
//
// These are product/design variants.
//
// They are different from face suffixes such as:
//
//     R1
//     R2
//     F1
//     F2
//
// Face suffixes are already removed by normalizer.js.
//
// Variant suffixes remain part of the design identity.
//
// Example:
//
//     marvel crema
//     marvel crema hl
//     marvel crema lt
//     marvel crema dk
//     marvel crema decore
//
// A request for:
//
//     marvel crema
//
// gets the base + all variants.
//
// A request for:
//
//     marvel crema decore
//
// gets base + decore.
// =============================================================================

const VARIANT_SUFFIXES = new Set(["hl", "lt", "dk", "decor", "decore"]);

// =============================================================================
// HELPERS
// =============================================================================

function splitVariantSuffix(normalized) {
  const tokens = normalized.trim().split(/\s+/).filter(Boolean);

  if (tokens.length < 2) {
    return {
      base: normalized,
      variantSuffix: null,
    };
  }

  const last = tokens[tokens.length - 1];

  if (!VARIANT_SUFFIXES.has(last)) {
    return {
      base: normalized,
      variantSuffix: null,
    };
  }

  return {
    base: tokens.slice(0, -1).join(" "),
    variantSuffix: last,
  };
}

function createEntry(normalized) {
  const { base, variantSuffix } = splitVariantSuffix(normalized);

  return {
    normalized,
    base,
    variantSuffix,

    // Original catalogue names that produced this normalized name.
    rawNames: new Set(),

    // Images physically belonging to this exact name.
    ownImages: [],

    // Images that should be returned to the user.
    allImages: [],
  };
}

// =============================================================================
// BUILD INDEX
// =============================================================================

function buildIndex(bucket, filters) {
  const normalizedMap = new Map();

  // Exact numeric design lookup.
  //
  // IMPORTANT:
  //
  // Only names that are PURELY numeric are put here.
  //
  // "4085"     → numeric key
  // "4085 hl"  → NOT a numeric key
  // "4085_f1"  → NOT a numeric key
  //
  // This prevents accidental matching from digit substrings.
  const numericMap = new Map();

  // Only base entries are used for fuzzy retrieval.
  const baseEntries = [];

  // ---------------------------------------------------------------------------
  // PASS 1
  // ---------------------------------------------------------------------------

  for (const [rawName, images] of Object.entries(bucket || {})) {
    const normalized = normalizeDesignName(rawName, filters);

    if (!normalized) {
      continue;
    }

    let entry = normalizedMap.get(normalized);

    if (!entry) {
      entry = createEntry(normalized);
      normalizedMap.set(normalized, entry);

      if (entry.variantSuffix === null) {
        baseEntries.push(entry);
      }
    }

    entry.rawNames.add(rawName);

    if (Array.isArray(images)) {
      entry.ownImages.push(...images);
    }

    // -------------------------------------------------------------------------
    // EXACT NUMERIC INDEX
    // -------------------------------------------------------------------------
    //
    // Only the normalized name itself can be numeric.
    //
    // This is intentionally strict.
    // -------------------------------------------------------------------------

    if (/^\d+$/.test(normalized)) {
      if (!numericMap.has(normalized)) {
        numericMap.set(normalized, entry);
      } else {
        const existing = numericMap.get(normalized);

        if (existing !== entry) {
          console.warn(`[INDEX] Numeric collision for "${normalized}"`);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PASS 2
  //
  // Start base entries with their own images.
  // ---------------------------------------------------------------------------

  for (const entry of normalizedMap.values()) {
    if (entry.variantSuffix === null) {
      entry.allImages.push(...entry.ownImages);
    }
  }

  // ---------------------------------------------------------------------------
  // PASS 3
  //
  // Connect variants to their base.
  // ---------------------------------------------------------------------------

  for (const entry of normalizedMap.values()) {
    if (entry.variantSuffix === null) {
      continue;
    }

    const baseEntry = normalizedMap.get(entry.base);

    if (baseEntry) {
      // Base request gets all variants.
      baseEntry.allImages.push(...entry.ownImages);

      // Variant request gets base + this variant.
      entry.allImages.push(...baseEntry.ownImages, ...entry.ownImages);

      continue;
    }

    // -------------------------------------------------------------------------
    // No physical base exists.
    //
    // Example:
    //
    // 2821 hl
    // 2821 lt
    // 2821 dk
    //
    // There is no bare "2821".
    //
    // We still allow:
    //
    // 2821
    //
    // to return all variants.
    // -------------------------------------------------------------------------

    entry.allImages.push(...entry.ownImages);

    let syntheticBase = normalizedMap.get(entry.base);

    if (!syntheticBase) {
      syntheticBase = createEntry(entry.base);

      normalizedMap.set(entry.base, syntheticBase);

      baseEntries.push(syntheticBase);
    }

    syntheticBase.allImages.push(...entry.ownImages);
  }

  // ---------------------------------------------------------------------------
  // Remove duplicate image paths.
  // ---------------------------------------------------------------------------

  for (const entry of normalizedMap.values()) {
    entry.ownImages = [...new Set(entry.ownImages)];

    entry.allImages = [...new Set(entry.allImages)];
  }

  // ---------------------------------------------------------------------------
  // FUZZY INDEX
  // ---------------------------------------------------------------------------
  //
  // Fuse is NOT the final decision maker.
  //
  // It is only a retrieval helper for openai.js.
  //
  // We keep it strict enough to avoid producing enormous candidate lists.
  // ---------------------------------------------------------------------------

  const fuse =
    baseEntries.length > 0
      ? new Fuse(baseEntries, {
          keys: ["normalized"],
          threshold: 0.35,
          distance: 1000,
          ignoreLocation: true,
          includeScore: true,
          minMatchCharLength: 2,
        })
      : null;

  return {
    normalizedMap,
    numericMap,
    entries: baseEntries,
    fuse,
  };
}

// =============================================================================
// PUBLIC API
// =============================================================================

function searchIndex(index, query, limit = 30) {
  if (!index || !query || !index.fuse) {
    return [];
  }

  const results = index.fuse.search(String(query).trim()).slice(0, limit);

  return results.map((result) => ({
    entry: result.item,
    score: result.score,
  }));
}

function getIndexForBucket(factoryName, type, size, surface, bucket, filters) {
  const key = `${factoryName}|${type}|${size}|${surface}`;

  const cached = indexCache.get(key);

  if (cached) {
    return cached;
  }

  const index = buildIndex(bucket, filters);

  indexCache.set(key, index);

  console.log(
    `[INDEX] Built ${key} | designs=${index.entries.length} | numeric=${index.numericMap.size}`,
  );

  return index;
}

function clearIndexCache() {
  indexCache.clear();
  console.log("[INDEX] Cache cleared");
}

module.exports = {
  searchIndex,
  getIndexForBucket,
  clearIndexCache,
  VARIANT_SUFFIXES,
};

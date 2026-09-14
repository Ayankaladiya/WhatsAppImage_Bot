const fs = require("fs");
const path = require("path");

// =============================================================================
// PERSISTENT CORRECTION CACHE
// =============================================================================
//
// This cache stores CONFIRMED design-name corrections.
//
// It is deliberately NOT a general fuzzy matcher.
//
// Its only job:
//
//     previously verified typo
//              ↓
//     previously verified catalogue design
//
// Next time the same request context appears:
//
//     cache lookup
//              ↓
//     verify target still exists in current index
//              ↓
//     use it without OpenAI
//
// Cache scope:
//
//     factory
//       + size
//       + surface
//       + user input
//
// This is important because the same factory can contain the same design name
// on different surfaces and sizes.
//
// Example:
//
// {
//   "armano": {
//     "600x1200": {
//       "magic": {
//         "magic greay": "magic gray"
//       }
//     }
//   }
// }
//
// =============================================================================

const CACHE_PATH = path.join(__dirname, "../data/correctionCache.json");

let cache = null;

// Keep the in-memory cache reasonably small.
// The persistent file remains the source of truth.
const MAX_CACHE_ENTRIES = 10000;

// =============================================================================
// NORMALIZATION
// =============================================================================

function normalizeFactory(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeSize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\*/g, "x");
}

function normalizeSurface(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/**
 * Normalize user input only for cache-key consistency.
 *
 * This is NOT the catalogue design normalizer.
 *
 * The actual catalogue target is always verified against designIndex.
 */
function normalizeInput(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/grey/g, "gray")
    .replace(/cremah/g, "crema")
    .replace(/bej\b/g, "beige")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =============================================================================
// LOAD / SAVE
// =============================================================================

function load() {
  if (cache) {
    return cache;
  }

  try {
    if (!fs.existsSync(CACHE_PATH)) {
      cache = {};
      return cache;
    }

    const raw = fs.readFileSync(CACHE_PATH, "utf8");

    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      cache = parsed;
    } else {
      console.warn("[CACHE] Invalid cache format. Starting empty.");

      cache = {};
    }
  } catch (err) {
    console.error(`[CACHE] Failed to load: ${err.message}`);

    cache = {};
  }

  return cache;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });

    const tempPath = `${CACHE_PATH}.tmp`;

    fs.writeFileSync(tempPath, JSON.stringify(cache, null, 2), "utf8");

    // Atomic replacement.
    //
    // This reduces the chance of ending up with a partially-written JSON file
    // if the process stops while saving.
    fs.renameSync(tempPath, CACHE_PATH);
  } catch (err) {
    console.error(`[CACHE] Failed to save: ${err.message}`);
  }
}

// =============================================================================
// CACHE ENTRY ACCESS
// =============================================================================

function getSurfaceBucket(factory, size, surface, create = false) {
  const data = load();

  const factoryKey = normalizeFactory(factory);

  const sizeKey = normalizeSize(size);

  const surfaceKey = normalizeSurface(surface);

  if (!factoryKey || !sizeKey || !surfaceKey) {
    return null;
  }

  if (!data[factoryKey]) {
    if (!create) {
      return null;
    }

    data[factoryKey] = {};
  }

  if (!data[factoryKey][sizeKey]) {
    if (!create) {
      return null;
    }

    data[factoryKey][sizeKey] = {};
  }

  if (!data[factoryKey][sizeKey][surfaceKey]) {
    if (!create) {
      return null;
    }

    data[factoryKey][sizeKey][surfaceKey] = {};
  }

  return data[factoryKey][sizeKey][surfaceKey];
}

// =============================================================================
// COUNT
// =============================================================================

function countEntries() {
  const data = load();

  let count = 0;

  for (const factory of Object.values(data)) {
    if (!factory || typeof factory !== "object") {
      continue;
    }

    for (const size of Object.values(factory)) {
      if (!size || typeof size !== "object") {
        continue;
      }

      for (const surface of Object.values(size)) {
        if (!surface || typeof surface !== "object") {
          continue;
        }

        count += Object.keys(surface).length;
      }
    }
  }

  return count;
}

// =============================================================================
// LOOKUP
// =============================================================================

/**
 * Get a previously learned correction for one exact catalogue context.
 *
 * Returns:
 *
 *     string  → cached normalized design name
 *     null    → no cached correction
 */
function getCachedCorrection(factory, size, surface, userInput) {
  const bucket = getSurfaceBucket(factory, size, surface, false);

  if (!bucket) {
    return null;
  }

  const key = normalizeInput(userInput);

  if (!key) {
    return null;
  }

  const result = bucket[key] || null;

  if (result) {
    console.log(
      `[CACHE] "${userInput}" → "${result}" | ${factory}/${size}/${surface}`,
    );
  }

  return result;
}

// =============================================================================
// SAVE CORRECTION
// =============================================================================

/**
 * Remember a CONFIRMED correction.
 *
 * This function does not verify the target itself.
 *
 * The caller MUST only call this after confirming that the target exists in
 * the current exact design index.
 */
function rememberCorrection(factory, size, surface, userInput, correctedName) {
  const key = normalizeInput(userInput);

  const corrected = String(correctedName || "").trim();

  if (!key || !corrected) {
    return;
  }

  if (key === normalizeInput(corrected)) {
    // No correction occurred.
    return;
  }

  const bucket = getSurfaceBucket(factory, size, surface, true);

  if (!bucket) {
    return;
  }

  // Never silently overwrite a different correction.
  //
  // Example:
  //
  // "magic gre" → "magic gray"
  //
  // If later something tries to store:
  //
  // "magic gre" → "magic green"
  //
  // we do NOT replace the original mapping automatically.
  if (bucket[key] && bucket[key] !== corrected) {
    console.warn(
      `[CACHE] ⚠️ Existing correction conflict: "${userInput}" → "${bucket[key]}" | attempted "${corrected}" | ${factory}/${size}/${surface}`,
    );

    return;
  }

  if (bucket[key] === corrected) {
    return;
  }

  // Basic protection against unlimited growth.
  if (countEntries() >= MAX_CACHE_ENTRIES) {
    console.warn(
      `[CACHE] Cache limit (${MAX_CACHE_ENTRIES}) reached. New correction not stored.`,
    );

    return;
  }

  bucket[key] = corrected;

  save();

  console.log(
    `[CACHE] Learned "${userInput}" → "${corrected}" | ${factory}/${size}/${surface}`,
  );
}

// =============================================================================
// INVALIDATE
// =============================================================================

/**
 * Remove one cached correction.
 *
 * This is useful if catalogue data changes and you know a particular cached
 * correction should no longer be used.
 */
function removeCorrection(factory, size, surface, userInput) {
  const bucket = getSurfaceBucket(factory, size, surface, false);

  if (!bucket) {
    return false;
  }

  const key = normalizeInput(userInput);

  if (!bucket[key]) {
    return false;
  }

  delete bucket[key];

  save();

  console.log(`[CACHE] Removed "${userInput}" | ${factory}/${size}/${surface}`);

  return true;
}

// =============================================================================
// CLEAR
// =============================================================================

function clearCache() {
  cache = {};

  save();

  console.log("[CACHE] Entire correction cache cleared");
}

// =============================================================================
// PUBLIC API
// =============================================================================

module.exports = {
  getCachedCorrection,
  rememberCorrection,
  removeCorrection,
  clearCache,
};

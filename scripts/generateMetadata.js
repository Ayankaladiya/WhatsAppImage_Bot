const fs = require("fs");
const path = require("path");
const { factoryConfig } = require("../config/factoryConfig");
require("dotenv").config();

// =============================================================================
// CONFIG
// =============================================================================

const PLATFORM = "linux";

const PATHS = {
  windows: {
    imagesRoot: "D:\\Catalogue\\images",
    outputFile: path.join(__dirname, "../data/designs.json"),
  },

  linux: {
    imagesRoot: "/home/kishan/projects/images",
    outputFile: "/home/kishan/projects/WhatsAppImage_Bot/data/designs.json",
  },
};

const paths = PATHS[PLATFORM];

if (!paths) {
  throw new Error(`Unknown PLATFORM: "${PLATFORM}"`);
}

const IMAGES_ROOT = paths.imagesRoot;
const OUTPUT_FILE = paths.outputFile;

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
]);

// =============================================================================
// HELPERS
// =============================================================================

function isImage(fileName) {
  return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function getDirectories(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir).filter((entry) => {
    try {
      return fs.statSync(path.join(dir, entry)).isDirectory();
    } catch {
      return false;
    }
  });
}

function getImagesRecursively(dir) {
  const results = [];

  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);

    try {
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        results.push(...getImagesRecursively(fullPath));
      } else if (stat.isFile() && isImage(entry)) {
        results.push(fullPath);
      }
    } catch {
      console.warn(`[SKIP] Cannot read: ${fullPath}`);
    }
  }

  return results;
}

/**
 * Find a directory case-insensitively.
 */
function findDirectory(parent, name) {
  if (!fs.existsSync(parent)) return null;

  const wanted = String(name).trim().toLowerCase();

  const matches = fs.readdirSync(parent).filter((entry) => {
    const fullPath = path.join(parent, entry);

    try {
      return (
        fs.statSync(fullPath).isDirectory() && entry.toLowerCase() === wanted
      );
    } catch {
      return false;
    }
  });

  if (matches.length === 0) return null;

  if (matches.length > 1) {
    console.warn(
      `[WARNING] Multiple case-insensitive matches for "${name}" in "${parent}": ${matches.join(", ")}`,
    );
  }

  return path.join(parent, matches[0]);
}

function normalizeSize(value) {
  return String(value).trim().toLowerCase().replace(/\*/g, "x");
}

/**
 * Normalize a filename into a stable design-name string.
 *
 * This does not perform fuzzy matching.
 */
function normalizeFileName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove one configured prefix from the START of a design name.
 *
 * Supports multi-word prefixes.
 */
function stripPrefix(value, prefixes = []) {
  let result = normalizeFileName(value);

  const sortedPrefixes = [...prefixes]
    .map(normalizeFileName)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const prefix of sortedPrefixes) {
    if (result === prefix) {
      return "";
    }

    if (result.startsWith(`${prefix} `)) {
      result = result.slice(prefix.length).trim();
      break;
    }
  }

  return result;
}

/**
 * Remove configured tokens or phrases from ANYWHERE in a design name.
 *
 * Matching is case-insensitive and uses whole-token/phrase boundaries.
 * It does not remove a token from inside another word.
 *
 * Example:
 *   "galaxy marble grey" + ["galaxy"] -> "marble grey"
 *   "marble galaxy grey" + ["galaxy"] -> "marble grey"
 */
function removeTokensAnywhere(value, ignoredTokens = []) {
  let result = normalizeFileName(value);

  const tokens = [...ignoredTokens]
    .map(normalizeFileName)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^| )${escaped}(?= |$)`, "g");

    result = result.replace(pattern, "$1");
    result = normalizeFileName(result);
  }

  return result;
}

/**
 * Remove configured tokens or phrases ONLY from the END of a design name.
 *
 * Suffix removal repeats so multiple configured suffixes can be removed.
 * Longer phrases are checked before shorter ones.
 *
 * Example:
 *   "marble grey galaxy" + ["galaxy"] -> "marble grey"
 *   "galaxy marble grey" + ["galaxy"] -> unchanged
 */
function stripConfiguredSuffixes(value, suffixes = []) {
  let result = normalizeFileName(value);

  const sortedSuffixes = [...suffixes]
    .map(normalizeFileName)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let changed = true;

  while (changed && result) {
    changed = false;

    for (const suffix of sortedSuffixes) {
      if (result === suffix) {
        result = "";
        changed = true;
        break;
      }

      if (result.endsWith(` ${suffix}`)) {
        result = result.slice(0, -(suffix.length + 1)).trim();

        changed = true;
        break;
      }
    }
  }

  return result;
}

/**
 * Remove a known face suffix from the END of a filename.
 *
 * Face variants such as F1/F2/F3 can map to the same base design.
 * Supports multi-word configured face suffixes.
 */
function stripFaceSuffix(value, faceSuffixes = []) {
  let result = normalizeFileName(value);

  const suffixes = [...faceSuffixes]
    .map(normalizeFileName)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let changed = true;

  while (changed && result) {
    changed = false;

    for (const suffix of suffixes) {
      // Do not remove the entire design name as a face suffix.
      if (result === suffix) continue;

      if (result.endsWith(` ${suffix}`)) {
        result = result.slice(0, -(suffix.length + 1)).trim();

        changed = true;
        break;
      }
    }
  }

  return result;
}

/**
 * Convert a physical filename into the design key stored in designs.json.
 *
 * Filtering order:
 * 1. Normalize the filename.
 * 2. Remove configured starting prefixes.
 * 3. Remove ignored tokens anywhere in the name.
 * 4. Remove configured ignored suffixes.
 * 5. Remove configured face suffixes.
 */
function getDesignKey(fileName, config) {
  const rawName = path.basename(fileName, path.extname(fileName));

  let designName = normalizeFileName(rawName);

  // Existing behavior: remove configured leading prefixes.
  designName = stripPrefix(designName, config.stripPrefixes || []);

  // FIX 1: Apply ignoreTokensAnywhere during metadata generation.
  designName = removeTokensAnywhere(
    designName,
    config.ignoreTokensAnywhere || [],
  );

  // FIX 2: Apply ignoreTokensSuffixes at the END only.
  designName = stripConfiguredSuffixes(
    designName,
    config.ignoreTokensSuffixes || [],
  );

  // Preserve face-variant handling.
  designName = stripFaceSuffix(designName, config.faceSuffixes || []);

  return normalizeFileName(designName);
}

// =============================================================================
// SURFACE BUILDING
// =============================================================================

function buildSurfaceBucket(surfacePath, config) {
  const bucket = {};
  const files = getImagesRecursively(surfacePath);

  for (const filePath of files) {
    const designKey = getDesignKey(filePath, config);

    if (!designKey) {
      console.warn(`[SKIP] Could not determine design name: ${filePath}`);
      continue;
    }

    // IMPORTANT:
    // Multiple files that normalize to the same key must be retained.
    if (!bucket[designKey]) {
      bucket[designKey] = [];
    }

    bucket[designKey].push(filePath);
  }

  // Stable output makes designs.json easier to inspect and debug.
  for (const designName of Object.keys(bucket)) {
    bucket[designName].sort();
  }

  return bucket;
}

// =============================================================================
// VALIDATION
// =============================================================================

function validateSurfaceNames(
  factoryName,
  config,
  actualDirectories,
  sizePath,
) {
  const configuredSurfaces = Object.keys(config.surfaces || {});

  const configuredLower = new Set(
    configuredSurfaces.map((name) => name.toLowerCase()),
  );

  for (const directory of actualDirectories) {
    if (!configuredLower.has(directory.toLowerCase())) {
      console.warn(
        `[UNCONFIGURED SURFACE] ${factoryName}/${path.basename(sizePath)}/${directory}`,
      );
    }
  }
}

// =============================================================================
// FACTORY BUILD
// =============================================================================

function buildFactoryMetadata(factoryName, config, factoryPath) {
  const factoryMetadata = {};
  const typeDirectories = getDirectories(factoryPath);

  for (const typeDirectory of typeDirectories) {
    const typeKey = typeDirectory.toLowerCase();

    // Only catalogue known image types.
    if (typeKey !== "jpg" && typeKey !== "live") {
      console.warn(
        `[UNCONFIGURED TYPE] ${factoryName}/${typeDirectory} — skipped`,
      );
      continue;
    }

    const typePath = path.join(factoryPath, typeDirectory);
    const sizeDirectories = getDirectories(typePath);

    if (sizeDirectories.length === 0) continue;

    factoryMetadata[typeKey] = {};

    for (const sizeDirectory of sizeDirectories) {
      const sizeKey = normalizeSize(sizeDirectory);
      const sizePath = path.join(typePath, sizeDirectory);
      const surfaceDirectories = getDirectories(sizePath);

      validateSurfaceNames(factoryName, config, surfaceDirectories, sizePath);

      const surfaces = {};

      for (const surfaceKey of Object.keys(config.surfaces || {})) {
        const surfacePath = findDirectory(sizePath, surfaceKey);

        if (!surfacePath) continue;

        const bucket = buildSurfaceBucket(surfacePath, config);

        if (Object.keys(bucket).length === 0) {
          console.warn(
            `[EMPTY SURFACE] ${factoryName}/${typeKey}/${sizeKey}/${surfaceKey}`,
          );
          continue;
        }

        surfaces[surfaceKey] = bucket;
      }

      if (Object.keys(surfaces).length > 0) {
        factoryMetadata[typeKey][sizeKey] = surfaces;
      }
    }

    if (Object.keys(factoryMetadata[typeKey]).length === 0) {
      delete factoryMetadata[typeKey];
    }
  }

  return factoryMetadata;
}

// =============================================================================
// FULL METADATA BUILD
// =============================================================================

function buildMetadata() {
  const result = {};

  for (const [factoryName, config] of Object.entries(factoryConfig)) {
    const factoryPath = findDirectory(IMAGES_ROOT, factoryName);

    if (!factoryPath) {
      console.warn(`[MISSING FACTORY] "${factoryName}" — folder not found`);
      continue;
    }

    console.log(`\n[FACTORY] ${factoryName}`);

    const factoryMetadata = buildFactoryMetadata(
      factoryName,
      config,
      factoryPath,
    );

    if (Object.keys(factoryMetadata).length === 0) {
      console.warn(`[EMPTY FACTORY] "${factoryName}" has no catalogue data`);
      continue;
    }

    result[factoryName] = factoryMetadata;
  }

  return result;
}

// =============================================================================
// VALIDATION OF GENERATED CATALOGUE
// =============================================================================

function validateGeneratedMetadata(metadata) {
  let factoryCount = 0;
  let typeCount = 0;
  let sizeCount = 0;
  let surfaceCount = 0;
  let designCount = 0;
  let imageCount = 0;

  const normalizedCollisions = [];

  for (const [factory, types] of Object.entries(metadata)) {
    factoryCount++;

    for (const [type, sizes] of Object.entries(types)) {
      typeCount++;

      for (const [size, surfaces] of Object.entries(sizes)) {
        sizeCount++;

        for (const [surface, designs] of Object.entries(surfaces)) {
          surfaceCount++;

          const normalizedNames = new Map();

          for (const [designName, images] of Object.entries(designs)) {
            designCount++;
            imageCount += images.length;

            const normalized = designName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, " ")
              .replace(/\s+/g, " ")
              .trim();

            if (normalizedNames.has(normalized)) {
              normalizedCollisions.push({
                factory,
                type,
                size,
                surface,
                normalized,
                names: [normalizedNames.get(normalized), designName],
              });
            } else {
              normalizedNames.set(normalized, designName);
            }
          }
        }
      }
    }
  }

  console.log("\n==============================================");
  console.log("CATALOGUE SUMMARY");
  console.log("==============================================");
  console.log(`Factories : ${factoryCount}`);
  console.log(`Types     : ${typeCount}`);
  console.log(`Sizes     : ${sizeCount}`);
  console.log(`Surfaces  : ${surfaceCount}`);
  console.log(`Designs   : ${designCount}`);
  console.log(`Images    : ${imageCount}`);

  if (normalizedCollisions.length > 0) {
    console.log("\n==============================================");
    console.log("NORMALIZATION COLLISIONS");
    console.log("==============================================");

    for (const collision of normalizedCollisions) {
      console.warn(
        `[COLLISION] ${collision.factory}/${collision.type}/${collision.size}/${collision.surface}`,
      );

      console.warn(`  "${collision.names[0]}" <-> "${collision.names[1]}"`);
    }

    console.warn(
      `\nFound ${normalizedCollisions.length} normalization collision(s).`,
    );
    console.warn("Review these before relying on fuzzy design matching.");
  } else {
    console.log("\n[VALIDATION] No normalization collisions found.");
  }

  return { normalizedCollisions };
}

// =============================================================================
// WRITE FILE
// =============================================================================

function writeMetadata(metadata) {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), {
    recursive: true,
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(metadata, null, 2), "utf8");
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  console.log("==============================================");
  console.log("BUILDING DESIGNS CATALOGUE");
  console.log("==============================================");
  console.log(`Platform : ${PLATFORM}`);
  console.log(`Source   : ${IMAGES_ROOT}`);
  console.log(`Output   : ${OUTPUT_FILE}`);
  console.log("==============================================\n");

  if (!fs.existsSync(IMAGES_ROOT)) {
    throw new Error(`Images root does not exist: ${IMAGES_ROOT}`);
  }

  const metadata = buildMetadata();
  const validation = validateGeneratedMetadata(metadata);

  writeMetadata(metadata);

  console.log("\n==============================================");
  console.log("CATALOGUE GENERATED");
  console.log("==============================================");
  console.log(`Saved: ${OUTPUT_FILE}`);

  if (validation.normalizedCollisions.length > 0) {
    console.log("\nCatalogue generated with warnings.");
    console.log("Review normalization collisions above.");
  } else {
    console.log("\nCatalogue validation passed.");
  }

  console.log("==============================================\n");
}

main();

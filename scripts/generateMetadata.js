const fs = require("fs");
const path = require("path");
const { factoryConfig } = require("../config/factoryConfig");
require("dotenv").config();
const { execFileSync } = require("child_process");

// fs.writeFileSync(outputPath, JSON.stringify(metadata, null, 2), "utf8");

// =============================================================================
// CONFIG
// =============================================================================
//
// Change only PLATFORM when moving between Windows and Linux.
//
// generateMetadata.js is the catalogue compiler:
//
//     physical image folders
//              ↓
//     generateMetadata.js
//              ↓
//         designs.json
//
// designs.json is the runtime source of truth.
// =============================================================================

const PLATFORM = "windows";

const PATHS = {
  windows: {
    imagesRoot: "D:\\Catalogue\\images",
    outputFile: path.join(__dirname, "../data/designs.json"),
  },

  linux: {
    imagesRoot: "/home/ayan/project/images",
    outputFile: "/home/ayan/project/whatsapp-bot/data/designs.json",
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
    const fullPath = path.join(dir, entry);

    try {
      return fs.statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  });
}

function getImagesRecursively(dir) {
  const results = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);

    try {
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        results.push(...getImagesRecursively(fullPath));
        continue;
      }

      if (stat.isFile() && isImage(entry)) {
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
 *
 * Example:
 *
 *   Config says "matt"
 *   Folder is "MATT"
 *
 * Both are accepted.
 */
function findDirectory(parent, name) {
  if (!fs.existsSync(parent)) {
    return null;
  }

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

  if (matches.length === 0) {
    return null;
  }

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
 * Normalize only the filesystem design key.
 *
 * IMPORTANT:
 * This function does NOT perform fuzzy matching.
 * It only converts the physical filename into a stable catalogue key.
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
 * Remove a known prefix from the beginning of a design filename.
 *
 * Example:
 *
 *   "IC Diamond Blue"
 *       ↓
 *   "Diamond Blue"
 */
function stripPrefix(value, prefixes) {
  let result = normalizeFileName(value);

  for (const prefix of prefixes || []) {
    const normalizedPrefix = normalizeFileName(prefix);

    if (!normalizedPrefix) continue;

    if (
      result === normalizedPrefix ||
      result.startsWith(`${normalizedPrefix} `)
    ) {
      result = result.slice(normalizedPrefix.length).trim();

      break;
    }
  }

  return result;
}

/**
 * Remove a known face suffix from the END of a filename.
 *
 * Face suffixes are different image faces of the same design.
 *
 * Example:
 *
 *   "4085 F1"
 *   "4085 F2"
 *   "4085 F3"
 *
 * all become:
 *
 *   "4085"
 */
function stripFaceSuffix(value, faceSuffixes) {
  let result = normalizeFileName(value);

  const suffixes = [...(faceSuffixes || [])]
    .map(normalizeFileName)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const suffix of suffixes) {
    if (result === suffix) {
      return result;
    }

    if (result.endsWith(` ${suffix}`)) {
      result = result.slice(0, -(suffix.length + 1)).trim();

      break;
    }
  }

  return result;
}

/**
 * Convert a physical filename into the design key stored in designs.json.
 */
function getDesignKey(fileName, config) {
  const rawName = path.basename(fileName, path.extname(fileName));

  let designName = normalizeFileName(rawName);

  designName = stripPrefix(designName, config.stripPrefixes || []);

  designName = stripFaceSuffix(designName, config.faceSuffixes || []);

  return designName.trim();
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

    if (!bucket[designKey]) {
      bucket[designKey] = [];
    }

    bucket[designKey].push(filePath);
  }

  // Stable output makes designs.json easier to inspect,
  // compare and debug.
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

  const knownDirectories = new Set(
    actualDirectories.map((name) => name.toLowerCase()),
  );

  for (const surfaceName of configuredSurfaces) {
    if (!knownDirectories.has(surfaceName.toLowerCase())) {
      continue;
    }
  }

  // Report folders that exist physically but are not configured.
  //
  // We DO NOT automatically add them because factoryConfig is the
  // authoritative definition of valid surfaces.
  const configuredLower = new Set(
    configuredSurfaces.map((s) => s.toLowerCase()),
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

    if (sizeDirectories.length === 0) {
      continue;
    }

    factoryMetadata[typeKey] = {};

    for (const sizeDirectory of sizeDirectories) {
      const sizeKey = normalizeSize(sizeDirectory);

      const sizePath = path.join(typePath, sizeDirectory);

      const surfaceDirectories = getDirectories(sizePath);

      validateSurfaceNames(factoryName, config, surfaceDirectories, sizePath);

      const surfaces = {};

      for (const surfaceKey of Object.keys(config.surfaces || {})) {
        const surfacePath = findDirectory(sizePath, surfaceKey);

        if (!surfacePath) {
          continue;
        }

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

  return {
    normalizedCollisions,
  };
}

// =============================================================================
// WRITE FILE
// =============================================================================

function writeMetadata(metadata) {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

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
    console.log("\n⚠️  Catalogue generated with warnings.");
    console.log("Review normalization collisions above.");
  } else {
    console.log("\n✅ Catalogue validation passed.");
  }

  console.log("==============================================\n");
}

main();

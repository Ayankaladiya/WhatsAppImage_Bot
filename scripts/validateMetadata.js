const fs = require("fs");
const path = require("path");

// =============================================================================
// CONFIG
// =============================================================================

const PROJECT_ROOT = path.resolve(__dirname, "..");

const METADATA_PATH = path.join(PROJECT_ROOT, "data", "designs.json");

// =============================================================================
// HELPERS
// =============================================================================

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addError(errors, message) {
  errors.push(`❌ ${message}`);
}

function addWarning(warnings, message) {
  warnings.push(`⚠️ ${message}`);
}

// =============================================================================
// LOAD METADATA
// =============================================================================

function loadMetadata() {
  if (!fs.existsSync(METADATA_PATH)) {
    throw new Error(`Metadata file not found: ${METADATA_PATH}`);
  }

  const raw = fs.readFileSync(METADATA_PATH, "utf8");

  if (!raw.trim()) {
    throw new Error("Metadata file is empty.");
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }
}

// =============================================================================
// VALIDATE PATH
// =============================================================================

function validateFilePath(filePath, errors, location) {
  if (!isNonEmptyString(filePath)) {
    addError(errors, `${location}: file path is missing.`);

    return;
  }

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(PROJECT_ROOT, filePath);

  if (!fs.existsSync(absolutePath)) {
    addError(errors, `${location}: file does not exist: ${filePath}`);
  }
}

// =============================================================================
// VALIDATE DESIGN ENTRY
// =============================================================================

function validateDesignEntry(entry, errors, warnings, location, stats) {
  stats.designEntries++;

  if (!isObject(entry)) {
    addError(errors, `${location}: design entry is not an object.`);

    return;
  }

  // ---------------------------------------------------------------------------
  // Normalized name
  // ---------------------------------------------------------------------------

  if (!isNonEmptyString(entry.normalized)) {
    addError(errors, `${location}: missing normalized design name.`);
  }

  // ---------------------------------------------------------------------------
  // Display/original name
  // ---------------------------------------------------------------------------

  if (entry.name !== undefined && !isNonEmptyString(entry.name)) {
    addWarning(warnings, `${location}: design name is empty.`);
  }

  // ---------------------------------------------------------------------------
  // JPG
  // ---------------------------------------------------------------------------

  if (entry.jpg) {
    stats.jpgFiles++;

    validateFilePath(entry.jpg, errors, `${location}.jpg`);
  }

  // ---------------------------------------------------------------------------
  // LIVE
  // ---------------------------------------------------------------------------

  if (entry.live) {
    stats.liveFiles++;

    validateFilePath(entry.live, errors, `${location}.live`);
  }

  // ---------------------------------------------------------------------------
  // Variants
  // ---------------------------------------------------------------------------

  if (entry.variants !== undefined) {
    if (!Array.isArray(entry.variants)) {
      addError(errors, `${location}.variants must be an array.`);
    } else {
      stats.variantEntries += entry.variants.length;

      for (let i = 0; i < entry.variants.length; i++) {
        const variant = entry.variants[i];

        if (!isObject(variant)) {
          addError(errors, `${location}.variants[${i}] is not an object.`);

          continue;
        }

        if (variant.jpg) {
          stats.jpgFiles++;

          validateFilePath(
            variant.jpg,
            errors,
            `${location}.variants[${i}].jpg`,
          );
        }

        if (variant.live) {
          stats.liveFiles++;

          validateFilePath(
            variant.live,
            errors,
            `${location}.variants[${i}].live`,
          );
        }
      }
    }
  }
}

// =============================================================================
// WALK METADATA
// =============================================================================

function walkMetadata(node, errors, warnings, location, stats, seenDesigns) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walkMetadata(
        node[i],
        errors,
        warnings,
        `${location}[${i}]`,
        stats,
        seenDesigns,
      );
    }

    return;
  }

  if (!isObject(node)) {
    return;
  }

  // ---------------------------------------------------------------------------
  // Detect a design entry.
  //
  // Your generated metadata uses "normalized" as the important design-level
  // identifier.
  // ---------------------------------------------------------------------------

  if (isNonEmptyString(node.normalized)) {
    validateDesignEntry(node, errors, warnings, location, stats);

    const normalized = normalize(node.normalized);

    if (seenDesigns.has(normalized)) {
      stats.duplicateDesignNames++;

      addWarning(
        warnings,
        `${location}: duplicate normalized design name "${node.normalized}".`,
      );
    } else {
      seenDesigns.add(normalized);
    }

    return;
  }

  // ---------------------------------------------------------------------------
  // Continue walking nested metadata.
  // ---------------------------------------------------------------------------

  for (const [key, value] of Object.entries(node)) {
    walkMetadata(
      value,
      errors,
      warnings,
      `${location}.${key}`,
      stats,
      seenDesigns,
    );
  }
}

// =============================================================================
// VALIDATE ROOT
// =============================================================================

function validateRoot(metadata, errors) {
  if (metadata === null || metadata === undefined) {
    addError(errors, "Metadata root is empty.");

    return;
  }

  if (typeof metadata !== "object") {
    addError(errors, "Metadata root must be an object or array.");
  }
}

// =============================================================================
// MAIN
// =============================================================================

function validateMetadata() {
  console.log("");
  console.log("==================================================");
  console.log(" METADATA VALIDATION");
  console.log("==================================================");
  console.log("");
  console.log(`File: ${METADATA_PATH}`);
  console.log("");

  const errors = [];
  const warnings = [];

  const stats = {
    designEntries: 0,
    variantEntries: 0,
    jpgFiles: 0,
    liveFiles: 0,
    duplicateDesignNames: 0,
  };

  let metadata;

  try {
    metadata = loadMetadata();
  } catch (error) {
    console.error(`❌ ${error.message}`);

    process.exitCode = 1;

    return;
  }

  validateRoot(metadata, errors);

  if (errors.length === 0) {
    walkMetadata(metadata, errors, warnings, "designs", stats, new Set());
  }

  // ===========================================================================
  // RESULT
  // ===========================================================================

  console.log("--------------------------------------------------");
  console.log("SUMMARY");
  console.log("--------------------------------------------------");

  console.log(`Design entries : ${stats.designEntries}`);

  console.log(`Variants       : ${stats.variantEntries}`);

  console.log(`JPG files      : ${stats.jpgFiles}`);

  console.log(`LIVE files     : ${stats.liveFiles}`);

  console.log(`Duplicate names: ${stats.duplicateDesignNames}`);

  console.log("");

  if (warnings.length > 0) {
    console.log("WARNINGS");
    console.log("--------");

    for (const warning of warnings) {
      console.log(warning);
    }

    console.log("");
  }

  if (errors.length > 0) {
    console.log("ERRORS");
    console.log("------");

    for (const error of errors) {
      console.log(error);
    }

    console.log("");

    console.log(
      `❌ Metadata validation FAILED with ${errors.length} error(s).`,
    );

    process.exitCode = 1;

    return;
  }

  console.log("✅ Metadata validation PASSED.");

  console.log("");
}

// =============================================================================
// RUN
// =============================================================================

validateMetadata();

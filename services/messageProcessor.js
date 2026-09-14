const fs = require("fs");
const path = require("path");

const { parseMessage } = require("../utils/parser");

const {
  uploadMedia,
  sendImage,
  sendDocument,
  sendText,
} = require("./whatsapp");

const { randomDelay } = require("../utils/delay");

const {
  factoryConfig,
  resolveFactory,
  getSurfaceLookup,
  getFilterOptions,
} = require("../config/factoryConfig");

const { userHasFactoryAccess } = require("../config/users");

const { getFactory } = require("../utils/metadata");

const { getIndexForBucket, searchIndex } = require("../utils/designIndex");

const { matchDesignName } = require("./openai");

const {
  getCachedCorrection,
  rememberCorrection,
} = require("../utils/correctionCache");

const { getLockedSurfaces } = require("../utils/seriesIndex");

// =============================================================================
// CONFIG
// =============================================================================

const MAX_FACES = 8;
const MAX_TOTAL = 100;

const TYPE_ORDER = ["jpg", "live"];

// =============================================================================
// MAIN MESSAGE PROCESSOR
// =============================================================================

async function processMessage(from, text) {
  console.log("\n============================================================");
  console.log(`[MSG] From: ${from}`);
  console.log(`[MSG] Text: ${JSON.stringify(text)}`);
  console.log("============================================================");

  try {
    // =========================================================================
    // 1. PARSE
    // =========================================================================

    const parsed = parseMessage(text);

    if (!parsed) {
      console.log("[PARSE] ❌ Invalid message");

      await sendText(
        from,
        [
          "Invalid format.",
          "",
          "Use:",
          "<factory> [size]",
          "<surface>",
          "<design name>",
        ].join("\n"),
      );

      return;
    }

    console.log("[PARSE] ✅ Message parsed");
    console.log(`  Factory: "${parsed.factory}"`);
    console.log(`  Size: "${parsed.size || "(automatic)"}"`);

    // =========================================================================
    // 2. FACTORY
    // =========================================================================

    const factory = resolveFactory(parsed.factory);

    if (!factory) {
      console.log(`[FACTORY] ❌ "${parsed.factory}" not found`);

      await sendText(from, `Factory not found: "${parsed.factory}"`);

      return;
    }

    console.log(`[FACTORY] ✅ "${parsed.factory}" → "${factory}"`);

    // =========================================================================
    // 3. ACCESS
    // =========================================================================

    if (!userHasFactoryAccess(from, factory)) {
      console.log(`[ACCESS] ❌ User not authorized for "${factory}"`);

      await sendText(
        from,
        `You are not authorized to request images from ${factory}.`,
      );

      return;
    }

    console.log(`[ACCESS] ✅ User authorized for "${factory}"`);

    // =========================================================================
    // 4. FACTORY CONFIG
    // =========================================================================

    const factoryOptions = factoryConfig[factory];

    if (!factoryOptions) {
      console.log(`[CONFIG] ❌ Configuration missing for "${factory}"`);

      await sendText(from, `Factory configuration missing for "${factory}".`);

      return;
    }

    console.log(
      `[CONFIG] sizeRequired=${factoryOptions.sizeRequired} | ` +
        `surfaceRequired=${factoryOptions.surfaceRequired}`,
    );

    // =========================================================================
    // 5. LOAD METADATA
    // =========================================================================

    const factoryMeta = getFactory(factory);

    if (!factoryMeta) {
      console.log(`[METADATA] ❌ Factory "${factory}" missing`);

      await sendText(from, `Factory data missing for "${factory}".`);

      return;
    }

    const typeBuckets = factoryMeta.types || {};

    const availableTypes = Object.keys(typeBuckets);

    if (availableTypes.length === 0) {
      console.log(`[METADATA] ❌ No image types for "${factory}"`);

      await sendText(from, `No image types available for ${factory}.`);

      return;
    }

    console.log(`[TYPES] ${availableTypes.join(", ")}`);

    // =========================================================================
    // 6. RESOLVE SIZE
    // =========================================================================

    const sizeResult = resolveSizes(typeBuckets, parsed.size, factoryOptions);

    if (sizeResult.error) {
      console.log(`[SIZE] ❌ ${sizeResult.error}`);

      await sendText(from, sizeResult.error);

      return;
    }

    const selectedSizes = sizeResult.sizes;

    console.log(`[SIZE] Searching: ${selectedSizes.join(", ")}`);

    // =========================================================================
    // 7. PARSE SURFACE + DESIGN BLOCKS
    // =========================================================================

    const blocks = parseDesignBlocks(parsed.lines || [], factory);

    if (!blocks.length) {
      await sendText(from, "Please add a surface and design name.");

      return;
    }

    console.log(`[BLOCKS] ${JSON.stringify(blocks)}`);

    // =========================================================================
    // 8. RESOLVE SURFACES
    // =========================================================================

    const surfaceResult = resolveSurfaceBlocks(
      blocks,
      typeBuckets,
      selectedSizes,
      factoryOptions,
    );

    if (surfaceResult.error) {
      console.log(`[SURFACE] ❌ ${surfaceResult.error}`);

      await sendText(from, surfaceResult.error);

      return;
    }

    // =========================================================================
    // 9. PROCESS EACH SURFACE/DESIGN BLOCK
    // =========================================================================

    let totalSent = 0;

    const sentFilePaths = new Set();

    const foundDesigns = [];
    const missingDesigns = [];

    for (const block of surfaceResult.blocks) {
      for (const designInput of block.designs) {
        // ---------------------------------------------------------------------
        // Global limit
        // ---------------------------------------------------------------------

        if (totalSent >= MAX_TOTAL) {
          console.log(`[LIMIT] MAX_TOTAL=${MAX_TOTAL} reached`);

          break;
        }

        console.log(
          "\n------------------------------------------------------------",
        );

        console.log(`[DESIGN] Processing "${designInput}"`);

        console.log(`[DESIGN] Surface: ${block.surface || "ALL"}`);

        console.log(
          "------------------------------------------------------------",
        );

        // ---------------------------------------------------------------------
        // FIND DESIGN
        // ---------------------------------------------------------------------

        const matches = await findDesign({
          designInput,
          factory,
          sizes: selectedSizes,
          surface: block.surface,
          typeBuckets,
          typeOrder: TYPE_ORDER,
          filters: getFilterOptions(factory),
        });

        if (!matches || matches.length === 0) {
          console.log(`[DESIGN] ❌ No match: "${designInput}"`);

          missingDesigns.push(designInput);

          continue;
        }

        // ---------------------------------------------------------------------
        // Determine resolved logical design name
        // ---------------------------------------------------------------------

        const matchedDesign = matches[0]?.normalized || designInput;

        console.log(`[DESIGN] ✅ "${designInput}" → "${matchedDesign}"`);

        // ---------------------------------------------------------------------
        // Collect ALL JPG/LIVE files
        // ---------------------------------------------------------------------

        const jpgFiles = [];
        const liveFiles = [];

        for (const match of matches) {
          for (const image of match.images || []) {
            if (!image) {
              continue;
            }

            if (match.type === "jpg") {
              jpgFiles.push(image);
            }

            if (match.type === "live") {
              liveFiles.push(image);
            }
          }
        }

        // ---------------------------------------------------------------------
        // Deduplicate physical paths
        // ---------------------------------------------------------------------

        const designFiles = [
          ...[...new Set(jpgFiles)].map((filePath) => ({
            filePath,
            type: "jpg",
          })),

          ...[...new Set(liveFiles)].map((filePath) => ({
            filePath,
            type: "live",
          })),
        ];

        // ---------------------------------------------------------------------
        // Remove files already sent for another design
        // ---------------------------------------------------------------------

        const availableFiles = designFiles.filter(
          (file) => !sentFilePaths.has(file.filePath),
        );

        if (availableFiles.length === 0) {
          console.log(
            `[DESIGN] ⚠️ "${matchedDesign}" matched but all files were already sent`,
          );

          continue;
        }

        // ---------------------------------------------------------------------
        // Per-design limit
        // ---------------------------------------------------------------------

        const remainingGlobal = MAX_TOTAL - totalSent;

        const filesForThisDesign = availableFiles.slice(
          0,
          Math.min(MAX_FACES, remainingGlobal),
        );

        let designSent = 0;

        // ---------------------------------------------------------------------
        // SEND
        // ---------------------------------------------------------------------

        for (const file of filesForThisDesign) {
          if (totalSent >= MAX_TOTAL) {
            break;
          }

          const sent = await sendFiles(
            from,
            [file.filePath],
            file.type,
            totalSent,
          );

          if (sent > 0) {
            sentFilePaths.add(file.filePath);

            designSent += sent;
            totalSent += sent;
          }
        }

        // ---------------------------------------------------------------------
        // Record result
        // ---------------------------------------------------------------------

        if (designSent > 0) {
          foundDesigns.push({
            requested: designInput,

            matched: matchedDesign,

            sent: designSent,
          });
        } else {
          missingDesigns.push(designInput);
        }
      }

      if (totalSent >= MAX_TOTAL) {
        break;
      }
    }

    // =========================================================================
    // 10. FINAL RESPONSE
    // =========================================================================

    const responseLines = [];

    if (foundDesigns.length > 0) {
      responseLines.push("Found:");

      for (const item of foundDesigns) {
        responseLines.push(
          `✓ ${item.requested} → ${item.matched} (${item.sent} image${item.sent === 1 ? "" : "s"})`,
        );
      }
    }

    if (missingDesigns.length > 0) {
      if (responseLines.length > 0) {
        responseLines.push("");
      }

      responseLines.push("Not found:");

      for (const design of missingDesigns) {
        responseLines.push(`✗ ${design}`);
      }
    }

    if (totalSent >= MAX_TOTAL) {
      responseLines.push("");
      responseLines.push(`Delivery limit reached (${MAX_TOTAL}).`);
    }

    if (responseLines.length === 0) {
      responseLines.push("No matching designs were found.");
    }

    await sendText(from, responseLines.join("\n"));

    console.log(
      "\n============================================================",
    );

    console.log(`[MESSAGE] Complete | totalSent=${totalSent}`);

    console.log("============================================================");
  } catch (error) {
    console.error("[PROCESS MESSAGE ERROR]", error);

    try {
      await sendText(
        from,
        "Something went wrong while processing your request.",
      );
    } catch (sendError) {
      console.error("[ERROR MESSAGE SEND FAILED]", sendError);
    }
  }
}

// =============================================================================
// SIZE RESOLUTION
// =============================================================================

function resolveSizes(typeBuckets, requestedSize, factoryOptions = {}) {
  const allSizes = new Set();

  for (const typeBucket of Object.values(typeBuckets)) {
    if (!typeBucket) {
      continue;
    }

    for (const size of Object.keys(typeBucket)) {
      allSizes.add(size);
    }
  }

  const availableSizes = Array.from(allSizes);

  if (availableSizes.length === 0) {
    return {
      error: "No sizes available for this factory.",
    };
  }

  // ===========================================================================
  // Explicit size
  // ===========================================================================

  if (requestedSize) {
    const normalizedRequested = normalizeSize(
      requestedSize,
      factoryOptions.sizeAliases || {},
    );

    const actualSize = availableSizes.find(
      (size) =>
        normalizeSize(size, factoryOptions.sizeAliases || {}) ===
        normalizedRequested,
    );

    if (!actualSize) {
      const displaySizes =
        Array.isArray(factoryOptions.sizes) && factoryOptions.sizes.length > 0
          ? factoryOptions.sizes
          : availableSizes;

      return {
        error:
          `Size "${requestedSize}" not available. ` +
          `Available: ${displaySizes.join(", ")}`,
      };
    }

    return {
      sizes: [actualSize],
    };
  }

  // ===========================================================================
  // Size not supplied
  // ===========================================================================

  if (factoryOptions.sizeRequired) {
    if (availableSizes.length === 1) {
      return {
        sizes: [availableSizes[0]],
      };
    }

    const displaySizes =
      Array.isArray(factoryOptions.sizes) && factoryOptions.sizes.length > 0
        ? factoryOptions.sizes
        : availableSizes;

    return {
      error: `Size is required. ` + `Available: ${displaySizes.join(", ")}`,
    };
  }

  // ===========================================================================
  // Optional size
  //
  // Search ALL sizes.
  // ===========================================================================

  return {
    sizes: availableSizes,
  };
}

// =============================================================================
// SIZE NORMALIZATION
// =============================================================================

function normalizeSize(value, aliasMap = {}) {
  const lower = String(value || "")
    .toLowerCase()
    .replace(/\*/g, "x")
    .trim();

  return aliasMap[lower] || lower;
}

// =============================================================================
// SURFACE / DESIGN BLOCK PARSING
// =============================================================================

function parseDesignBlocks(lines, factoryName) {
  const surfaceLookup = getSurfaceLookup(factoryName);

  const blocks = [];

  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const surfaceKey = surfaceLookup.get(trimmed.toLowerCase());

    if (surfaceKey) {
      current = {
        surface: surfaceKey,

        designs: [],
      };

      blocks.push(current);

      continue;
    }

    // -------------------------------------------------------------------------
    // If no surface has been specified yet, design belongs to ALL surfaces.
    // -------------------------------------------------------------------------

    if (!current) {
      current = {
        surface: null,
        designs: [],
      };

      blocks.push(current);
    }

    current.designs.push(trimmed);
  }

  return blocks.filter((block) => block.designs.length > 0);
}

// =============================================================================
// SURFACE RESOLUTION
// =============================================================================

function resolveSurfaceBlocks(blocks, typeBuckets, sizes, factoryOptions = {}) {
  const availableSurfaces = getAvailableSurfaces(typeBuckets, sizes);

  if (availableSurfaces.length === 0) {
    return {
      error: "No surfaces found for the selected size(s).",
    };
  }

  const resolved = [];

  for (const block of blocks) {
    // -------------------------------------------------------------------------
    // Explicit surface
    // -------------------------------------------------------------------------

    if (block.surface) {
      if (!availableSurfaces.includes(block.surface)) {
        return {
          error:
            `Surface "${block.surface}" not found. ` +
            `Available: ${availableSurfaces.join(", ")}`,
        };
      }

      resolved.push({
        surface: block.surface,

        designs: block.designs,
      });

      continue;
    }

    // -------------------------------------------------------------------------
    // Surface required
    // -------------------------------------------------------------------------

    if (factoryOptions.surfaceRequired) {
      if (availableSurfaces.length === 1) {
        resolved.push({
          surface: availableSurfaces[0],

          designs: block.designs,
        });

        console.log(
          `[SURFACE] Only one surface exists → "${availableSurfaces[0]}"`,
        );

        continue;
      }

      return {
        error:
          `Please specify a surface. ` +
          `Available: ${availableSurfaces.join(", ")}`,
      };
    }

    // -------------------------------------------------------------------------
    // Surface optional
    //
    // null intentionally means ALL surfaces.
    // -------------------------------------------------------------------------

    resolved.push({
      surface: null,
      designs: block.designs,
    });

    console.log(`[SURFACE] Optional surface → searching ALL surfaces`);
  }

  return {
    blocks: resolved,
  };
}

// =============================================================================
// AVAILABLE SURFACES
// =============================================================================

function getAvailableSurfaces(typeBuckets, sizes) {
  const surfaces = new Set();

  for (const typeBucket of Object.values(typeBuckets)) {
    if (!typeBucket) {
      continue;
    }

    for (const size of sizes) {
      const sizeBucket = typeBucket[size];

      if (!sizeBucket) {
        continue;
      }

      for (const surface of Object.keys(sizeBucket)) {
        surfaces.add(surface);
      }
    }
  }

  return Array.from(surfaces);
}

// =============================================================================
// DESIGN MATCHING
// =============================================================================

async function findDesign({
  designInput,
  factory,
  sizes,
  surface,
  typeBuckets,
  typeOrder,
  filters,
}) {
  const trimmedInput = String(designInput || "").trim();

  if (!trimmedInput) {
    return [];
  }

  const isNumeric = /^\d+$/.test(trimmedInput);

  const configSurfaceOrder = Object.keys(
    factoryConfig[factory]?.surfaces || {},
  );

  const candidateRecords = [];

  // ===========================================================================
  // 1. BUILD SEARCH UNIVERSE
  // ===========================================================================

  for (const typeKey of typeOrder) {
    const typeBucket = typeBuckets[typeKey];

    if (!typeBucket) {
      continue;
    }

    for (const size of sizes) {
      const sizeBucket = typeBucket[size];

      if (!sizeBucket) {
        continue;
      }

      let surfacesToSearch;

      if (surface) {
        surfacesToSearch = [surface];
      } else {
        const actualSurfaces = Object.keys(sizeBucket);

        const lockedSurfaces = getLockedSurfaces(
          factory,
          trimmedInput,
          typeKey,
        );

        if (Array.isArray(lockedSurfaces) && lockedSurfaces.length > 0) {
          surfacesToSearch = [
            ...lockedSurfaces.filter((s) => actualSurfaces.includes(s)),

            ...configSurfaceOrder.filter(
              (s) => actualSurfaces.includes(s) && !lockedSurfaces.includes(s),
            ),

            ...actualSurfaces.filter(
              (s) =>
                !lockedSurfaces.includes(s) && !configSurfaceOrder.includes(s),
            ),
          ];
        } else {
          surfacesToSearch = [
            ...configSurfaceOrder.filter((s) => actualSurfaces.includes(s)),

            ...actualSurfaces.filter((s) => !configSurfaceOrder.includes(s)),
          ];
        }
      }

      // -----------------------------------------------------------------------
      // Search surfaces
      // -----------------------------------------------------------------------

      for (const surfaceKey of surfacesToSearch) {
        const bucket = sizeBucket[surfaceKey];

        if (!bucket) {
          continue;
        }

        const index = getIndexForBucket(
          factory,
          typeKey,
          size,
          surfaceKey,
          bucket,
          filters,
        );

        if (
          !index ||
          !Array.isArray(index.entries) ||
          index.entries.length === 0
        ) {
          continue;
        }

        // =====================================================================
        // NUMERIC
        // =====================================================================

        if (isNumeric) {
          const entry = index.numericMap?.get(trimmedInput);

          if (entry) {
            candidateRecords.push({
              type: typeKey,

              size,

              surface: surfaceKey,

              entry,
            });
          }

          continue;
        }

        // =====================================================================
        // EXACT NORMALIZED
        // =====================================================================

        const normalizedInput = normalizeLookup(trimmedInput);

        const exact = index.normalizedMap?.get(normalizedInput);

        if (exact) {
          candidateRecords.push({
            type: typeKey,

            size,

            surface: surfaceKey,

            entry: exact,
          });

          continue;
        }

        // =====================================================================
        // LOCAL FUZZY RETRIEVAL
        // =====================================================================

        const localCandidates = searchIndex(index, trimmedInput, 30);

        for (const result of localCandidates) {
          const entry = result.entry;

          if (!entry?.normalized) {
            continue;
          }

          candidateRecords.push({
            type: typeKey,

            size,

            surface: surfaceKey,

            entry,

            score: result.score,
          });
        }
      }
    }
  }

  // ===========================================================================
  // 2. NO CANDIDATES
  // ===========================================================================

  if (candidateRecords.length === 0) {
    console.log(`[SEARCH] No candidates for "${trimmedInput}"`);

    return [];
  }

  // ===========================================================================
  // 3. NUMERIC RESULT
  // ===========================================================================

  if (isNumeric) {
    const matches = candidateRecords
      .filter((record) => record.entry?.allImages?.length > 0)
      .map((record) => ({
        type: record.type,

        size: record.size,

        surface: record.surface,

        images: record.entry.allImages,

        normalized: record.entry.normalized,
      }));

    return deduplicateMatches(matches);
  }

  // ===========================================================================
  // 4. EXACT MATCH
  // ===========================================================================

  const exactRecords = candidateRecords.filter(
    (record) =>
      normalizeLookup(record.entry.normalized) ===
      normalizeLookup(trimmedInput),
  );

  if (exactRecords.length > 0) {
    console.log(
      `[SEARCH] Exact match found for "${trimmedInput}" — AI not needed`,
    );

    return deduplicateMatches(
      exactRecords
        .filter((record) => record.entry?.allImages?.length > 0)
        .map((record) => ({
          type: record.type,

          size: record.size,

          surface: record.surface,

          images: record.entry.allImages,

          normalized: record.entry.normalized,
        })),
    );
  }

  // ===========================================================================
  // 5. CORRECTION CACHE
  // ===========================================================================

  const cacheSize = sizes.length === 1 ? sizes[0] : "all";

  const cacheSurface = surface || "all";

  const cached = getCachedCorrection(
    factory,
    cacheSize,
    cacheSurface,
    trimmedInput,
  );

  if (cached) {
    const cachedRecords = candidateRecords.filter(
      (record) =>
        normalizeLookup(record.entry.normalized) === normalizeLookup(cached),
    );

    if (cachedRecords.length > 0) {
      console.log(`[CACHE] "${trimmedInput}" → "${cached}"`);

      return deduplicateMatches(
        cachedRecords
          .filter((record) => record.entry?.allImages?.length > 0)
          .map((record) => ({
            type: record.type,

            size: record.size,

            surface: record.surface,

            images: record.entry.allImages,

            normalized: record.entry.normalized,
          })),
      );
    }

    console.log(
      `[CACHE] Cached target "${cached}" not present in current search universe`,
    );
  }

  // ===========================================================================
  // 6. UNIQUE AI CANDIDATES
  // ===========================================================================

  const candidateNames = [
    ...new Set(
      candidateRecords
        .map((record) => record.entry?.normalized)
        .filter(Boolean),
    ),
  ];

  if (candidateNames.length === 0) {
    return [];
  }

  console.log(
    `[AI] Matching "${trimmedInput}" against ${candidateNames.length} unique catalogue design(s)`,
  );

  // ===========================================================================
  // 7. OPENAI
  // ===========================================================================

  const aiMatch = await matchDesignName(trimmedInput, candidateNames);

  if (!aiMatch) {
    console.log(`[AI] ❌ No match for "${trimmedInput}"`);

    return [];
  }

  // ===========================================================================
  // 8. STRICT VALIDATION
  // ===========================================================================

  const matchedRecords = candidateRecords.filter(
    (record) =>
      normalizeLookup(record.entry.normalized) === normalizeLookup(aiMatch),
  );

  if (matchedRecords.length === 0) {
    console.log(`[AI] ❌ Returned "${aiMatch}" but no catalogue record exists`);

    return [];
  }

  // ===========================================================================
  // 9. CACHE CONFIRMED MATCH
  // ===========================================================================

  rememberCorrection(
    factory,
    cacheSize,
    cacheSurface,
    trimmedInput,
    matchedRecords[0].entry.normalized,
  );

  // ===========================================================================
  // 10. RETURN ALL VALID MATCHES
  // ===========================================================================

  const matches = matchedRecords
    .filter((record) => record.entry?.allImages?.length > 0)
    .map((record) => ({
      type: record.type,

      size: record.size,

      surface: record.surface,

      images: record.entry.allImages,

      normalized: record.entry.normalized,
    }));

  console.log(
    `[AI] ✅ "${trimmedInput}" → "${aiMatch}" | results=${matches.length}`,
  );

  return deduplicateMatches(matches);
}

// =============================================================================
// LOOKUP NORMALIZATION
// =============================================================================

function normalizeLookup(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/grey/g, "gray")
    .replace(/cremah/g, "crema")
    .replace(/bej\b/g, "beige")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =============================================================================
// MATCH DEDUPLICATION
// =============================================================================

function deduplicateMatches(matches) {
  const seen = new Set();

  const result = [];

  for (const match of matches) {
    const images = [...new Set(match.images || [])];

    if (images.length === 0) {
      continue;
    }

    const key = [match.type, match.size, match.surface, ...images].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    result.push({
      ...match,
      images,
    });
  }

  return result;
}

// =============================================================================
// SEND FILES
// =============================================================================

async function sendFiles(from, filePaths, type, totalSentSoFar) {
  let sent = 0;

  if (!Array.isArray(filePaths)) {
    return 0;
  }

  const uniqueFiles = [...new Set(filePaths.filter(Boolean))];

  for (const filePath of uniqueFiles) {
    // -------------------------------------------------------------------------
    // Global safety limit
    // -------------------------------------------------------------------------

    if (totalSentSoFar + sent >= MAX_TOTAL) {
      break;
    }

    // -------------------------------------------------------------------------
    // File validation
    // -------------------------------------------------------------------------

    if (!fs.existsSync(filePath)) {
      console.log(`[FILE] ⚠️ Missing: ${filePath}`);

      continue;
    }

    const fileName = path.basename(filePath);

    const caption = path.basename(filePath, path.extname(filePath));

    try {
      // =======================================================================
      // UPLOAD
      // =======================================================================

      const mediaId = await uploadMedia(filePath);

      // =======================================================================
      // JPG
      // =======================================================================

      if (type === "jpg") {
        await sendImage(from, mediaId, caption);

        console.log(`[SENT][JPG] ${caption}`);
      }

      // =======================================================================
      // LIVE
      // =======================================================================
      else if (type === "live") {
        try {
          await sendImage(from, mediaId, caption);

          console.log(`[SENT][LIVE-IMAGE] ${caption}`);
        } catch (imageError) {
          console.warn(
            `[LIVE] Image delivery failed for "${fileName}". Trying document fallback.`,
          );

          await sendDocument(from, mediaId, fileName);

          console.log(`[SENT][LIVE-DOCUMENT-FALLBACK] ${caption}`);
        }
      }

      // =======================================================================
      // UNKNOWN TYPE
      // =======================================================================
      else {
        await sendImage(from, mediaId, caption);

        console.log(`[SENT][IMAGE] ${caption}`);
      }

      sent++;

      // =======================================================================
      // DELAY
      // =======================================================================

      if (totalSentSoFar + sent < MAX_TOTAL) {
        await randomDelay();
      }
    } catch (error) {
      console.error(`[FILE ERROR] ${fileName}: ${error.message}`);

      if (error.response?.data) {
        console.error(
          `[WHATSAPP ERROR] ${JSON.stringify(error.response.data)}`,
        );
      }
    }
  }

  return sent;
}

// =============================================================================
// EXPORT
// =============================================================================

module.exports = {
  processMessage,
};

const OpenAI = require("openai");
const Fuse = require("fuse.js");

require("dotenv").config();

// =============================================================================
// CONFIG
// =============================================================================

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

// Maximum number of candidates sent to OpenAI.
//
// We intentionally keep this bounded because the candidate list has already
// been restricted by:
//
//     factory + type + size + surface
//
// so this is only a safety limit for unusually large catalogue buckets.
const MAX_AI_CANDIDATES = 30;

// Fuse retrieves possible candidates locally.
//
// IMPORTANT:
// Fuse is ONLY a candidate retriever.
// It is NEVER allowed to decide the final answer.
const FUSE_THRESHOLD = 0.45;

// Number of local candidates retained before sending to OpenAI.
const MAX_FUSE_RESULTS = 30;

// Maximum output tokens required.
// The model only needs to return:
//
//     candidate name
//
// or:
//
//     NO_MATCH
//
const MAX_OUTPUT_TOKENS = 20;

// In-memory result cache.
//
// Key:
//     normalized user input + candidate universe
//
// Value:
//     exact candidate string or null
//
// This saves repeated OpenAI calls during the same server process.
//
// Example:
//
//     "magic gray"
//     + same candidate bucket
//
// will not call OpenAI repeatedly.
const matchCache = new Map();

const MAX_CACHE_ENTRIES = 5000;

// =============================================================================
// OPENAI CLIENT
// =============================================================================

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "[OPENAI] ⚠️ OPENAI_API_KEY is not set. AI fallback matching will fail.",
  );
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =============================================================================
// NORMALIZATION
// =============================================================================

/**
 * Normalize user text only for lookup/cache purposes.
 *
 * This does NOT attempt to determine the correct design.
 *
 * The actual catalogue normalization is performed by normalizer.js and
 * designIndex.js.
 */
function normalizeInput(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/grey/g, "gray")
    .replace(/cremah/g, "crema")
    .replace(/bej\b/g, "beige")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a candidate only for comparison.
 *
 * We intentionally do not perform fuzzy normalization here.
 */
function normalizeCandidate(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// =============================================================================
// CACHE
// =============================================================================

function createCacheKey(userInput, candidates) {
  const normalizedInput = normalizeInput(userInput);

  const candidateKey = [...candidates].map(normalizeCandidate).sort().join("|");

  return `${normalizedInput}::${candidateKey}`;
}

function getCachedMatch(key) {
  if (!matchCache.has(key)) {
    return undefined;
  }

  return matchCache.get(key);
}

function setCachedMatch(key, value) {
  if (matchCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = matchCache.keys().next().value;

    if (firstKey) {
      matchCache.delete(firstKey);
    }
  }

  matchCache.set(key, value);
}

// =============================================================================
// CANDIDATE VALIDATION
// =============================================================================

/**
 * Return the exact candidate represented by an AI response.
 *
 * The AI response is NEVER trusted directly.
 *
 * Example:
 *
 * AI:
 *     "Magic Gray"
 *
 * Candidate:
 *     "magic gray"
 *
 * Result:
 *     "magic gray"
 *
 * If AI returns:
 *
 *     "Magic Grey"
 *
 * and the candidate list contains only:
 *
 *     "magic gray"
 *
 * we do NOT perform partial/substring matching here.
 *
 * The response must correspond to one supplied candidate.
 */
function validateAiResponse(reply, candidates) {
  if (!reply) {
    return null;
  }

  const cleaned = String(reply)
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!cleaned) {
    return null;
  }

  if (cleaned.toUpperCase() === "NO_MATCH") {
    return null;
  }

  const normalizedReply = normalizeCandidate(cleaned);

  const exact = candidates.find(
    (candidate) => normalizeCandidate(candidate) === normalizedReply,
  );

  return exact || null;
}

// =============================================================================
// NUMERIC DETECTION
// =============================================================================

function isPureNumeric(value) {
  return /^\d+$/.test(String(value || "").trim());
}

// =============================================================================
// FUZZY CANDIDATE RETRIEVAL
// =============================================================================

/**
 * Retrieve candidates locally using Fuse.
 *
 * Fuse does NOT make the final match.
 *
 * Its only responsibility is:
 *
 *     huge bucket
 *          ↓
 *     smaller relevant candidate list
 *          ↓
 *     OpenAI
 *
 * This keeps the AI prompt small while allowing OpenAI to make the final
 * decision.
 */
function getCandidateShortlist(userInput, candidates) {
  if (!Array.isArray(candidates)) {
    return [];
  }

  const cleanedCandidates = [
    ...new Set(
      candidates
        .map((candidate) => String(candidate || "").trim())
        .filter(Boolean),
    ),
  ];

  if (cleanedCandidates.length === 0) {
    return [];
  }

  // Small candidate sets are already safe to send completely.
  if (cleanedCandidates.length <= MAX_AI_CANDIDATES) {
    return cleanedCandidates;
  }

  const fuse = new Fuse(cleanedCandidates, {
    keys: ["normalized"],
    threshold: FUSE_THRESHOLD,
    distance: 1000,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 2,
  });

  const results = fuse.search(userInput).slice(0, MAX_FUSE_RESULTS);

  if (results.length === 0) {
    console.log(
      `[OPENAI] ❌ Local retrieval found no plausible candidates for "${userInput}"`,
    );

    return [];
  }

  const shortlist = results.map((result) => result.item).filter(Boolean);

  return [...new Set(shortlist.slice(0, MAX_AI_CANDIDATES))];
}

// =============================================================================
// OPENAI PROMPT
// =============================================================================

const SYSTEM_PROMPT = `
You are a strict tile catalogue design-name verifier.

Your job is NOT to invent, autocomplete, search the internet, or create a new
design name.

You are given:
1. A design name typed by a user.
2. A closed list of valid catalogue design names.

Choose a candidate ONLY when the user input is reasonably intended to refer to
that exact candidate.

Allowed differences include:
- spelling mistakes
- missing letters
- extra letters
- swapped letters
- minor spacing differences
- minor word-order differences
- obvious typing mistakes
- common spelling variants

Do NOT choose a candidate merely because it is vaguely similar.

Be especially careful when candidates differ by:
- color
- number
- collection
- model code
- variant
- suffix
- one important word

Examples:

User: "diamnd blue"
Candidate: "diamond blue"
Result: "diamond blue"

User: "alpine gre"
Candidate: "alpine gray"
Result: "alpine gray"

User: "xyz123"
Candidates: "diamond blue", "alpine gray"
Result: "NO_MATCH"

If two or more candidates are similarly plausible and the input does not clearly
distinguish them, return NO_MATCH.

You MUST return exactly one of the supplied candidate strings or:

NO_MATCH

Never return an explanation.
Never return a candidate that was not supplied.
`;

// =============================================================================
// OPENAI CALL
// =============================================================================

async function askOpenAI(userInput, candidates) {
  const userPrompt = [
    `User input: ${userInput}`,
    "",
    "Valid catalogue candidates:",
    ...candidates.map((candidate) => `- ${candidate}`),
    "",
    "Return exactly one candidate from the list above or NO_MATCH.",
  ].join("\n");

  console.log(
    `[OPENAI] 📤 Request | model=${MODEL} | input="${userInput}" | candidates=${candidates.length}`,
  );

  const start = Date.now();

  try {
    const response = await client.chat.completions.create({
      model: MODEL,

      temperature: 0,

      max_tokens: MAX_OUTPUT_TOKENS,

      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT.trim(),
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const duration = Date.now() - start;

    const reply = response.choices?.[0]?.message?.content?.trim() || "";

    const usage = response.usage || {};

    console.log(
      `[OPENAI] 📥 Response | duration=${duration}ms | input_tokens=${usage.prompt_tokens ?? "?"} | output_tokens=${usage.completion_tokens ?? "?"} | total_tokens=${usage.total_tokens ?? "?"}`,
    );

    console.log(`[OPENAI] Response: "${reply}"`);

    return {
      reply,
      duration,
      usage,
    };
  } catch (error) {
    const duration = Date.now() - start;

    console.error(
      `[OPENAI] ❌ API error after ${duration}ms: ${error.message}`,
    );

    if (error.status) {
      console.error(`[OPENAI] Status: ${error.status}`);
    }

    if (error.code) {
      console.error(`[OPENAI] Code: ${error.code}`);
    }

    return null;
  }
}

// =============================================================================
// MAIN MATCH FUNCTION
// =============================================================================

/**
 * Match a user-entered design name against a CLOSED candidate list.
 *
 * IMPORTANT:
 *
 * This function does not know about:
 *
 *     factory
 *     size
 *     surface
 *     JPG
 *     LIVE
 *     filesystem
 *
 * That is intentional.
 *
 * messageProcessor.js has already established the exact catalogue bucket.
 *
 * Therefore:
 *
 *     matchDesignName()
 *
 * can only choose from the candidates it receives.
 *
 * @param {string} userInput
 * @param {string[]} candidates
 *
 * @returns {Promise<string|null>}
 */
async function matchDesignName(userInput, candidates) {
  // ===========================================================================
  // 1. BASIC VALIDATION
  // ===========================================================================

  if (!userInput || !String(userInput).trim()) {
    console.log("[OPENAI] ⚠️ Empty design input");

    return null;
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    console.log("[OPENAI] ⚠️ No candidates supplied");

    return null;
  }

  const cleanedCandidates = [
    ...new Set(
      candidates
        .map((candidate) => String(candidate || "").trim())
        .filter(Boolean),
    ),
  ];

  if (cleanedCandidates.length === 0) {
    return null;
  }

  const input = String(userInput).trim();

  // ===========================================================================
  // 2. NUMERIC INPUT
  // ===========================================================================
  //
  // Numeric design names are special in your catalogue.
  //
  // We NEVER use fuzzy matching or AI for them.
  //
  // 4085 means exactly 4085.
  //
  // It must never become:
  //
  // 4085 → 4095
  // 4085 → 40850
  // 4085 → 4085 something
  // ===========================================================================

  if (isPureNumeric(input)) {
    const exact = cleanedCandidates.find(
      (candidate) => candidate.trim() === input,
    );

    console.log(
      exact
        ? `[OPENAI] 🔢 Numeric exact match: "${input}"`
        : `[OPENAI] 🔢 Numeric design not found: "${input}"`,
    );

    return exact || null;
  }

  // ===========================================================================
  // 3. NORMALIZED EXACT MATCH
  // ===========================================================================
  //
  // messageProcessor already performs this check.
  //
  // We repeat it here as a safety boundary because this function may be called
  // from another part of the application in the future.
  //
  // No API call.
  // ===========================================================================

  const normalizedInput = normalizeInput(input);

  const exact = cleanedCandidates.find(
    (candidate) => normalizeCandidate(candidate) === normalizedInput,
  );

  if (exact) {
    console.log(`[OPENAI] ✅ Exact candidate match: "${exact}" — no API call`);

    return exact;
  }

  // ===========================================================================
  // 4. CACHE
  // ===========================================================================
  //
  // Cache is checked after exact matching.
  //
  // This means repeated typo requests do not repeatedly consume API tokens.
  // ===========================================================================

  const cacheKey = createCacheKey(input, cleanedCandidates);

  const cached = getCachedMatch(cacheKey);

  if (cached !== undefined) {
    console.log(
      cached
        ? `[OPENAI] ⚡ Cache hit: "${input}" → "${cached}"`
        : `[OPENAI] ⚡ Cache hit: "${input}" → NO_MATCH`,
    );

    return cached;
  }

  // ===========================================================================
  // 5. LOCAL CANDIDATE RETRIEVAL
  // ===========================================================================

  const shortlist = getCandidateShortlist(input, cleanedCandidates);

  if (shortlist.length === 0) {
    setCachedMatch(cacheKey, null);

    return null;
  }

  console.log(
    `[OPENAI] Candidate retrieval: ${cleanedCandidates.length} total → ${shortlist.length} sent to AI`,
  );

  // ===========================================================================
  // 6. OPENAI VERIFICATION
  // ===========================================================================

  const aiResult = await askOpenAI(input, shortlist);

  if (!aiResult) {
    // Do NOT guess when OpenAI fails.
    //
    // Accuracy is more important than returning something.
    return null;
  }

  // ===========================================================================
  // 7. STRICT RESPONSE VALIDATION
  // ===========================================================================

  const matchedCandidate = validateAiResponse(aiResult.reply, shortlist);

  if (!matchedCandidate) {
    console.log(`[OPENAI] ❌ AI response rejected: "${aiResult.reply}"`);

    setCachedMatch(cacheKey, null);

    return null;
  }

  // ===========================================================================
  // 8. FINAL CANDIDATE VALIDATION
  // ===========================================================================
  //
  // This second check is intentionally redundant.
  //
  // We want the invariant:
  //
  //     returned value MUST exist in the original candidate universe
  //
  // not merely in the shortlist.
  // ===========================================================================

  const originalCandidate = cleanedCandidates.find(
    (candidate) =>
      normalizeCandidate(candidate) === normalizeCandidate(matchedCandidate),
  );

  if (!originalCandidate) {
    console.error(
      `[OPENAI] ❌ Safety rejection: AI selected "${matchedCandidate}" but it is not in the original candidate list`,
    );

    setCachedMatch(cacheKey, null);

    return null;
  }

  // ===========================================================================
  // 9. SUCCESS
  // ===========================================================================

  console.log(
    `[OPENAI] ✅ Verified match: "${input}" → "${originalCandidate}"`,
  );

  setCachedMatch(cacheKey, originalCandidate);

  return originalCandidate;
}

// =============================================================================
// CACHE MANAGEMENT
// =============================================================================

function clearMatchCache() {
  matchCache.clear();

  console.log("[OPENAI] Match cache cleared");
}

function getMatchCacheSize() {
  return matchCache.size;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  matchDesignName,
  clearMatchCache,
  getMatchCacheSize,
};

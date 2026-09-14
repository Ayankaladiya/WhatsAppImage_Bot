const Fuse = require("fuse.js");

// ─── SHARED CONSTANTS ─────────────────────────────────────────────────────────
// Avoid copy-pasting these 24 tokens into every factory.

const STANDARD_FACE_SUFFIXES = [
  "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8",
  "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8",
  "1",  "2",  "3",  "4",  "5",  "6", "7", "8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24",
  "a", "b", "c", "d", "e", "f", "g", "h","i", "j", "k",
];

// Extra punch/panel suffixes used by armano, blackberry, astica
const PUNCH_FACE_SUFFIXES = [
  ...STANDARD_FACE_SUFFIXES,
  "(flutted punch)", "(slate punch)", "sp", "sandy", "bp", "lp", "np", "blast", "liner", "stap","plain", "dk", "lt",
];

// Most 600x1200 factories accept the same size aliases
const ALIASES_600x1200 = {
  "2x4": "600x1200", "4x2": "600x1200",
  "2*4": "600x1200", "4*2": "600x1200",
  "1200x600": "600x1200", "1200*600": "600x1200",
};

// ─── FACTORY CONFIG ───────────────────────────────────────────────────────────
// surfaces: { canonicalKey: [alias1, alias2, …] }
//   - canonicalKey must be lowercase (matches the folder name after lowercasing)
//   - aliases are what the user can type; all resolved to canonicalKey
// stripPrefixes: tokens stripped from the START of a design name before matching
// faceSuffixes: tokens stripped from the END of a design name (face variants)
// ignoreTokensAnywhere / ignoreTokensSuffixes: additional tokens to remove

const factoryConfig = {
  abroad: {
    aliases: ["abroad"],
    sizeRequired: false,
    surfaceRequired: false,
    sizes: ["600x1200"],
    sizeAliases: ALIASES_600x1200,
    preferredSize: "600x1200",
    surfaces: {
      glossy: ["glossy", "ic"],
    },
    stripPrefixes: [],
    faceSuffixes: STANDARD_FACE_SUFFIXES,
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: [],
  },
  armano: {
    aliases: ["armano"],
    sizeRequired: false,
    surfaceRequired: false,
    sizes: ["600x600", "600x1200"],
    sizeAliases: { "2x2": "600x600", ...ALIASES_600x1200 },
    preferredSize: "600x1200",
    surfaces: {
      glossy:   ["glossy", "ic"],
      matt:     ["matt", "mett"],
      express:  ["express"],
      magic:    ["magic"],
      mono:     ["mono"],
      terrazo:  ["terrazo"],
      venice:   ["venice"],
      pastel:   ["pastel"],
      punch:    ["punch"],
    },
    stripPrefixes: ["bp", "lp", "sp","blast", "liner", "stap", "STAP", "LINEAR"],
    // sp listed once (was duplicated in original)
    faceSuffixes: [...PUNCH_FACE_SUFFIXES, "cobalt blue", "caramel"],
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: [],
  },
  astica: {
    aliases: ["astica"],
    sizeRequired: false,
    surfaceRequired: true,
    sizes: ["600x1200", "600x600"],
    sizeAliases: ALIASES_600x1200,
    preferredSize: "600x1200",
    surfaces: {
      ic:                     ["ic", "ivory carving", "ivory", "glossy", "fullbody"],
      matt:                   ["matt"],
      carving:                ["crv", "crving", "carving"],
      endless_carving:        ["endlesscrving", "endless carving"],
      golden_endless_carving: ["golden endless carving"],
      marble_carving:         ["marble carving"],
      white_carving:          ["white carving"],
      wood_carving:           ["wood carving"],
      punch:                  ["punch"],
      newmarble:              ["newmarble"],
      glue:                   ["glue", "glu"],
      posh:                   ["posh"],
      spiral:                 ["spiral"],
      vt:                     ["vt"],
      New_folder:             ["New_folder"],
    },
    stripPrefixes: ["ic", "express", "mono", "emr", "mr", "pm", "shg", "liniar", "matt", "panels", "storey", "bp", "lp", "sp"],
    faceSuffixes: [...STANDARD_FACE_SUFFIXES, "decor", "decore", "dk", "hl", "lt","-dk", "-lt", "-hl"],
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: ["(flutted punch)", "(slate punch)", "sp", "sandy"],
  },
  blackberry: {
    aliases: ["blackberry"],
    sizeRequired: false,
    surfaceRequired: false,
    sizes: ["600x1200", "600x600"],
    sizeAliases: ALIASES_600x1200,
    preferredSize: "600x1200",
    surfaces: {
      digi_matt_base:    ["digimatt", "dg"],
      gloster:           ["gloster"],
      high_glossy:       ["hg", "high gloss"],
      lappato:           ["lappato"],
      lastra_dark:       ["lastra dark", "lastra_dark"],
      lastra_light:      ["lastra light", "lastra_light"],
      lucent:            ["lucent"],
      matt:              ["matt"],
      pastel:            ["pastel"],
      proactive:         ["proactive"],
      punch_series:      ["punch series", "punch_series", "honed"],
      rocker:            ["rocker"],
      super_collection:  ["super collection", "super_collection"],
      super_high_glossy: ["shg", "super high gloss"],
    },
    stripPrefixes: ["ic", "express", "mono", "emr", "mr", "pm", "shg", "liniar", "matt", "panels", "storey", "bp", "lp", "sp"],
    faceSuffixes: PUNCH_FACE_SUFFIXES,
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: ["(flutted punch)", "(slate punch)", "sp", "sandy"],
  },
  gc: {
    aliases: ["gc", "gc granito"],
    sizeRequired: false,
    surfaceRequired: false,
    sizes: ["600x1200"],
    sizeAliases: ALIASES_600x1200,
    preferredSize: "600x1200",
    surfaces: {
      glossy: ["glossy", "ic"],
    },
    stripPrefixes: [],
    faceSuffixes: STANDARD_FACE_SUFFIXES,
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: [],
  },
  leopard: {
    aliases: ["leopard"],
    sizeRequired: false,
    surfaceRequired: true,
    sizes: ["600x1200"],
    sizeAliases: ALIASES_600x1200,
    preferredSize: "600x1200",
    surfaces: {
      matt:   ["matt", "matte"],
      glossy: ["ic", "ivory carving", "ivory", "glossy"],
      carving:["carving", "emr", "mr", "sp"],
      valvet: ["dg", "digi matt", "digimatt", "valvet", "velvet"],
      pm:     ["pm", "paper matt", "papermatt", "paper matte"],
      hg:     ["hg", "high gloss", "highgloss"],
      shg:    ["shg", "super high gloss"],
      punch:  ["punch", "metic", "storey", "liniar"],
    },
    stripPrefixes: ["ic", "hg", "dg", "emr", "mr", "pm", "shg", "liniar", "matt", "panels", "storey"],
    faceSuffixes: STANDARD_FACE_SUFFIXES,
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: [],
  },
  letina: {
    aliases: ["letina"],
    sizeRequired: false,
    surfaceRequired: false,
    sizes: ["500x500"],
    sizeAliases: "",
    preferredSize: {
      "20x20": "500x500", "20*20": "500x500",
    },
    surfaces: {
      parking:      ["parking"],
    },
    stripPrefixes: [],
    faceSuffixes: STANDARD_FACE_SUFFIXES,
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: [],
  },
  lomino: {
    aliases: ["lomino"],
    sizeRequired: false,
    surfaceRequired: false,
    sizes: ["400x400"],
    sizeAliases: "",
    preferredSize: {
      "16x16": "400x400", "16*16": "400x400",
    },
    surfaces: {
      Newfolder:      ["Newfolder"],
    },
    stripPrefixes: [],
    faceSuffixes: STANDARD_FACE_SUFFIXES,
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: [],
  },
  parcos: {
    aliases: ["parcos"],
    sizeRequired: false,
    surfaceRequired: false,
    sizes: ["600x600", "600x1200"],
    sizeAliases: ALIASES_600x1200,
    preferredSize: "600x1200",
    surfaces: {
      glossy:         ["glossy", "ic"],
      glossy_grenula: ["glossy grenula", "glossy_grenula"],
      matt:           ["matt", "matte"],
      carving:        ["cerving", "carving", "crv"],
      ghr:            ["ghr"],
      glamour:        ["glamour", "glamoure"],
      plain:          ["plain"],
      rotto_sugar:    ["rotto sugar", "rotto_sugar"],
      stonex:         ["stonex"],
      sugar:          ["sugar"],
      sugar_grenula:  ["sugar grenula", "sugar_grenula"],
      punch:          ["punch", "metic", "storey", "liniar"],
    },
    stripPrefixes: [],
    faceSuffixes: STANDARD_FACE_SUFFIXES,
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: [],
  },
  segam: {
    aliases: ["segam"],
    sizeRequired: false,
    surfaceRequired: false,
    sizes: ["600x1200"],
    sizeAliases: ALIASES_600x1200,
    preferredSize: "600x1200",
    surfaces: {
      burberry:           ["burberry"],
      carving:            ["carving"],
      punch:              ["punch"],
      endless_carving:    ["endless carving", "endless"],
      floral:             ["floral"],
      gala_sp_colour:     ["gala", "gala sp colour", "gala sp color", "gala sp"],
      ghr:                ["ghr"],
      golden_carving:     ["golden carving", "golden"],
      heritage:           ["heritage"],
      midas_golden:       ["midas golden", "midas"],
      seta:               ["seta"],
      terrazo:            ["terrazo"],
      veneer_wood:        ["veneer wood", "veneer", "veneer wood matt"],
      wooden:             ["wooden"],
      new_folder:         ["newfolder"],
    },
    stripPrefixes: ["crv", "decor"],
    faceSuffixes: [...STANDARD_FACE_SUFFIXES, "l1", "l2", "l3", "l4", "l5", "l6"],
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: [],
  },
  skype: {
    aliases: ["skype"],
    sizeRequired: false,
    surfaceRequired: false,
    sizes: ["600x1200"],
    sizeAliases: ALIASES_600x1200,
    preferredSize: "600x1200",
    surfaces: {
      glossy:      ["glossy", "ic"],
      matt:        ["matt", "matte"],
      carving:     ["carving", "emr", "mr", "sp"],
      velvet:      ["dg", "digi matt", "digimatt", "valvet", "velvet"],
      pm:          ["pm", "paper matt", "papermatt", "paper matte"],
      hg:          ["hg", "high gloss", "highgloss", "high glossy"],
      shg:         ["shg", "super high gloss"],
      inky:        ["inky"],
      inky_carving:["inky carving"],
      laminate:    ["laminate"],
      prime:       ["prime"],
      primepro:    ["primepro"],
      raindrop:    ["raindrop"],
      glitar:      ["glitar", "gliter"],
      punch:       ["punch", "metic", "storey", "liniar"],
    },
    stripPrefixes: [],
    faceSuffixes: STANDARD_FACE_SUFFIXES,
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: [],
  },
  lovel: {
    aliases: ["lovel"],
    sizeRequired: false,
    surfaceRequired: false,
    sizes: ["12x12", "12x18"],
    sizeAliases: {"12x12": "300x300"},
    preferredSize: "12x18",
    surfaces: {
      all:    ["all"],
    },
    stripPrefixes: [],
    faceSuffixes: STANDARD_FACE_SUFFIXES,
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: [],
  },
  ldecor: {
    aliases: ["ldecor"],
    sizeRequired: false,
    surfaceRequired: false,
    sizes: ["600x1200"],
    sizeAliases: ALIASES_600x1200,
    preferredSize: "600x1200",
    surfaces: {
      glossy: ["glossy", "ic"],
    },
    stripPrefixes: [],
    faceSuffixes: STANDARD_FACE_SUFFIXES,
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: [],
  },
  vetican: {
    aliases: ["vetican"],
    sizeRequired: true,
    surfaceRequired: false,
    sizes: ["800x2400", "800x3000"],
    sizeAliases: {
      "80x240": "800x2400", "80x300": "800x3000",
      "80*240": "800x2400", "80*300": "800x3000",
    },
    preferredSize: "800x2400",
    surfaces: {
      glossy:   ["ic", "ivory carving", "ivory", "glossy", "fullbody"],
      saga:     ["saga"],
      snp:      ["snp", "s&p"],
      fullbody: ["fullbody", "full body", "plain"],
      general:  ["general"],
    },
    stripPrefixes: ["ic", "express", "mono", "emr", "mr", "pm", "shg", "liniar", "matt", "panels", "galaxy"],
    faceSuffixes: STANDARD_FACE_SUFFIXES,
    ignoreTokensAnywhere: [],
    ignoreTokensSuffixes: ["galaxy"],
  },
};

// ─── LOOKUP TABLES (built once at startup) ────────────────────────────────────

// alias → canonical factory name
const aliasToFactory = new Map();
for (const [factoryName, cfg] of Object.entries(factoryConfig)) {
  aliasToFactory.set(factoryName, factoryName);
  for (const alias of (cfg.aliases || [])) {
    aliasToFactory.set(alias.toLowerCase(), factoryName);
  }
}

// Fuse fallback for typos in factory names (e.g. "lepard" → "leopard")
const factorySearch = new Fuse(Object.keys(factoryConfig), { threshold: 0.2 });

// surface lookup cache: factoryName → Map<userTyped → canonicalKey>
const surfaceLookupCache = new Map();

// ─── PUBLIC FUNCTIONS ─────────────────────────────────────────────────────────

function resolveFactory(input) {
  if (!input) return null;
  const lower = input.toLowerCase().trim();
  if (aliasToFactory.has(lower)) return aliasToFactory.get(lower);
  const results = factorySearch.search(lower);
  return results.length ? results[0].item : null;
}

/**
 * Returns a Map from any user-typed surface string → canonical surface key.
 * Built once per factory and cached.
 */
function getSurfaceLookup(factoryName) {
  if (surfaceLookupCache.has(factoryName)) return surfaceLookupCache.get(factoryName);

  const config = factoryConfig[factoryName];
  if (!config) return new Map();

  const lookup = new Map();
  for (const [surfaceKey, aliases] of Object.entries(config.surfaces)) {
    lookup.set(surfaceKey.toLowerCase(), surfaceKey);   // canonical key maps to itself
    for (const alias of aliases) {
      lookup.set(alias.toLowerCase(), surfaceKey);
    }
  }

  surfaceLookupCache.set(factoryName, lookup);
  return lookup;
}

/**
 * Returns the filter options object used by normalizer and designIndex.
 */
function getFilterOptions(factoryName) {
  const cfg = factoryConfig[factoryName] || {};
  return {
    ignoreTokensAnywhere: cfg.ignoreTokensAnywhere || [],
    ignoreTokensSuffixes: cfg.ignoreTokensSuffixes || [],
    ignoreTokensPrefixes: cfg.stripPrefixes || [],
    faceSuffixes:         cfg.faceSuffixes || [],
  };
}

module.exports = {
  factoryConfig,
  resolveFactory,
  getSurfaceLookup,
  getFilterOptions,
};
const fs = require("fs");
const path = require("path");
const Fuse = require("fuse.js");
const metadata = require("../data/designs.json");
require("dotenv").config();
// CHANGE THIS
// const BASE_PATH = "C:/Users/kalad/Desktop/WhatsAppMessanger/Whatsapp/images";
const BASE_PATH = process.env.BASE_PATH;

const EXTENSIONS = [".jpg", ".png", ".jpeg"];

// Handle multiple designs
function findDesignImages(factoryPath, designs, type, options = {}) {
  const { size, surface } = options;

  let found = [];
  let notFound = [];

  // 🔥 Extract factory name from path
  const factoryName = path.basename(factoryPath).toLowerCase();

  // 🔥 Find factory in metadata (with fuzzy)
  const factory = findFactory(factoryName);

  if (!factory) {
    console.log("Factory not found in metadata:", factoryName);
    return { found: [], notFound: designs };
  }

  for (let design of designs) {
    const matchedDesign = findDesign(factory.designs, design);

    if (!matchedDesign) {
      notFound.push(design);
      continue;
    }

    // 🔥 Filter variants
    let variants = matchedDesign.variants;

    if (type) {
      variants = variants.filter(v => v.source === type.toLowerCase());
    }

    if (size) {
      variants = variants.filter(v => v.size === size);
    }

    if (surface) {
      variants = variants.filter(v => v.surface === surface);
    }

    // fallback if nothing found
    if (variants.length === 0) {
      variants = matchedDesign.variants;
    }

    // 🔥 push all faces
    for (let variant of variants) {
      for (let filePath of variant.faces) {
        found.push({
          path: filePath,
          type
        });
      }
    }
  }

  return { found, notFound };
}

function findFactory(input) {
  const list = metadata.factories.map(f => ({
    name: f.name.toLowerCase(),
    original: f
  }));

  const fuse = new Fuse(list, {
    keys: ["name"],
    threshold: 0.1
  });

  const result = fuse.search(input);

  return result.length ? result[0].item.original : null;
}

function isMostlyNumeric(str) {
  const clean = str.replace(/[^a-z0-9]/gi, "");
  const digits = clean.replace(/[^0-9]/g, "").length;

  if (clean.length === 0) return false;

  return digits / clean.length >= 0.6; // 🔥 60% threshold
}

function findDesign(designs, input) {
  const clean = input.toLowerCase();

  // 🔥 NUMERIC HEAVY → EXACT BASE MATCH
  if (isMostlyNumeric(clean)) {
    // extract base (e.g. 101 from 101_r1)
    const baseMatch = clean.match(/\d+/);
    const base = baseMatch ? baseMatch[0] : clean;

    return designs.find(d => d.design === base) || null;
  }

  // 🔥 TEXT → FUZZY MATCH
  const fuse = new Fuse(designs, {
    keys: ["design"],
    threshold: 0.4
  });

  const result = fuse.search(clean);

  return result.length ? result[0].item : null;
}

// Check factory
function checkFactory(factoryInput) {
  const factories = fs.readdirSync(BASE_PATH).filter((file) => {
    const fullPath = path.join(BASE_PATH, file);
    return fs.statSync(fullPath).isDirectory();
  });
  // console.log(factories);
  // prepare data for fuse
  const factoryList = factories.map((name) => ({
    name: name.toLowerCase(),
    original: name,
  }));

  const fuse = new Fuse(factoryList, {
    keys: ["name"],
    threshold: 0.1,
  });

  const result = fuse.search(factoryInput.toLowerCase());

  if (result.length === 0) {
    console.log("Factory not found:", factoryInput);
    return null;
  }
  // console.log(result)
  const matchedFactory = result[0].item.original;

  console.log(`Factory matched: ${factoryInput} → ${matchedFactory}`);

  return path.join(BASE_PATH, matchedFactory);
}

function fuzzyFind(files, design) {
  const fuse = new Fuse(files, {
    keys: ["name"],
    threshold: 0.2, // lower = stricter
  });

  const results = fuse.search(design.toLowerCase());
  console.log("FuzzyResult", results);
  if (results.length === 0) return null;

  return results;
}

module.exports = {
  checkFactory,
  findDesignImages,
};

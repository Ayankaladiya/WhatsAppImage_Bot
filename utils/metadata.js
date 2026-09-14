const fs = require("fs");
const path = require("path");

const METADATA_PATH = path.join(__dirname, "../data/designs.json");
let cache = null;

/**
 * Normalize designs.json regardless of which format generateMetadata produced.
 *
 * Old format: { factories: [{ name, designs }] }
 * New format: { factoryName: { typeKey: { sizeKey: { surfaceKey: { design: [paths] } } } } }
 *
 * Always returns an array of { name, types } objects and a Map for O(1) lookup.
 */
function normalizeFactoryData(raw) {
  if (Array.isArray(raw.factories)) {
    return raw.factories.map((f) => ({
      name: f.name,
      types: f.types || f.designs || {},
    }));
  }

  return Object.entries(raw).map(([name, payload]) => ({
    name,
    types: payload,
  }));
}

function loadMetadata() {
  if (cache) return cache;

  const raw = JSON.parse(fs.readFileSync(METADATA_PATH, "utf-8"));
  const factories = normalizeFactoryData(raw);
  const map = new Map(factories.map((f) => [f.name, f]));

  cache = { raw, factories, map };
  return cache;
}

function getFactory(name) {
  return loadMetadata().map.get(name) || null;
}

module.exports = { loadMetadata, getFactory };
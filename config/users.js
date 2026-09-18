// ─── USER ACCESS CONFIG ───────────────────────────────────────────────────────
// Map WhatsApp numbers → list of factories they can access.
// Use "All" to grant access to every factory.
//
// Numbers are matched by last-N-digits so country-code variations don't matter.
// e.g. stored "911234567890" matches incoming "01234567890" or "+911234567890".

const ALL_ACCESS = "all";

const userFactoryAccess = {
  918799321278: ["All"],
  917575036234: ["All"],
  919332193321: ["All"],
  917096874111: ["All"],
  918599999702: ["All"],
  917490074929: ["All"],
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function normalizeNumber(number) {
  return number ? number.replace(/\D/g, "") : null;
}

function findUserEntry(number) {
  const normalized = normalizeNumber(number);
  if (!normalized) return null;

  for (const [stored, factories] of Object.entries(userFactoryAccess)) {
    const normalizedStored = normalizeNumber(stored);
    if (normalizedStored && normalized.endsWith(normalizedStored)) {
      return factories;
    }
  }

  return null;
}

// ─── PUBLIC ───────────────────────────────────────────────────────────────────

function isUserAllowed(number) {
  return Boolean(findUserEntry(number));
}

function userHasFactoryAccess(number, factoryName) {
  if (!factoryName) return false;
  const allowed = (findUserEntry(number) || []).map((v) => v.toLowerCase());
  return (
    allowed.includes(ALL_ACCESS) || allowed.includes(factoryName.toLowerCase())
  );
}

module.exports = { isUserAllowed, userHasFactoryAccess };

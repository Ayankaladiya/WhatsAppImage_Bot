/**
 * Parse the raw WhatsApp message text into structured fields.
 *
 * Expected format:
 *   <factory> [size]
 *   [surface]
 *   design1
 *   design2
 *
 * Returns null for empty/invalid input.
 */
function parseMessage(text) {
  if (!text) return null;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const parts = lines[0].split(/\s+/);
  if (parts.length === 0) return null;

  const factory = parts[0];
  let size = null;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    if (part.includes("x") || part.includes("*")) {
      size = part.replace("*", "x");
      break;
    }
  }

  return {
    factory,
    size,
    lines: lines.slice(1),
  };
}

module.exports = { parseMessage };
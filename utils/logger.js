const fs = require("fs");
const path = require("path");

const logFilePath = path.join(__dirname, "..", "logs", "app.log");

// Ensure logs folder exists
if (!fs.existsSync(path.dirname(logFilePath))) {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
}

// Format time
function getTimestamp() {
  // return new Date().toISOString();
  return new Date().toString();
}

// Main log function
function log(message, data = null) {
  const time = getTimestamp();

  let logEntry = `[${time}] ${message}`;

  if (data) {
    logEntry += ` | ${JSON.stringify(data)}`;
  }

  logEntry += "\n";

  fs.appendFileSync(logFilePath, logEntry);
}

// Error log
function logError(error) {
  const time = getTimestamp();

  const logEntry = `[${time}] ERROR: ${error}\n`;

  fs.appendFileSync(logFilePath, logEntry);
}

module.exports = { log, logError };

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// optional random delay (better)
function randomDelay(min = 500, max = 1000) {
  const time = Math.floor(Math.random() * (max - min + 1)) + min;
  return delay(time);
}

module.exports = { delay, randomDelay };

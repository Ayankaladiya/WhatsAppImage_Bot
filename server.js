const express = require('express');
const { isUserAllowed } = require("./config/users");
const { log, logError } = require("./utils/logger");
const { processMessage } = require("./services/messageProcessor");
const { randomDelay } = require("./utils/delay");
require("dotenv").config();

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my-verify-token";

app.get("/", (req, res) => {
  res.send("WhatsApp Bot is running.");
});

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Receive messages
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry;
    if (!entry || entry.length === 0) return res.sendStatus(200);
    
    const changes = entry[0].changes;
    if (!changes || changes.length === 0) return res.sendStatus(200);
    
    const value = changes[0].value;
    
    // Log status updates
    const status = value.statuses?.[0];
    if (status) {
      console.log(`STATUS UPDATE | ID: ${status.id} | STATUS: ${status.status}`);
      log("Status update", status);
    }

    const message = value.messages?.[0];
    if (!message) return res.sendStatus(200);
    
    // Only handle text messages
    if (message.type !== "text") return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body;
    const messageTime = parseInt(message.timestamp);
    const currentTime = Math.floor(Date.now() / 1000);

    // Ignore messages older than 2 minutes (e.g. after server restart)
    if (currentTime - messageTime > 120) {
      log("Ignored old message", { from, timestamp: message.timestamp });
      return res.sendStatus(200);
    }

    // Block unknown users
    if (!isUserAllowed(from)) {
      log("Unauthorized user", { from });
      return res.sendStatus(200);
    }

    log("Incoming message", { from, text, timestamp: message.timestamp });

    // Respond 200 immediately, then process async
    // await randomDelay();
    res.sendStatus(200);
    processMessage(from, text);

  } catch (err) {
    logError(err.message);
    console.error("Webhook error:", err.message);
    res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

require("dotenv").config();

const TOKEN = process.env.Access_Token;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

const BASE_URL = "https://graph.facebook.com/v18.0";

// =============================================================================
// MIME TYPE
// =============================================================================

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
  };

  return map[ext] || "image/jpeg";
}

// =============================================================================
// VALIDATE CONFIG
// =============================================================================

function validateConfig() {
  if (!TOKEN) {
    throw new Error("Missing Access_Token in environment variables.");
  }

  if (!PHONE_ID) {
    throw new Error("Missing PHONE_NUMBER_ID in environment variables.");
  }
}

// =============================================================================
// UPLOAD MEDIA
// =============================================================================

async function uploadMedia(filePath) {
  validateConfig();

  if (!filePath) {
    throw new Error("uploadMedia() requires a file path.");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const mimeType = getMimeType(filePath);

  const form = new FormData();

  form.append("file", fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: mimeType,
  });

  form.append("messaging_product", "whatsapp");

  console.log(`[UPLOAD] ${path.basename(filePath)} | mime=${mimeType}`);

  try {
    const response = await axios.post(`${BASE_URL}/${PHONE_ID}/media`, form, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...form.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const mediaId = response.data?.id;

    if (!mediaId) {
      throw new Error(
        "WhatsApp upload succeeded but no media ID was returned.",
      );
    }

    console.log(`[UPLOAD] ✅ ${path.basename(filePath)} → ${mediaId}`);

    return mediaId;
  } catch (error) {
    logWhatsAppError("Media upload", error);

    throw error;
  }
}

// =============================================================================
// SEND IMAGE
// =============================================================================

async function sendImage(to, mediaId, caption = "") {
  validateConfig();

  if (!to) {
    throw new Error("sendImage() requires recipient.");
  }

  if (!mediaId) {
    throw new Error("sendImage() requires media ID.");
  }

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: {
      id: mediaId,
    },
  };

  if (caption) {
    body.image.caption = caption;
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/${PHONE_ID}/messages`,
      body,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log(`[WHATSAPP] ✅ Image sent to ${to}`);

    return response.data;
  } catch (error) {
    logWhatsAppError("Image send", error);

    throw error;
  }
}

// =============================================================================
// SEND DOCUMENT
// =============================================================================
//
// Used as a fallback when WhatsApp cannot send a particular LIVE file as an
// image.
//
// We keep this function because some catalogue files may not be accepted by
// WhatsApp's image endpoint even though they are valid catalogue assets.
//

async function sendDocument(to, mediaId, filename) {
  validateConfig();

  if (!to) {
    throw new Error("sendDocument() requires recipient.");
  }

  if (!mediaId) {
    throw new Error("sendDocument() requires media ID.");
  }

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: {
      id: mediaId,
      filename: filename || "catalogue-image.jpg",
    },
  };

  try {
    const response = await axios.post(
      `${BASE_URL}/${PHONE_ID}/messages`,
      body,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log(`[WHATSAPP] ✅ Document sent to ${to}`);

    return response.data;
  } catch (error) {
    logWhatsAppError("Document send", error);

    throw error;
  }
}

// =============================================================================
// SEND TEXT
// =============================================================================

async function sendText(to, message) {
  validateConfig();

  if (!to) {
    throw new Error("sendText() requires recipient.");
  }

  if (!message) {
    return;
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/${PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: String(message),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log(`[WHATSAPP] ✅ Text sent to ${to}`);

    return response.data;
  } catch (error) {
    logWhatsAppError("Text send", error);

    throw error;
  }
}

// =============================================================================
// ERROR LOGGING
// =============================================================================

function logWhatsAppError(operation, error) {
  console.error(`[WHATSAPP] ❌ ${operation}: ${error.message}`);

  if (error.response) {
    console.error(`[WHATSAPP] Status: ${error.response.status}`);

    if (error.response.data) {
      console.error(
        `[WHATSAPP] Response: ${JSON.stringify(error.response.data)}`,
      );
    }
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  uploadMedia,
  sendImage,
  sendDocument,
  sendText,
};

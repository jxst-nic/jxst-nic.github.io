// Cloudflare Worker contact endpoint for Nicbytes.
//
// Cloudflare setup:
// 1. Deploy this file as your Worker.
// 2. Set this Worker secret/environment variable in Cloudflare:
//    DISCORD_WEBHOOK_URL = your Discord webhook URL
// 3. Paste the deployed Worker URL into contact-config.js.
//
// Keep DISCORD_WEBHOOK_URL out of frontend files. GitHub Pages should only know
// the Worker URL, never the Discord webhook URL.

const ALLOWED_ORIGINS = new Set([
  "https://nicbytes.is-a.dev",
  "https://jxst-nic.github.io",
  "http://127.0.0.1:5000",
  "http://localhost:5000"
]);

const MAX_NAME_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 1800;
const MAX_DISCORD_FILES = 8;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!isAllowedOrigin(request)) {
      return jsonResponse({ ok: false, error: "Origin not allowed" }, 403, cors);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, cors);
    }

    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      return jsonResponse(
        { ok: false, error: "DISCORD_WEBHOOK_URL is not configured" },
        500,
        cors
      );
    }

    let incoming;
    try {
      incoming = await request.formData();
    } catch {
      return jsonResponse({ ok: false, error: "Expected FormData" }, 400, cors);
    }

    const name = cleanText(incoming.get("name"), MAX_NAME_LENGTH);
    const message = cleanText(incoming.get("message"), MAX_MESSAGE_LENGTH);

    if (!name || !message) {
      return jsonResponse({ ok: false, error: "Missing name or message" }, 400, cors);
    }

    const files = collectFiles(incoming);
    const payload = {
      content: buildDiscordContent(name, message),
      allowed_mentions: { parse: [] }
    };

    if (files.length) {
      const uploadResponse = await sendDiscordMultipart(webhookUrl, payload, files).catch(() => null);
      if (uploadResponse?.ok) {
        return jsonResponse({ ok: true, filesSent: files.length }, 200, cors);
      }
    }

    const textResponse = await sendDiscordText(webhookUrl, payload).catch(() => null);
    if (textResponse?.ok) {
      return jsonResponse(
        { ok: true, filesSent: 0, fileFallback: files.length > 0 },
        200,
        cors
      );
    }

    return jsonResponse({ ok: false, error: "Discord webhook request failed" }, 502, cors);
  }
};

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };

  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function isAllowedOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function collectFiles(formData) {
  return [...formData.getAll("files"), ...formData.getAll("files[]")]
    .filter(isUploadFile)
    .slice(0, MAX_DISCORD_FILES);
}

function isUploadFile(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.arrayBuffer === "function" &&
    (value.name || value.size > 0)
  );
}

function buildDiscordContent(name, message) {
  return `**New nicbytes message**\n**Name:** ${name}\n**Message:**\n${message}`;
}

async function sendDiscordMultipart(webhookUrl, payload, files) {
  const data = new FormData();
  data.append("payload_json", JSON.stringify(payload));

  files.forEach((file, index) => {
    const fileName = file.name || `attachment-${index + 1}`;
    data.append(`files[${index}]`, file, fileName);
  });

  return fetch(webhookUrl, {
    method: "POST",
    body: data
  });
}

async function sendDiscordText(webhookUrl, payload) {
  return fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function jsonResponse(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json"
    }
  });
}

// Optional Cloudflare Worker contact endpoint for Nicbytes.
// Put your Discord webhook URL into the Worker environment variable DISCORD_WEBHOOK_URL.
// This hides the webhook from your public website.
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }
    const webhook = env.DISCORD_WEBHOOK_URL;
    if (!webhook) {
      return new Response("Webhook not configured", { status: 500, headers: corsHeaders() });
    }
    const incoming = await request.formData();
    const name = String(incoming.get("name") || "").slice(0, 80);
    const message = String(incoming.get("message") || "").slice(0, 1800);
    if (!name || !message) {
      return new Response("Missing name or message", { status: 400, headers: corsHeaders() });
    }
    const outgoing = new FormData();
    outgoing.append("payload_json", JSON.stringify({
      content: `**New nicbytes message**\n**Name:** ${name}\n**Message:** ${message}`
    }));
    const files = incoming.getAll("files").filter(Boolean).slice(0, 8);
    files.forEach((file, index) => outgoing.append(`files[${index}]`, file, file.name || `file-${index}`));
    const response = await fetch(webhook, { method: "POST", body: outgoing });
    return new Response(JSON.stringify({ ok: response.ok }), {
      status: response.ok ? 200 : 502,
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }
};
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

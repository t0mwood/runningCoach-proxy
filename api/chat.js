export default async function handler(req, res) {
  const TIMEOUT_MS = 12000;

  // Production limits
  const PROD_MAX_USER_CHARS = 500;

  // Debug (Xcode) limits
  const DEBUG_MAX_USER_CHARS = 5000;

  // Allow preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Debug-Token"
    );
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

  let body = {};
  try {
    body = req.body || {};
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];

  if (messages.length === 0) {
    return res.status(400).json({ error: "No messages" });
  }

  const lastUser = [...messages]
    .reverse()
    .find((m) => m && m.role === "user")?.text;

  if (!lastUser || typeof lastUser !== "string" || lastUser.trim().length === 0) {
    return res.status(400).json({ error: "No valid user message" });
  }

  // --- Debug detection ---
  const debugToken = req.headers["x-debug-token"];
  const isDebug =
    typeof debugToken === "string" &&
    debugToken === process.env.DEBUG_TOKEN;

  const MAX_MESSAGES = isDebug ? 200 : 10;
  const MAX_OUTPUT_TOKENS = isDebug ? 700 : 220;
  const MAX_USER_CHARS = isDebug
    ? DEBUG_MAX_USER_CHARS
    : PROD_MAX_USER_CHARS;

  if (lastUser.length > MAX_USER_CHARS) {
    return res.status(400).json({
      error: `Message too long (max ${MAX_USER_CHARS} chars)`,
    });
  }

  if (messages.length > MAX_MESSAGES) {
    return res
      .status(400)
      .json({ error: `Too many messages (max ${MAX_MESSAGES})` });
  }
  // --- End debug logic ---

  // Normalise messages before sending upstream
  const normalised = messages
    .map((m) => {
      if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
      if (typeof m.text !== "string") return null;
      const trimmed = m.text.trim();
      if (!trimmed) return null;
      return { role: m.role, content: trimmed };
    })
    .filter(Boolean);

  if (normalised.length === 0) {
    return res.status(400).json({ error: "No valid messages after normalisation" });
  }

  // Neutral system prompt - Milo persona lives in the app (Xcode)
  const system = `
You are a helpful assistant.
Follow the conversation exactly.
Do not introduce your own persona or override instructions.
`.trim();

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [{ role: "system", content: system }, ...normalised],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return res.status(502).json({ error: "OpenAI error", detail });
    }

    const data = await resp.json();
    const reply =
      data?.output?.[0]?.content?.[0]?.text ||
      data?.output_text ||
      "Sorry, I couldn’t reply.";

    return res.status(200).json({ reply });
  } catch (err) {
    const msg =
      err?.name === "AbortError"
        ? `Upstream timeout after ${TIMEOUT_MS}ms`
        : String(err?.message || err);

    return res.status(502).json({ error: "Proxy error", detail: msg });
  } finally {
    clearTimeout(timeout);
  }
}

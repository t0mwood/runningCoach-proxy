export default async function handler(req, res) {
  const TIMEOUT_MS = 12000;

  // Default production limits
  const PROD_MAX_USER_CHARS = 500;
  // Higher limit for Xcode Debug builds only
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

  if (!lastUser) {
    return res.status(400).json({ error: "No user message" });
  }

  if (typeof lastUser !== "string" || lastUser.trim().length === 0) {
    return res.status(400).json({ error: "Empty user message" });
  }

  // --- Debug-only bypass logic ---
  const debugToken = req.headers["x-debug-token"];
  const isDebug =
    typeof debugToken === "string" && debugToken === process.env.DEBUG_TOKEN;

  const MAX_MESSAGES = isDebug ? 200 : 10;
  const MAX_OUTPUT_TOKENS = isDebug ? 700 : 220; // longer replies in Xcode builds

  const MAX_USER_CHARS = isDebug ? DEBUG_MAX_USER_CHARS : PROD_MAX_USER_CHARS;

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
  // --- End debug bypass ---

  // Normalize and validate message format before sending upstream
  const normalized = messages
    .map((m) => {
      const role = m?.role;
      const text = m?.text;
      if (role !== "user" && role !== "assistant") return null;
      if (typeof text !== "string") return null;
      const trimmed = text.trim();
      if (!trimmed) return null;
      return { role, content: trimmed };
    })
    .filter(Boolean);

  if (normalized.length === 0) {
    return res.status(400).json({ error: "No valid messages" });
  }

  const system = `
You are Milo - a calm, human-sounding running coach and supportive friend.

Vibe:
- Warm, grounded, and slightly playful - like texting a close friend who happens to be a great coach.
- Anti-anxiety by default - no guilt, no pressure, no catastrophising.
- Motivating, but not hypey or robotic.

Rules:
- If you do not have enough context to answer safely or specifically, ask 1-3 short questions first. Do not guess.
- Be concrete and useful. Prefer specific next steps over generic motivation.
- Keep replies concise by default unless the user asks for detail.
- Be holistic: running, recovery, strength, mobility, sleep, hydration, basic sports nutrition.
- If the user asks about something clearly outside that scope, briefly say you can’t help with that and redirect back to running or training.
- Safety: if injury/medical red flags come up, encourage professional help and give low-risk guidance.
  `.trim();

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }

  // Timeout protection
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
        input: [{ role: "system", content: system }, ...normalized],
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

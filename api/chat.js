export default async function handler(req, res) {
  // Allow preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.text;

  if (!lastUser) return res.status(400).json({ error: "No user message" });

  const system = `
You are Coach - calm, concise, and opinionated.
- Keep replies short (3-8 sentences).
- Prefer a simple 1-2-3 structure.
- Reduce performance anxiety.
- End with one clear question.
  `.trim();

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: lastUser },
      ],
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
}

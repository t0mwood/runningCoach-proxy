export const config = {
  runtime: "nodejs",
};

type ChatMessage = { role: "user" | "assistant"; text: string };

function json(res: any, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body: { messages?: ChatMessage[] } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find(m => m.role === "user")?.text;

  if (!lastUser) return json({ error: "No user message" }, 400);

  const system = `
You are Coach - calm, concise, and opinionated.
- Keep replies short (3–8 sentences).
- Prefer a simple 1-2-3 structure.
- Reduce performance anxiety.
- End with one clear question.
`.trim();

  const key = process.env.OPENAI_API_KEY;
  if (!key) return json({ error: "Missing OPENAI_API_KEY" }, 500);

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
        { role: "user", content: lastUser }
      ]
    }),
  });

  const data: any = await resp.json();
  const reply =
    data?.output?.[0]?.content?.[0]?.text ||
    data?.output_text ||
    "Sorry, I couldn’t reply.";

  return json({ reply });
}

/**
 * Vercel Edge Function — Yatri AI Proxy
 *
 * Keeps YATRI_AI_API_KEY on the server. The browser never sees it.
 * Set in Vercel dashboard → Project Settings → Environment Variables:
 *   YATRI_AI_BASE     = https://your-yatri-ai-server.com  (no trailing slash)
 *   YATRI_AI_API_KEY  = <your key>
 */
export const config = { runtime: "edge" };

const MERMAID_SYSTEM_CONTEXT = `You are a Mermaid.js diagram expert. Convert the user's description into a valid Mermaid diagram.

CRITICAL RULES:
- Output ONLY raw Mermaid syntax. No markdown fences, no explanations.
- Start directly with the diagram keyword (e.g. "flowchart TD").
- Node labels with special chars MUST be quoted: A["Label (with parens)"]
- Node IDs must NEVER match subgraph IDs — use CdnNode not CDN inside a CDN subgraph.
- Never redeclare a node that's already inside a subgraph.
- Never draw arrows to/from subgraph names, only to nodes.
- Subgraph IDs: alphanumeric, no spaces. Label in quotes: subgraph SL["Storage Layer"]`;

export default async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors(),
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  const YATRI_AI_BASE = process.env.YATRI_AI_BASE;
  const YATRI_AI_API_KEY = process.env.YATRI_AI_API_KEY;

  if (!YATRI_AI_BASE || !YATRI_AI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Yatri AI not configured on server" }),
      {
        status: 503,
        headers: { "Content-Type": "application/json", ...cors() },
      },
    );
  }

  let body: {
    message?: string;
    context?: string;
    stream?: boolean;
    messages?: { role: string; content: string }[];
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  // Convert TTD messages array → Yatri AI format if needed
  let message = body.message ?? "";
  let context = body.context ?? MERMAID_SYSTEM_CONTEXT;

  if (body.messages && body.messages.length > 0) {
    const msgs = body.messages;
    const last = msgs[msgs.length - 1];
    message = last.content;

    const history = msgs.slice(0, -1);
    const historyText = history
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    context = MERMAID_SYSTEM_CONTEXT + (historyText ? `\n\nConversation so far:\n${historyText}` : "");
  }

  let finalMessage = message;
  if (context.includes("Mermaid") || context.includes("diagram")) {
    finalMessage = `${context}\n\nUSER REQUEST: ${message}\n\nCRITICAL: Output ONLY the raw Mermaid code. Do not wrap in markdown code blocks or quotes. Start directly with the diagram keyword (e.g., flowchart TD). No explanations, no conversational text.`;
  }

  const upstream = await fetch(`${YATRI_AI_BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": YATRI_AI_API_KEY,
    },
    body: JSON.stringify({
      message: finalMessage,
      context,
      stream: body.stream !== false, // default to streaming
    }),
    // @ts-ignore — edge runtime signal
    signal: req.signal,
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "upstream error");
    return new Response(
      JSON.stringify({ error: text }),
      {
        status: upstream.status,
        headers: { "Content-Type": "application/json", ...cors() },
      },
    );
  }

  // Pass the stream straight through
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      "X-Accel-Buffering": "no",
      ...cors(),
    },
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

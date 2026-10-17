/**
 * Vercel Function — Yatri AI translation
 *
 * { text: string | string[], source?: "en", target: "hi" } -> { translations: string[] }
 * through the gateway's /v1/translate (Zia Text Translation).
 *
 * Environment: YATRI_AI_BASE, YATRI_AI_API_KEY (see chat.ts).
 */
export const maxDuration = 60;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });

export async function POST(req: Request): Promise<Response> {
  const base = process.env.YATRI_AI_BASE;
  const key = process.env.YATRI_AI_API_KEY;
  if (!base || !key) {
    return json(503, { error: "Yatri AI not configured on server" });
  }
  let body: { text?: unknown; source?: string; target?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const upstream = await fetch(`${base}/v1/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      text: body.text,
      source: body.source,
      target: body.target,
    }),
    signal: req.signal,
  });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return json(upstream.status, {
      error: data?.error?.message || `translation failed (${upstream.status})`,
    });
  }
  return json(200, { translations: data.translations ?? [] });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: cors() });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

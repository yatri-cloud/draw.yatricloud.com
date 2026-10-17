/**
 * Vercel Function — Yatri AI speech to text
 *
 * Forwards a recorded voice prompt (multipart, `file` field, plus an
 * optional `language` field) to the gateway's /v1/audio/transcriptions,
 * which uses the Zia Speech to Text model. Returns { text }.
 *
 * Environment: YATRI_AI_BASE, YATRI_AI_API_KEY (see chat.ts).
 */
export const maxDuration = 60;

const MAX_AUDIO = 4 * 1024 * 1024;

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
  const type = req.headers.get("content-type") || "";
  if (!type.startsWith("multipart/form-data")) {
    return json(400, { error: "send multipart/form-data with a `file` field" });
  }
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_AUDIO) {
    return json(413, { error: "Recording too long. Keep it under a minute." });
  }
  const upstream = await fetch(`${base}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { "Content-Type": type, Authorization: `Bearer ${key}` },
    body,
    signal: req.signal,
  });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return json(upstream.status, {
      error:
        data?.error?.message || `speech to text failed (${upstream.status})`,
    });
  }
  return json(200, { text: data.text ?? "" });
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

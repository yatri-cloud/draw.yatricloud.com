/**
 * Vercel Function — Yatri AI text to speech
 *
 * { input, voice, language, response_format } -> audio (mp3 by default)
 * through the gateway's /v1/audio/speech (Zia Text to Speech).
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
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const upstream = await fetch(`${base}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      input: String(body.input ?? "").slice(0, 5000),
      voice: body.voice,
      language: body.language,
      response_format: body.response_format ?? "mp3",
    }),
    signal: req.signal,
  });
  if (!upstream.ok) {
    const data = await upstream.json().catch(() => ({}));
    return json(upstream.status, {
      error:
        data?.error?.message || `text to speech failed (${upstream.status})`,
    });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
      ...cors(),
    },
  });
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

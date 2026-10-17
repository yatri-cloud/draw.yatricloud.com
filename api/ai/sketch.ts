/**
 * Vercel Edge Function — Yatri AI Sketch
 *
 * Turns a text prompt into a hand-drawn diagram spec (JSON) that the app lays out
 * and renders as Excalidraw elements. Calls the Yatri AI gateway's
 * OpenAI-compatible endpoint; the API key stays on the server.
 *
 * Environment (Vercel → Project Settings → Environment Variables):
 *   YATRI_AI_BASE     = https://your-yatri-ai-server.com  (no trailing slash)
 *   YATRI_AI_API_KEY  = <your key>
 */
import { DIAGRAM_INSTRUCTION, describeImages, imageList } from "./_vision";

export const maxDuration = 60;

const MAX_PROMPT_LENGTH = 4000;

const buildSystemPrompt = (
  iconNames: string[],
) => `You design clear, friendly hand-drawn explainer diagrams. Convert the user's request into ONE JSON object that follows this schema exactly. Output ONLY minified JSON on a single line: no indentation, no line breaks, no markdown fences, no comments, no explanations. Omit optional fields you do not use.

{
  "title": string,                      // short headline, 2 to 6 words
  "direction": "LR" | "TB",             // LR = left to right (default), TB = top to bottom
  "nodes": [                            // 2 to 14 nodes
    {
      "id": string,                     // short unique id, letters/digits/underscore
      "kind": "box" | "pill" | "icon" | "bubble" | "note",
      "label": string,                  // 1 to 4 words; for "bubble" a short question or quote; for "note" one short sentence
      "icon": string,                   // only for kind "icon": one of ICON_NAMES
      "logo": string,                   // optional: the real product or cloud service this node is, e.g. "AWS Lambda", "Amazon S3", "PostgreSQL", "Docker", "Stripe"
      "color": "blue" | "green" | "yellow" | "violet" | "red" | "orange" | "gray" | "teal" | "pink" | "none",
      "emphasis": boolean               // true for the 1 central/most important node
    }
  ],
  "edges": [ { "from": id, "to": id, "label": string (optional, 1 to 3 words), "style": "solid" | "dashed" } ],
  "groups": [ { "label": string, "members": [id, ...] } ],      // optional: nodes that belong together, e.g. a list of tools
  "chart": {                                                    // optional: ONLY when the request is about numbers over time or a comparison
    "kind": "bar",
    "caption": string,
    "data": [ { "label": string, "value": number, "display": string } ],
    "stat": { "value": string, "label": string }               // optional highlight number
  },
  "footer": string                      // optional one-line takeaway, under 10 words
}

Rules:
- Use kind "icon" for people, devices, documents, databases, clouds and other things that have an icon. Pick the closest ICON_NAMES entry.
- When a node is a specific product, company or cloud service the user named (AWS, Azure, Google Cloud services, Docker, Kubernetes, PostgreSQL, Redis, Stripe, GitHub, OpenAI and so on), set "logo" to its official name so the real logo is shown. Never invent products the user did not mention.
- Use "bubble" for something a person asks or says. Connect it with an edge from the speaker to the bubble.
- Use "pill" for small tags, tools or categories. Use "box" for systems and steps.
- Use color meaningfully: one accent for the central node, green for success or results, red for errors, gray for secondary items. Most nodes can be "none".
- Every edge must reference existing node ids. Keep the diagram simple and readable.
- If the request contains data series, put it in "chart" and keep nodes empty or minimal.

ICON_NAMES: ${iconNames.join(", ")}`;

const extractJSON = (text: string): unknown => {
  const unfenced = text.replace(/```[a-zA-Z]*/g, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("no JSON object in model output");
  }
  return JSON.parse(unfenced.slice(start, end + 1));
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });

export async function POST(req: Request): Promise<Response> {
  const YATRI_AI_BASE = process.env.YATRI_AI_BASE;
  const YATRI_AI_API_KEY = process.env.YATRI_AI_API_KEY;
  if (!YATRI_AI_BASE || !YATRI_AI_API_KEY) {
    return json(503, { error: "Yatri AI not configured on server" });
  }

  let body: { prompt?: string; icons?: string[]; images?: string[] };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  let prompt = (body.prompt ?? "").trim().slice(0, MAX_PROMPT_LENGTH);
  const images = imageList(body.images);
  if (!prompt && !images.length) {
    return json(400, { error: "prompt is required" });
  }
  if (images.length) {
    // the vision model reads the picture; the text model below draws from its description
    try {
      const description = await describeImages(
        images,
        DIAGRAM_INSTRUCTION,
        req.signal,
      );
      prompt = `Redraw the diagram in the attached image as faithfully as possible.\nIMAGE DESCRIPTION:\n${description}${
        prompt ? `\n\nUSER REQUEST: ${prompt}` : ""
      }`;
    } catch (err: any) {
      return json(502, { error: err.message });
    }
  }
  const iconNames = (Array.isArray(body.icons) ? body.icons : [])
    .filter(
      (name) => typeof name === "string" && /^[a-z0-9-]{1,40}$/.test(name),
    )
    .slice(0, 200);

  const messages = [
    { role: "system", content: buildSystemPrompt(iconNames) },
    { role: "user", content: prompt },
  ];

  let lastError = "";
  // One retry: the model occasionally returns truncated or malformed JSON.
  for (let attempt = 0; attempt < 2; attempt++) {
    const upstream = await fetch(`${YATRI_AI_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${YATRI_AI_API_KEY}`,
      },
      body: JSON.stringify({ messages }),
      // @ts-ignore — edge runtime signal
      signal: req.signal,
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "upstream error");
      return json(upstream.status, { error: text });
    }

    const data = await upstream.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    try {
      return json(200, { spec: extractJSON(content), usage: data?.usage });
    } catch (err: any) {
      lastError =
        data?.choices?.[0]?.finish_reason === "length"
          ? "the model's answer was cut off (raise Max Tokens on the QuickML endpoint)"
          : err.message;
    }
  }
  return json(502, { error: `Could not read the AI response: ${lastError}` });
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

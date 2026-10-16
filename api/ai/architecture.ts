/**
 * Vercel Edge Function — Yatri AI Architecture
 *
 * Turns a description of a system into a cloud architecture spec (JSON):
 * nested groups (cloud, region, VPC, subnets ...), services named by their
 * official product names, and labelled links. The app lays it out and draws
 * it with the official AWS / Azure / Google Cloud icons.
 *
 * Environment (Vercel → Project Settings → Environment Variables):
 *   YATRI_AI_BASE     = https://your-yatri-ai-server.com  (no trailing slash)
 *   YATRI_AI_API_KEY  = <your key>
 */
export const maxDuration = 60;

const MAX_PROMPT_LENGTH = 4000;

const SYSTEM_PROMPT = `You are a senior cloud architect. Convert the user's request into ONE cloud architecture diagram spec. Output ONLY minified JSON on a single line: no markdown fences, no comments, no explanations. Omit optional fields you do not use.

{
  "title": string,                               // 2 to 7 words
  "direction": "LR" | "TB",                      // LR for request flows left to right (default), TB for top-down tiers
  "groups": [                                    // containers; nest them with "parent"
    {
      "id": string,                              // letters/digits/underscore
      "type": "cloud" | "account" | "region" | "az" | "vpc" | "public_subnet" | "private_subnet" | "onprem" | "cluster" | "generic",
      "label": string,                           // e.g. "AWS Cloud", "us-east-1", "VPC 10.0.0.0/16", "Public subnet"
      "parent": string                           // optional: id of the enclosing group
    }
  ],
  "nodes": [                                     // 3 to 24 nodes
    {
      "id": string,
      "service": string,                         // official product name, e.g. "Amazon CloudFront", "Application Load Balancer", "Amazon ECS", "Azure Functions", "Cloud Run", "PostgreSQL", "Users", "Mobile app"
      "label": string,                           // optional short label shown under the icon when it differs from the service name
      "group": string                            // optional: id of the innermost group that contains it
    }
  ],
  "edges": [ { "from": id, "to": id, "label": string (optional, 1 to 4 words), "style": "solid" | "dashed", "bidirectional": boolean (optional) } ]
}

Rules:
- Nest groups the way the provider documents them: cloud > account > region > VPC > availability zone > subnet. Put each service in its innermost group; global services (Route 53, CloudFront, IAM, users, on-premises systems) stay outside regions.
- Use the provider's exact service names so official icons can be shown. Use "Users" or "Mobile app" or "Browser" for clients.
- Use "dashed" for replication, async events, backups and monitoring; "solid" for the request path.
- For multi-region or high-availability designs, mirror the same services in each region or availability zone.
- Every edge must reference existing node ids. Prefer clear, readable designs over exhaustive ones.`;

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

  let body: { prompt?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const prompt = (body.prompt ?? "").trim().slice(0, MAX_PROMPT_LENGTH);
  if (!prompt) {
    return json(400, { error: "prompt is required" });
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
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

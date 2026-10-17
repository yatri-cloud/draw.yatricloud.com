/**
 * Vercel Edge Function — Yatri AI Deck
 *
 * Turns a prompt or pasted content into a hand-drawn slide deck spec (JSON).
 * The AI server stops requests after about 30 seconds, so a deck is built in
 * two steps that the app calls in turn:
 *
 *   { action: "plan", content, slides }            -> { title, subtitle, slides: [{ layout, title }] }
 *   { action: "fill", content, plan, from, to }     -> { slides: [full slide spec, ...] }
 *
 * "fill" covers a few slides per call; the app runs several calls in parallel.
 *
 * Environment (Vercel → Project Settings → Environment Variables):
 *   YATRI_AI_BASE     = https://your-yatri-ai-server.com  (no trailing slash)
 *   YATRI_AI_API_KEY  = <your key>
 */
import { describeImages, imageList } from "./_vision.js";

export const maxDuration = 60;

const MAX_CONTENT_LENGTH = 12000;
const MIN_SLIDES = 3;
const MAX_SLIDES = 40;
const MAX_FILL = 4;

const LAYOUT_GUIDE = `- title: the opening slide (slide 1 only).
- hook: a provocative question or surprising fact that opens the story (usually slide 2).
- points: 3 to 5 short ideas, each with an icon.
- cards: 2 to 4 concepts side by side, each with a heading and one line.
- steps: a process in order (3 to 5 steps).
- timeline: things that happen over time, or phases with dates or stages.
- compare: two sides (before/after, myth/fact, A vs B, pros/cons).
- stat: one striking number the content gives or that is well known.
- quote: one memorable line, with who said it.
- statement: one big insight in a single sentence.
- diagram: how a few parts connect, drawn as a hand-drawn sketch.
- flow: a process with decisions or a request/response sequence, drawn as a flowchart.
- architecture: a cloud or software system (servers, databases, cloud services). Only for technical topics.
- logos: real tools, products or companies the content names (3 to 8).
- chart: numbers to compare (3 to 7 values).
- summary: the takeaways (last slide only).`;

const PLAN_PROMPT = `You plan presentation decks in the style of whiteboard explainer videos: one clear idea per slide, short punchy titles, a story that builds from the hook to the takeaway.

Plan a deck from the user's prompt or content. Output ONLY minified JSON on one line, no markdown fences, no comments:
{"title": string, "subtitle": string, "slides": [{"layout": string, "title": string}]}

Layouts:
${LAYOUT_GUIDE}

Rules:
- Exactly the requested number of slides. Slide 1 is "title"; the last slide is "summary".
- Every slide covers a DIFFERENT sub-topic. Never repeat or rephrase a title; for long decks, go deeper (history, how it works, parts, examples, mistakes, tips, comparisons, numbers, future) rather than repeating.
- Use many different layouts. Never the same layout twice in a row, and no layout more than a quarter of the deck. Use diagram, flow, architecture, chart, logos and timeline wherever the content fits them.
- Slide titles: 2 to 7 words, specific, in the language of the user's content.
- If the user pasted content, follow its structure and facts; never invent statistics.`;

const EXTEND_PROMPT = `You add slides to a planned presentation deck. Output ONLY minified JSON on one line: {"slides": [{"layout": string, "title": string}]}

Layouts:
${LAYOUT_GUIDE}

Rules:
- Add exactly the requested number of NEW slides, each on a sub-topic none of the existing titles covers. Never reuse or rephrase an existing title.
- Do not use "title" or "summary". Vary the layouts.`;

/** How the speaker notes should read, following github.com/blader/humanizer. */
const NOTES_STYLE = `Write "notes" like a person explaining out loud: plain words, specific facts, short and medium sentences, contractions are fine. Do not use these words: additionally, crucial, delve, deep dive, enhance, key (as an adjective), landscape, pivotal, robust, showcase, testament, underscore, vibrant, valuable, seamless, journey, unlock, game-changer. No "not only... but also", no "it's not X, it's Y", no lists of three for rhythm, no dramatic one-line closers, no rhetorical questions answered right away, no "in today's world", no sales language, no dashes as connectors.`;

const fillPrompt = (
  icons: string[],
) => `You write the slides of a whiteboard explainer deck. Fill in the requested slides of the planned deck. Output ONLY minified JSON on one line, no markdown fences, no comments:
{"slides": [SLIDE, ...]}  with one SLIDE per requested slide, in order, keeping its layout and title.

SLIDE fields (use only those for its layout; omit the rest):
{
 "layout": string, "title": string,
 "highlight": string,                        // 1 to 2 words copied exactly from the title, the key word to mark
 "subtitle": string,                         // title: one line under the title, under 12 words
 "question": string,                         // hook: the question or surprising fact, under 16 words
 "statement": string,                        // statement: the insight, under 18 words
 "points": [{"text": string, "icon": ICON, "logo": string}],  // points, steps, summary: 3 to 5 items under 12 words; "logo" only when the item is a real product or company
 "cards": [{"heading": string, "text": string, "icon": ICON, "logo": string}],  // cards: 2 to 4; heading 1 to 3 words, text under 12 words
 "timeline": [{"when": string, "text": string}],  // timeline: 3 to 6 entries; when is a year, date or stage, text under 10 words
 "left": {"heading": string, "points": [string]},  // compare: 2 to 4 points per side, each under 9 words
 "right": {"heading": string, "points": [string]},
 "stat": {"value": string, "label": string, "icon": ICON},  // stat: value MUST be a number with its unit, like "73%", "37x", "₹18,000"; label under 10 words
 "quote": {"text": string, "by": string},    // quote: under 25 words
 "logos": [{"name": string, "note": string}],  // logos: real product or company names exactly as written officially, note under 6 words
 "chart": {"caption": string, "data": [{"label": string, "value": number, "display": string}]},  // chart: 3 to 7 values
 "diagram": string,                          // diagram, flow, architecture: one or two sentences naming the 3 to 8 parts and how they connect
 "notes": string                             // every slide: 2 to 4 sentences the presenter says, adding detail beyond the slide text
}

Rules:
- Slide text is short and concrete. Detail goes in "notes".
- ICON is one of ICON_NAMES; pick the closest match.
- Use the facts of the user's content when it is given; do not invent statistics.
- Write in the language of the user's content.
- ${NOTES_STYLE}

ICON_NAMES: ${icons.join(", ")}`;

/** Titles that say the same thing: lower case, no punctuation, no filler words. */
const titleKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w &&
        ![
          "the",
          "a",
          "an",
          "of",
          "and",
          "to",
          "in",
          "how",
          "what",
          "is",
          "your",
        ].includes(w),
    )
    .join(" ");

const extractJSON = (text: string): any => {
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

type PlanSlide = { layout: string; title: string };
type Plan = { title: string; subtitle?: string; slides: PlanSlide[] };

export async function POST(req: Request): Promise<Response> {
  const YATRI_AI_BASE = process.env.YATRI_AI_BASE;
  const YATRI_AI_API_KEY = process.env.YATRI_AI_API_KEY;
  if (!YATRI_AI_BASE || !YATRI_AI_API_KEY) {
    return json(503, { error: "Yatri AI not configured on server" });
  }

  let body: {
    action?: string;
    content?: string;
    slides?: number;
    plan?: Plan;
    from?: number;
    to?: number;
    icons?: string[];
    images?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const content = (body.content ?? "").trim().slice(0, MAX_CONTENT_LENGTH);
  const images = imageList(body.images);
  if (!content && !(body.action === "plan" && images.length)) {
    return json(400, { error: "content is required" });
  }

  const ask = async (system: string, user: string) => {
    let lastError = "";
    // one retry: the model occasionally returns malformed or cut-off JSON
    for (let attempt = 0; attempt < 2; attempt++) {
      const upstream = await fetch(`${YATRI_AI_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${YATRI_AI_API_KEY}`,
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        // @ts-ignore — edge runtime signal
        signal: req.signal,
      });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "upstream error");
        throw Object.assign(new Error(text), { status: upstream.status });
      }
      const data = await upstream.json();
      try {
        return extractJSON(data?.choices?.[0]?.message?.content ?? "");
      } catch (err: any) {
        lastError =
          data?.choices?.[0]?.finish_reason === "length"
            ? "the answer was cut off (raise Max Tokens on the QuickML endpoint)"
            : err.message;
      }
    }
    throw Object.assign(
      new Error(`Could not read the AI response: ${lastError}`),
      {
        status: 502,
      },
    );
  };

  try {
    if (body.action === "plan") {
      let source = content;
      if (images.length) {
        // the vision model transcribes the images; the deck is written from that text
        const description = await describeImages(
          images,
          "Transcribe and explain the content of these images for someone writing a presentation about them: all headings, text, numbers, tables, charts with their values, and what each diagram shows. Keep the original language. Plain text, no markdown fences. Do not invent anything.",
          req.signal,
        );
        source = `${
          content ? `${content}\n\n` : ""
        }FROM THE ATTACHED IMAGES:\n${description}`.slice(
          0,
          MAX_CONTENT_LENGTH,
        );
      }
      const count = Math.min(
        MAX_SLIDES,
        Math.max(MIN_SLIDES, Math.round(Number(body.slides) || 10)),
      );
      const plan = await ask(
        PLAN_PROMPT,
        `Number of slides: ${count}\n\nPROMPT OR CONTENT:\n${source}`,
      );
      // the model sometimes repeats slides in long decks: drop repeats, then ask for new ones
      const seen = new Set<string>();
      const unique = (list: PlanSlide[]) =>
        (Array.isArray(list) ? list : []).filter((slide) => {
          const key = titleKey(String(slide?.title ?? ""));
          if (!key || seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
      let slides = unique(plan?.slides);
      const summary =
        slides.length > 2 && slides[slides.length - 1].layout === "summary"
          ? slides.pop()
          : undefined;
      for (let round = 0; round < 2 && slides.length + 1 < count; round++) {
        const missing = count - 1 - slides.length;
        const more = await ask(
          EXTEND_PROMPT,
          `Deck: ${plan?.title}\nExisting slides:\n${slides
            .map((s) => `- ${s.title}`)
            .join(
              "\n",
            )}\n\nAdd ${missing} new slides.\n\nPROMPT OR CONTENT:\n${source}`,
        ).catch(() => null);
        slides = [...slides, ...unique(more?.slides ?? []).slice(0, missing)];
      }
      // exactly the requested count, the summary kept last
      slides = slides.slice(0, summary ? count - 1 : count);
      if (summary) {
        slides.push(summary);
      }
      // the app sends `source` back with each "fill" call so the slides see the image text too
      return json(200, { plan: { ...plan, slides }, source });
    }

    if (body.action === "fill") {
      const plan = body.plan;
      const from = Math.max(0, Number(body.from) || 0);
      const to = Math.min(
        plan?.slides?.length ?? 0,
        Number(body.to) || 0,
        from + MAX_FILL,
      );
      if (!plan || !Array.isArray(plan.slides) || to <= from) {
        return json(400, { error: "plan, from and to are required" });
      }
      const icons = Array.isArray(body.icons)
        ? body.icons.filter((i) => typeof i === "string").slice(0, 120)
        : [];
      const outline = plan.slides
        .map((s, i) => `${i + 1}. [${s.layout}] ${s.title}`)
        .join("\n");
      const wanted = plan.slides
        .slice(from, to)
        .map((s, i) => `${from + i + 1}. [${s.layout}] ${s.title}`)
        .join("\n");
      const result = await ask(
        fillPrompt(icons),
        `DECK: ${plan.title}${
          plan.subtitle ? ` — ${plan.subtitle}` : ""
        }\nFULL PLAN:\n${outline}\n\nWRITE ONLY THESE SLIDES:\n${wanted}\n\nPROMPT OR CONTENT:\n${content}`,
      );
      return json(200, { slides: result?.slides ?? [] });
    }

    return json(400, { error: 'action must be "plan" or "fill"' });
  } catch (err: any) {
    return json(err.status || 500, { error: err.message || "AI error" });
  }
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

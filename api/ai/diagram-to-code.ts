/**
 * Vercel Edge Function — Yatri AI Wireframe to code
 *
 * Turns a wireframe drawn inside a "Wireframe to code" frame into one
 * self-contained HTML page. The app sends the frame's shapes as a text
 * outline (position, size, label, nesting), so a text-only model can rebuild
 * the layout. Returns { html }.
 *
 * The AI server cuts requests off after about 30 seconds, which is not enough
 * for a whole styled page. So the page ships its own design system (CSS and a
 * little JS below), the outline is split into horizontal bands, and the model
 * writes only the markup of each band, all bands in parallel. A band that
 * still fails is drawn straight from its shapes, so a page always comes back.
 *
 * Environment (Vercel → Project Settings → Environment Variables):
 *   YATRI_AI_BASE     = https://your-yatri-ai-server.com  (no trailing slash)
 *   YATRI_AI_API_KEY  = <your key>
 */
import { describeImages, imageList } from "./_vision.js";

export const maxDuration = 60;

const MAX_LAYOUT_LENGTH = 16000;
/** outline lines per request; keeps each answer well inside the time limit */
const PART_LINES = 18;
const MAX_PARTS = 6;

// ─── Design system the generated markup uses ────────────────────────────────

const KIT_CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{--bg:#f7f8fa;--surface:#fff;--text:#1d2433;--muted:#5d6779;--border:#e3e6ec;--primary:#4f46e5;--primary-text:#fff;--accent:#eef0ff;--shadow:0 1px 2px rgba(16,24,40,.06),0 4px 16px rgba(16,24,40,.06);--radius:12px}
[data-theme=dark]{--bg:#0f1117;--surface:#171a23;--text:#e8eaf0;--muted:#9aa3b5;--border:#2a2f3d;--primary:#818cf8;--primary-text:#0f1117;--accent:#1f2333;--shadow:0 1px 2px rgba(0,0,0,.4),0 4px 16px rgba(0,0,0,.3)}
html,body{margin:0}
body{font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text)}
a{color:inherit;text-decoration:none}
img,svg{display:block;max-width:100%}
.container{width:100%;max-width:1200px;margin:0 auto;padding:0 24px}
.section{padding:40px 0}
.row{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.between{justify-content:space-between}
.center{justify-content:center;text-align:center;align-items:center}
.end{justify-content:flex-end}
.stack{display:flex;flex-direction:column;gap:16px}
.stack-sm{display:flex;flex-direction:column;gap:8px}
.grow{flex:1 1 0;min-width:0}
.grid-2,.grid-3,.grid-4{display:grid;gap:24px}
.grid-2{grid-template-columns:repeat(2,1fr)}
.grid-3{grid-template-columns:repeat(3,1fr)}
.grid-4{grid-template-columns:repeat(4,1fr)}
.layout-sidebar{display:grid;grid-template-columns:260px 1fr;gap:24px;align-items:start}
.h1{font-size:clamp(32px,5vw,52px);line-height:1.1;font-weight:800;letter-spacing:-.02em;margin:0}
.h2{font-size:clamp(24px,3vw,34px);line-height:1.2;font-weight:750;margin:0}
.h3{font-size:20px;font-weight:700;margin:0}
.lead{font-size:19px;color:var(--muted);margin:0}
.muted{color:var(--muted)}
.small{font-size:14px}
p{margin:0}
.navbar{position:sticky;top:0;z-index:10;background:var(--surface);border-bottom:1px solid var(--border)}
.navbar .container{display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:68px}
.brand{font-weight:800;font-size:20px;display:flex;align-items:center;gap:10px}
.nav-links{display:flex;gap:24px;align-items:center}
.nav-links a{color:var(--muted);font-weight:500}
.nav-links a:hover,.nav-links a.active{color:var(--text)}
.hero{padding:72px 0;text-align:center}
.hero .stack{align-items:center}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 18px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-weight:600;cursor:pointer;transition:transform .15s,box-shadow .15s,background .15s}
.btn:hover{transform:translateY(-1px);box-shadow:var(--shadow)}
.btn-primary{background:var(--primary);border-color:var(--primary);color:var(--primary-text)}
.btn-ghost{background:transparent;border-color:transparent}
.btn-lg{padding:14px 24px;font-size:17px}
.input,input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=submit]):not([type=button]),select,textarea{width:100%;padding:11px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font:inherit}
.input:focus,input:focus,select:focus,textarea:focus{outline:2px solid var(--primary);outline-offset:1px}
label{font-weight:600;font-size:14px}
.row>input,.row>.input,.row>select{flex:1 1 220px;width:auto}
.row>form{flex:1 1 320px}
.stack>.btn,.stack-sm>.btn{align-self:flex-start}
.hero .stack>.btn,.center>.btn,.stack.center>.btn{align-self:center}
.hero form{max-width:520px;width:100%;margin:0 auto}
.btn.menu-btn{display:none}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow);transition:transform .15s,box-shadow .15s}
a.card:hover,.card.clickable:hover{transform:translateY(-3px);cursor:pointer}
.media{border-radius:10px;min-height:160px;background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--primary) 35%,var(--accent)))}
.avatar{width:44px;height:44px;border-radius:50%;flex:none;background:linear-gradient(135deg,var(--primary),#ec4899)}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;background:var(--accent);color:var(--primary);font-size:13px;font-weight:600}
.divider{border:0;border-top:1px solid var(--border);margin:0}
.list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.table{width:100%;border-collapse:collapse;background:var(--surface);border-radius:var(--radius);overflow:hidden}
.table th,.table td{padding:12px 16px;border-bottom:1px solid var(--border);text-align:left}
.table th{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.sidebar{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.sidebar a{display:block;padding:9px 12px;border-radius:8px;color:var(--muted)}
.sidebar a:hover,.sidebar a.active{background:var(--accent);color:var(--text)}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--border)}
.tabs [data-tab]{padding:10px 16px;border:0;background:none;color:var(--muted);font:inherit;font-weight:600;cursor:pointer;border-bottom:2px solid transparent}
.tabs [data-tab].active{color:var(--text);border-color:var(--primary)}
[data-panel][hidden]{display:none}
.footer{border-top:1px solid var(--border);padding:32px 0;color:var(--muted);font-size:14px}
dialog.modal{border:0;border-radius:16px;padding:24px;max-width:520px;width:calc(100% - 32px);background:var(--surface);color:var(--text);box-shadow:0 20px 60px rgba(0,0,0,.3)}
dialog.modal::backdrop{background:rgba(15,17,23,.5)}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:10px 18px;border-radius:10px;font-weight:600}
.wf-placeholder{border:2px dashed var(--border);border-radius:10px;padding:16px;color:var(--muted)}
@media (max-width:820px){
.grid-3,.grid-4{grid-template-columns:repeat(2,1fr)}
.layout-sidebar{grid-template-columns:1fr}
.nav-links{display:none;position:absolute;top:68px;left:0;right:0;flex-direction:column;align-items:flex-start;padding:16px 24px;background:var(--surface);border-bottom:1px solid var(--border)}
.nav-links.open{display:flex}
.btn.menu-btn{display:inline-flex}
}
@media (max-width:560px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}.section{padding:28px 0}.hero{padding:48px 0}}
`;

const KIT_JS = `
document.addEventListener("click",function(e){
  var t=e.target.closest("[data-open],[data-close],[data-toggle],[data-tab]");
  if(!t)return;
  if(t.dataset.open){var d=document.getElementById(t.dataset.open);
    if(!d){d=document.createElement("dialog");d.className="modal";d.id=t.dataset.open;var h=document.createElement("h3");h.className="h3";h.textContent=(t.querySelector("h1,h2,h3,h4")||t).textContent.trim().slice(0,80);var p=document.createElement("p");p.className="muted";p.style.margin="12px 0 20px";p.textContent="Details coming soon.";var c=document.createElement("button");c.className="btn";c.setAttribute("data-close","");c.textContent="Close";d.append(h,p,c);document.body.appendChild(d);}
    if(d.showModal){e.preventDefault();d.showModal();}}
  if(t.hasAttribute("data-close")){var m=t.closest("dialog");if(m)m.close();}
  if(t.dataset.toggle){var x=document.getElementById(t.dataset.toggle);if(x)x.classList.toggle("open");}
  if(t.dataset.tab){var g=t.closest("[data-tabs]")||document;g.querySelectorAll("[data-tab]").forEach(function(b){b.classList.toggle("active",b===t);});g.querySelectorAll("[data-panel]").forEach(function(p){p.hidden=p.dataset.panel!==t.dataset.tab;});}
});
document.addEventListener("submit",function(e){e.preventDefault();var n=document.createElement("div");n.className="toast";n.textContent="Submitted";document.body.appendChild(n);setTimeout(function(){n.remove();},1800);});
document.querySelectorAll("[data-tabs]").forEach(function(g){var f=g.querySelector("[data-tab]");if(f)f.click();});
`;

const SYSTEM_PROMPT = `You are a senior front-end developer turning a wireframe into a real web page, one part at a time.

You get an overview of the whole page and then the part you must write. Each shape in the outline has its position and size in pixels inside the frame, its label, and the shapes nested inside it. Rebuild your part faithfully: same elements, same order, same arrangement (things side by side stay side by side), labels used as the real copy. Decide what each shape is: a wide bar at the top is a navigation bar, small labelled boxes are buttons, boxes labelled like a field ("email", "search", "password") are inputs, big empty boxes are image areas, repeated equal boxes are cards in a grid, a tall box at the side is a sidebar.

Text outside the shapes that reads like an instruction (for example "add a nav bar", "cards open a modal") is a designer note: follow it, never show it on the page.

Write ONLY HTML elements for your part (no <html>, <head>, <body>, <style> or <script>), using these ready-made CSS classes:
- Wrappers: every part is one or more <header class="navbar">, <section class="section"> or <footer class="footer">, each with <div class="container"> inside. Use <section class="hero"> for a big centred intro.
- Layout: row (horizontal flex, wraps), between, center, end, stack and stack-sm (vertical), grow, grid-2, grid-3, grid-4, layout-sidebar (sidebar plus main).
- Text: h1, h2, h3 (as classes on h1/h2/h3/p), lead, muted, small.
- Navigation: inside .navbar's container put <a class="brand">, <nav class="nav-links" id="nav"> with <a> links, and <button class="btn btn-ghost menu-btn" data-toggle="nav">Menu</button>.
- Controls: btn, btn-primary, btn-ghost, btn-lg; input (also for select and textarea); wrap fields in <form class="stack">.
- Content: card (add class clickable when it opens something), media (image area, give it a height), avatar, badge, divider, list, table, sidebar (with <a> links), tabs.
- Interactions without writing JavaScript: <button data-open="ID"> opens <dialog class="modal" id="ID">, a <button data-close> inside closes it; <button data-toggle="ID"> shows or hides an element; tabs are <div data-tabs><div class="tabs"><button data-tab="a">A</button>...</div><div data-panel="a">...</div>...</div>.
- For an icon, use a small inline <svg> of 20x20.

Output only the HTML for your part. No markdown fences, no explanations. Keep it compact.`;

// ─── Outline handling ────────────────────────────────────────────────────────

type Block = { lines: string[]; top: number; bottom: number };

const GEOMETRY = /at \((-?\d+),(-?\d+)\) (\d+)x(\d+)/;

/** Top-level items of the outline, each with the lines nested under it. */
const topLevelBlocks = (lines: string[]): Block[] => {
  const blocks: Block[] = [];
  for (const line of lines) {
    if (line.startsWith("- ")) {
      const m = line.match(GEOMETRY);
      const top = m ? Number(m[2]) : blocks.at(-1)?.top ?? 0;
      const bottom = m ? top + Number(m[4]) : blocks.at(-1)?.bottom ?? top;
      blocks.push({ lines: [line], top, bottom });
    } else if (blocks.length) {
      blocks[blocks.length - 1].lines.push(line);
    }
  }
  return blocks;
};

/** A block that holds most of the page (an outer page box) is opened up into its children. */
const unwrap = (blocks: Block[], limit: number): Block[] =>
  blocks.flatMap((block) => {
    if (block.lines.length <= limit || block.lines.length < 2) {
      return [block];
    }
    const children = block.lines
      .slice(1)
      .map((line) => (line.startsWith("  ") ? line.slice(2) : line));
    return unwrap(topLevelBlocks(children), limit);
  });

const NOTE_WORDS =
  /\b(should|when|opens?|add|make|use|links? to|click(ed|ing)?|hover|navigates?|goes to|shows?|hides?|modal|popup|pop-up|dropdown|sticky|responsive|theme|animate)\b/i;

/** Free text that reads like an instruction to the developer, not page copy. */
const isNote = (block: Block) => {
  const text = block.lines[0].match(/^- text\b.*?: "(.*)"$/)?.[1];
  return (
    block.lines.length === 1 &&
    !!text &&
    text.split(/\s+/).length >= 4 &&
    NOTE_WORDS.test(text)
  );
};

/** Groups blocks that overlap vertically (one visual row), then packs rows into parts. */
const splitIntoParts = (layout: string) => {
  const [header, ...rest] = layout.split("\n");
  const all = unwrap(topLevelBlocks(rest), PART_LINES).sort(
    (a, b) => a.top - b.top,
  );
  const notes = all
    .filter(isNote)
    .map((b) => b.lines[0].match(/: "(.*)"$/)![1]);
  const blocks = all.filter((b) => !isNote(b));
  const bands: Block[] = [];
  for (const block of blocks) {
    const band = bands.at(-1);
    if (band && block.top < band.bottom - 4) {
      band.lines.push(...block.lines);
      band.bottom = Math.max(band.bottom, block.bottom);
    } else {
      bands.push({ ...block, lines: [...block.lines] });
    }
  }
  const total = bands.reduce((n, b) => n + b.lines.length, 0);
  const perPart = Math.max(PART_LINES, Math.ceil(total / MAX_PARTS));
  const parts: string[][] = [];
  for (const band of bands) {
    const part = parts.at(-1);
    if (part && part.length + band.lines.length <= perPart) {
      part.push(...band.lines);
    } else {
      parts.push([...band.lines]);
    }
  }
  const overview = [header, ...blocks.map((b) => b.lines[0])].join("\n");
  return { overview, notes, parts: parts.map((p) => p.join("\n")) };
};

const escapeHTML = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!),
  );

/** Draws a part straight from its shapes when the AI could not. */
const fallbackPart = (part: string) => {
  const items = part
    .split("\n")
    .map((line) => {
      const label = line.match(/"([^"]+)"/)?.[1];
      const size = line.match(GEOMETRY);
      const h = size ? Number(size[4]) : 0;
      if (/^\s*- text\b/.test(line) && label) {
        return /font (2[4-9]|[3-9]\d)px/.test(line)
          ? `<h2 class="h2">${escapeHTML(label)}</h2>`
          : `<p>${escapeHTML(label)}</p>`;
      }
      if (/^\s*- (rectangle|ellipse|diamond)/.test(line)) {
        if (label && h && h <= 64) {
          return `<button class="btn">${escapeHTML(label)}</button>`;
        }
        return label
          ? `<div class="card">${escapeHTML(label)}</div>`
          : `<div class="media" style="min-height:${Math.min(
              Math.max(h, 80),
              320,
            )}px"></div>`;
      }
      return "";
    })
    .filter(Boolean);
  return `<section class="section"><div class="container stack">${items.join(
    "",
  )}</div></section>`;
};

/** Keeps only the markup: drops fences, prose and any document wrapper. */
const cleanFragment = (text: string) => {
  let html = text.replace(/```[a-zA-Z]*\n?/g, "").trim();
  const body = html.match(/<body\b[^>]*>([\s\S]*?)(<\/body>|$)/i);
  if (body) {
    html = body[1];
  }
  html = html
    .replace(/<!DOCTYPE[^>]*>|<\/?(html|head|body)\b[^>]*>/gi, "")
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<title>[\s\S]*?<\/title>|<meta[^>]*>/gi, "");
  const start = html.indexOf("<");
  const end = html.lastIndexOf(">");
  return start === -1 || end < start ? "" : html.slice(start, end + 1).trim();
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
    return json(503, { message: "Yatri AI not configured on server" });
  }

  let body: { layout?: string; theme?: string; image?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { message: "Invalid JSON body" });
  }
  const layout = (body.layout ?? "").trim().slice(0, MAX_LAYOUT_LENGTH);
  if (!layout || !layout.includes("\n- ")) {
    return json(400, {
      message: "The wireframe is empty. Draw inside the frame and try again.",
    });
  }

  const { overview, notes, parts } = splitIntoParts(layout);

  // When the gateway has a vision model, it looks at the drawing itself and
  // catches what the outline misses: scribbled icons, pasted screenshots,
  // arrows and the overall style. Without one, the outline is enough.
  const images = imageList(body.image);
  const seen = images.length
    ? await describeImages(
        images,
        "This is a hand-drawn UI wireframe. Describe it for the developer who will build it: the page type, each region from top to bottom (and left to right) with what it contains, which elements are buttons, inputs, images, icons (say what each icon shows), cards, lists or charts, any screenshots pasted in, and any handwritten notes or arrows that explain behaviour. Be concrete and brief. Plain text.",
        req.signal,
      ).catch(() => "")
    : "";
  const seenText = seen
    ? `\n\nWHAT THE WIREFRAME LOOKS LIKE (from the image; use it to understand icons, images and notes):\n${seen.slice(
        0,
        3000,
      )}`
    : "";
  const noteText = notes.length
    ? `\n\nDESIGNER NOTES (follow them where they apply to your part; never show them on the page):\n${notes
        .map((n) => `- ${n}`)
        .join("\n")}`
    : "";

  const writePart = async (part: string, index: number) => {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `PAGE OVERVIEW (context only):\n${overview}${seenText}${noteText}\n\nWRITE PART ${
          index + 1
        } OF ${parts.length}:\n${part}`,
      },
    ];
    // one retry: the model occasionally times out or answers with prose
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
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
        if (upstream.ok) {
          const data = await upstream.json();
          const html = cleanFragment(
            data?.choices?.[0]?.message?.content ?? "",
          );
          if (html) {
            return { html, ai: true };
          }
        }
      } catch {
        // falls through to the retry, then to the shape-based fallback
      }
    }
    return { html: fallbackPart(part), ai: false };
  };

  const written = await Promise.all(parts.map(writePart));
  if (!written.some((part) => part.ai)) {
    return json(502, {
      message:
        "The AI did not answer in time. Try again, or split the wireframe into smaller frames.",
    });
  }

  const title = escapeHTML(
    overview.match(/^Frame "([^"]*)"/)?.[1] || "Wireframe",
  );
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="${body.theme === "dark" ? "dark" : "light"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${KIT_CSS}</style>
</head>
<body>
${written.map((part) => part.html).join("\n")}
<script>${KIT_JS}</script>
</body>
</html>`;
  return json(200, { html });
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

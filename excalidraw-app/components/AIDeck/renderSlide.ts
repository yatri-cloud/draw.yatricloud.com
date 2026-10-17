import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { FONT_FAMILY, randomId, randomInteger } from "@excalidraw/common";
import { getCommonBounds, newFrameElement } from "@excalidraw/element";
import {
  logoImage,
  matchLogo,
} from "@excalidraw/excalidraw/components/TTDDialog/logos";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";
import type { LogoBundle } from "@excalidraw/excalidraw/components/TTDDialog/logos";

import { resolveIcon } from "../AISketch/renderSketch";

import type { IconBundle } from "../AISketch/renderSketch";

// ─── Spec: what the model returns (see api/ai/deck.ts) ──────────────────────

export const SLIDE_LAYOUTS = [
  "title",
  "hook",
  "points",
  "cards",
  "steps",
  "timeline",
  "compare",
  "stat",
  "quote",
  "statement",
  "diagram",
  "flow",
  "architecture",
  "logos",
  "chart",
  "summary",
] as const;
export type SlideLayout = typeof SLIDE_LAYOUTS[number];
/** layouts drawn by another AI feature (AI Sketch, Text to diagram, AI Architecture) */
export const VISUAL_LAYOUTS: readonly SlideLayout[] = [
  "diagram",
  "flow",
  "architecture",
];

export type SlidePoint = { text: string; icon?: string; logo?: string };
export type SlideCard = {
  heading: string;
  text: string;
  icon?: string;
  logo?: string;
};
export type Slide = {
  layout: SlideLayout;
  title: string;
  highlight?: string;
  subtitle?: string;
  question?: string;
  statement?: string;
  points: SlidePoint[];
  cards: SlideCard[];
  timeline: { when: string; text: string }[];
  left?: { heading: string; points: string[] };
  right?: { heading: string; points: string[] };
  stat?: { value: string; label: string; icon?: string };
  quote?: { text: string; by?: string };
  logos: { name: string; note?: string }[];
  chart?: {
    caption?: string;
    data: { label: string; value: number; display: string }[];
  };
  diagram?: string;
  notes: string;
};
export type DeckPlan = {
  title: string;
  subtitle?: string;
  slides: { layout: SlideLayout; title: string }[];
};

const str = (value: unknown, max = 200) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);

const layoutOf = (value: unknown): SlideLayout =>
  (SLIDE_LAYOUTS as readonly string[]).includes(value as string)
    ? (value as SlideLayout)
    : "points";

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

export const normalizePlan = (raw: any, count: number): DeckPlan => {
  // never show the same slide twice, whatever the model returned
  const seen = new Set<string>();
  const slides = list(raw?.slides)
    .map((s: any) => ({
      layout: layoutOf(s?.layout),
      title: str(s?.title, 90),
    }))
    .filter((s) => {
      const key = titleKey(s.title);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, count);
  if (!slides.length) {
    throw new Error("The AI did not return a slide plan. Try again.");
  }
  const title = str(raw?.title, 120) || slides[0].title;
  slides[0] = { layout: "title", title: slides[0].title || title };
  if (slides.length > 2) {
    slides[slides.length - 1].layout = "summary";
  }
  // keep the deck varied: never the same layout twice in a row
  const fallbacks: SlideLayout[] = ["points", "cards", "statement", "steps"];
  for (let i = 2; i < slides.length - 1; i++) {
    if (slides[i].layout === slides[i - 1].layout) {
      slides[i].layout =
        fallbacks.find(
          (l) => l !== slides[i - 1].layout && l !== slides[i + 1]?.layout,
        ) ?? "points";
    }
  }
  return { title, subtitle: str(raw?.subtitle, 160) || undefined, slides };
};

const side = (raw: any) =>
  raw && typeof raw === "object"
    ? {
        heading: str(raw.heading, 60),
        points: list(raw.points)
          .map((p: unknown) => str(p, 90))
          .filter(Boolean)
          .slice(0, 5),
      }
    : undefined;

/** Fills gaps so every slide can be drawn, whatever the model left out. */
export const normalizeSlide = (
  raw: any,
  planned: { layout: SlideLayout; title: string },
): Slide => {
  const title = str(raw?.title, 90) || planned.title;
  const points: SlidePoint[] = list(raw?.points)
    .map((p: any) =>
      typeof p === "string"
        ? { text: str(p, 110) }
        : {
            text: str(p?.text, 110),
            icon: str(p?.icon, 40) || undefined,
            logo: str(p?.logo, 60) || undefined,
          },
    )
    .filter((p: SlidePoint) => p.text)
    .slice(0, 6);
  const chartData = list(raw?.chart?.data)
    .map((d: any) => ({
      label: str(d?.label, 30),
      value: Number(d?.value),
      display: str(d?.display, 16) || String(d?.value ?? ""),
    }))
    .filter((d) => d.label && Number.isFinite(d.value))
    .slice(0, 8);
  const slide: Slide = {
    layout: planned.layout,
    title,
    highlight: str(raw?.highlight, 40) || undefined,
    subtitle: str(raw?.subtitle, 160) || undefined,
    question: str(raw?.question, 160) || undefined,
    statement: str(raw?.statement, 200) || undefined,
    points,
    cards: list(raw?.cards)
      .map((c: any) => ({
        heading: str(c?.heading, 40),
        text: str(c?.text, 110),
        icon: str(c?.icon, 40) || undefined,
        logo: str(c?.logo, 60) || undefined,
      }))
      .filter((c) => c.heading || c.text)
      .slice(0, 4),
    timeline: list(raw?.timeline)
      .map((t: any) => ({ when: str(t?.when, 24), text: str(t?.text, 90) }))
      .filter((t) => t.when || t.text)
      .slice(0, 6),
    left: side(raw?.left),
    right: side(raw?.right),
    stat:
      raw?.stat && str(raw.stat.value, 24)
        ? {
            value: str(raw.stat.value, 24),
            label: str(raw.stat.label, 100),
            icon: str(raw.stat.icon, 40) || undefined,
          }
        : undefined,
    quote:
      raw?.quote && str(raw.quote.text, 260)
        ? {
            text: str(raw.quote.text, 260),
            by: str(raw.quote.by, 60) || undefined,
          }
        : undefined,
    logos: list(raw?.logos)
      .map((l: any) =>
        typeof l === "string"
          ? { name: str(l, 50) }
          : { name: str(l?.name, 50), note: str(l?.note, 60) || undefined },
      )
      .filter((l) => l.name)
      .slice(0, 8),
    chart:
      chartData.length >= 2
        ? {
            caption: str(raw?.chart?.caption, 80) || undefined,
            data: chartData,
          }
        : undefined,
    diagram: str(raw?.diagram, 500) || undefined,
    notes: str(raw?.notes, 1500),
  };
  // a layout whose own fields are missing becomes a list of points
  const usable: Record<SlideLayout, boolean> = {
    title: true,
    hook: !!(slide.question || slide.statement),
    points: points.length > 0,
    steps: points.length > 1,
    summary: points.length > 0,
    cards: slide.cards.length > 1 || points.length > 1,
    timeline: slide.timeline.length > 1,
    compare: !!(slide.left?.points.length && slide.right?.points.length),
    stat: !!slide.stat,
    quote: !!slide.quote,
    statement: !!(slide.statement || slide.question),
    diagram: !!slide.diagram,
    flow: !!slide.diagram,
    architecture: !!slide.diagram,
    logos: slide.logos.length > 1,
    chart: !!slide.chart,
  };
  if (!usable[slide.layout]) {
    slide.layout = "points";
    if (!slide.points.length) {
      const fromCards = slide.cards.map((c) => ({
        text: [c.heading, c.text].filter(Boolean).join(": "),
        icon: c.icon,
      }));
      slide.points = fromCards.length
        ? fromCards
        : (slide.notes.match(/[^.!?]+[.!?]/g) ?? [slide.title])
            .slice(0, 4)
            .map((s) => ({ text: str(s, 110) }));
    }
  }
  return slide;
};

/** Plain-text lines of a slide, for speaker notes, guides and Markdown. */
export const slideLines = (slide: Slide): string[] => {
  const lines: string[] = [];
  if (slide.subtitle) {
    lines.push(slide.subtitle);
  }
  if (slide.question) {
    lines.push(slide.question);
  }
  if (slide.statement) {
    lines.push(slide.statement);
  }
  lines.push(...slide.points.map((p) => `- ${p.text}`));
  lines.push(
    ...slide.cards.map(
      (c) => `- ${[c.heading, c.text].filter(Boolean).join(": ")}`,
    ),
  );
  lines.push(...slide.timeline.map((t) => `- ${t.when}: ${t.text}`));
  if (slide.left && slide.right) {
    lines.push(
      `${slide.left.heading}:`,
      ...slide.left.points.map((p) => `- ${p}`),
    );
    lines.push(
      `${slide.right.heading}:`,
      ...slide.right.points.map((p) => `- ${p}`),
    );
  }
  if (slide.stat) {
    lines.push(`${slide.stat.value}: ${slide.stat.label}`);
  }
  if (slide.quote) {
    lines.push(
      `"${slide.quote.text}"${slide.quote.by ? ` (${slide.quote.by})` : ""}`,
    );
  }
  lines.push(
    ...slide.logos.map((l) => `- ${l.name}${l.note ? `: ${l.note}` : ""}`),
  );
  if (slide.chart) {
    lines.push(...slide.chart.data.map((d) => `- ${d.label}: ${d.display}`));
  }
  if (slide.diagram) {
    lines.push(slide.diagram);
  }
  return lines;
};

// ─── Theme: a different look for every generated deck ───────────────────────

export type DeckTheme = {
  accent: string;
  accentFill: string;
  paper: string;
  /** how the title's key word is marked */
  mark: "squiggle" | "marker" | "circle";
  titleAlign: "left" | "center";
  /** offset into the pastel palette, so cards and steps change colour too */
  shift: number;
  /** picks layout variants; seeded per deck */
  random: () => number;
};

const ACCENTS = [
  { accent: "#e03131", fill: "#ffc9c9" },
  { accent: "#1971c2", fill: "#a5d8ff" },
  { accent: "#2f9e44", fill: "#b2f2bb" },
  { accent: "#6741d9", fill: "#d0bfff" },
  { accent: "#e8590c", fill: "#ffd8a8" },
  { accent: "#0c8599", fill: "#99e9f2" },
  { accent: "#c2255c", fill: "#fcc2d7" },
];
const PAPERS = ["#ffffff", "#fffdf6", "#fbfcff", "#fffaf3"];

/** A small seeded random generator (mulberry32). */
const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const makeTheme = (
  seed = Math.floor(Math.random() * 2 ** 31),
): DeckTheme => {
  const random = seeded(seed);
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(random() * items.length)];
  const accent = pick(ACCENTS);
  return {
    accent: accent.accent,
    accentFill: accent.fill,
    paper: pick(PAPERS),
    mark: pick(["squiggle", "marker", "circle"] as const),
    titleAlign: random() < 0.7 ? "left" : "center",
    shift: Math.floor(random() * 6),
    random,
  };
};

// ─── Look ────────────────────────────────────────────────────────────────────

export const SLIDE_W = 1600;
export const SLIDE_H = 900;
const PAD = 90;
const INK = "#1e1e1e";
const MUTED = "#6b7280";
const FONT = FONT_FAMILY.Excalifont;
const FILLS = [
  "#a5d8ff",
  "#ffec99",
  "#b2f2bb",
  "#ffc9c9",
  "#d0bfff",
  "#ffd8a8",
];
const STROKES = [
  "#1971c2",
  "#f08c00",
  "#2f9e44",
  "#e03131",
  "#6741d9",
  "#e8590c",
];
const CHAR_WIDTH = 0.56;
const BODY_BOTTOM = SLIDE_H - 100;

type El = ExcalidrawElement;

type Ctx = {
  theme: DeckTheme;
  icons: IconBundle;
  logos?: LogoBundle;
  /** logo ids used on the slide; the caller loads them with `logoFiles` */
  logoIds: Set<string>;
};

const fill = (ctx: Ctx, i: number) =>
  FILLS[(i + ctx.theme.shift) % FILLS.length];
const stroke = (ctx: Ctx, i: number) =>
  STROKES[(i + ctx.theme.shift) % STROKES.length];

const wrapText = (text: string, fontSize: number, maxWidth: number) => {
  const perLine = Math.max(6, Math.floor(maxWidth / (fontSize * CHAR_WIDTH)));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > perLine) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.join("\n");
};

const convertText = (
  text: string,
  fontSize: number,
  color: string,
  align: "left" | "center" | "right",
) =>
  convertToExcalidrawElements(
    [
      {
        type: "text",
        x: 0,
        y: 0,
        text,
        fontSize,
        fontFamily: FONT,
        strokeColor: color,
        textAlign: align,
      },
    ] as any,
    { regenerateIds: true },
  )[0];

/**
 * A measured text element at (x, y). Wraps to maxWidth using the real
 * rendered width, and shrinks the font until it fits maxLines.
 */
const makeText = (
  text: string,
  opts: {
    x: number;
    y: number;
    fontSize: number;
    maxWidth?: number;
    maxLines?: number;
    color?: string;
    align?: "left" | "center" | "right";
  },
): El => {
  const color = opts.color ?? INK;
  const align = opts.align ?? "left";
  let fontSize = opts.fontSize;
  let charWidth = CHAR_WIDTH;
  let el = convertText(text, fontSize, color, align);
  for (let i = 0; i < 10; i++) {
    const wrapped = opts.maxWidth
      ? wrapText(text, fontSize, opts.maxWidth / (charWidth / CHAR_WIDTH))
      : text;
    el = convertText(wrapped, fontSize, color, align);
    const lines = wrapped.split("\n").length;
    if (opts.maxLines && lines > opts.maxLines) {
      fontSize = Math.round(fontSize * 0.9);
      continue;
    }
    if (opts.maxWidth && el.width > opts.maxWidth * 1.02) {
      // the font is wider than estimated: wrap tighter, or shrink a single long word
      if (
        !wrapped.includes(" ") ||
        wrapped.split("\n").every((l) => !l.includes(" "))
      ) {
        fontSize = Math.round(fontSize * 0.9);
      } else {
        charWidth *= el.width / opts.maxWidth;
      }
      continue;
    }
    break;
  }
  const x =
    align === "center" && opts.maxWidth
      ? opts.x + (opts.maxWidth - el.width) / 2
      : align === "right" && opts.maxWidth
      ? opts.x + opts.maxWidth - el.width
      : opts.x;
  return { ...el, x, y: opts.y } as El;
};

const at = (el: El, x: number, y: number) => ({ ...el, x, y } as El);

const shapes = (skeletons: Record<string, any>[]) =>
  convertToExcalidrawElements(
    skeletons.map((s) => ({
      roughness: 1,
      strokeWidth: 2,
      strokeColor: INK,
      fontFamily: FONT,
      ...s,
    })) as any,
    { regenerateIds: true },
  ) as El[];

/** A hand-drawn wavy underline from x to x + width. */
const squiggle = (x: number, y: number, width: number, color: string) =>
  shapes([
    {
      type: "line",
      x,
      y,
      strokeColor: color,
      strokeWidth: 4,
      roughness: 2,
      points: [
        [0, 0],
        [width * 0.3, 6],
        [width * 0.65, -3],
        [width, 4],
      ],
    },
  ]);

/** Copies a doodle icon from the bundle, scaled to fit a size x size box at (x, y). */
const placeIcon = (
  name: string | undefined,
  icons: IconBundle,
  x: number,
  y: number,
  size: number,
): El[] => {
  const key = name ? resolveIcon(name, icons) : undefined;
  const icon = key ? icons[key] : undefined;
  if (!icon) {
    return [];
  }
  const scale = size / Math.max(icon.width, icon.height);
  const ox = x + (size - icon.width * scale) / 2;
  const oy = y + (size - icon.height * scale) / 2;
  const ids = new Map<string, string>(
    icon.elements.map((el) => [el.id, randomId()]),
  );
  const groups = new Map<string, string>();
  const groupId = randomId();
  return icon.elements.map((el) => ({
    ...el,
    id: ids.get(el.id)!,
    x: ox + el.x * scale,
    y: oy + el.y * scale,
    width: el.width * scale,
    height: el.height * scale,
    ...(el.points
      ? {
          points: el.points.map(([px, py]: number[]) => [
            px * scale,
            py * scale,
          ]),
        }
      : null),
    ...(el.type === "text" ? { fontSize: (el.fontSize ?? 20) * scale } : null),
    groupIds: [
      ...(el.groupIds ?? []).map((g: string) => {
        if (!groups.has(g)) {
          groups.set(g, randomId());
        }
        return groups.get(g)!;
      }),
      groupId,
    ],
    containerId: el.containerId ? ids.get(el.containerId) ?? null : null,
    boundElements: (el.boundElements ?? [])
      .filter((b: { id: string }) => ids.has(b.id))
      .map((b: { id: string; type: string }) => ({ ...b, id: ids.get(b.id)! })),
    startBinding: null,
    endBinding: null,
    frameId: null,
    seed: randomInteger(),
    versionNonce: randomInteger(),
    version: 1,
    updated: Date.now(),
    isDeleted: false,
    locked: false,
    link: null,
  })) as unknown as El[];
};

/**
 * The official logo when `name` (or the item's text) names a real product,
 * else the doodle icon, else a small accent dot.
 */
const visual = (
  ctx: Ctx,
  opts: { logo?: string; text?: string; icon?: string },
  x: number,
  y: number,
  size: number,
): El[] => {
  const logoId =
    ctx.logos &&
    ((opts.logo && matchLogo(opts.logo, ctx.logos)) ||
      (opts.text && opts.text.split(" ").length <= 3
        ? matchLogo(opts.text, ctx.logos)
        : undefined));
  if (logoId) {
    ctx.logoIds.add(logoId);
    return [logoImage(logoId, x, y, size) as El];
  }
  const icon = placeIcon(opts.icon, ctx.icons, x, y, size);
  if (icon.length) {
    return icon;
  }
  return shapes([
    {
      type: "ellipse",
      x: x + size / 2 - 12,
      y: y + size / 2 - 12,
      width: 24,
      height: 24,
      backgroundColor: ctx.theme.accent,
      fillStyle: "solid",
      strokeColor: ctx.theme.accent,
    },
  ]);
};

/** Moves and scales elements so they fit a box, keeping text readable. */
export const fitInto = (
  elements: readonly El[],
  box: { x: number; y: number; w: number; h: number },
  maxScale = 1.4,
): El[] => {
  if (!elements.length) {
    return [];
  }
  const [minX, minY, maxX, maxY] = getCommonBounds(elements as any);
  const scale = Math.min(
    maxScale,
    box.w / Math.max(1, maxX - minX),
    box.h / Math.max(1, maxY - minY),
  );
  const ox = box.x + (box.w - (maxX - minX) * scale) / 2;
  const oy = box.y + (box.h - (maxY - minY) * scale) / 2;
  return elements.map((el: any) => ({
    ...el,
    x: ox + (el.x - minX) * scale,
    y: oy + (el.y - minY) * scale,
    width: el.width * scale,
    height: el.height * scale,
    ...(el.points
      ? {
          points: el.points.map(([px, py]: number[]) => [
            px * scale,
            py * scale,
          ]),
        }
      : null),
    ...(el.type === "text" ? { fontSize: el.fontSize * scale } : null),
  }));
};

/** Shifts elements so they sit in the middle of the space between top and bottom. */
const centerIn = (elements: El[], top: number, bottom: number): El[] => {
  if (!elements.length) {
    return elements;
  }
  const [, minY, , maxY] = getCommonBounds(elements as any);
  const dy = Math.max(
    top - minY,
    top + (bottom - top - (maxY - minY)) / 2 - minY,
  );
  return elements.map((el) => ({ ...el, y: el.y + dy } as El));
};

/** Highlight for one title word: underline, marker stroke or a hand-drawn ring. */
const markWord = (ctx: Ctx, word: El): El[] => {
  const { theme } = ctx;
  if (theme.mark === "marker") {
    return shapes([
      {
        type: "rectangle",
        x: word.x - 8,
        y: word.y + word.height * 0.45,
        width: word.width + 16,
        height: word.height * 0.5,
        backgroundColor: theme.accentFill,
        fillStyle: "solid",
        strokeColor: "transparent",
        opacity: 70,
        roughness: 2,
      },
    ]);
  }
  if (theme.mark === "circle") {
    return shapes([
      {
        type: "ellipse",
        x: word.x - 22,
        y: word.y - 10,
        width: word.width + 44,
        height: word.height + 20,
        strokeColor: theme.accent,
        strokeWidth: 3,
        roughness: 2,
      },
    ]);
  }
  return squiggle(word.x, word.y + word.height + 6, word.width, theme.accent);
};

/** A title line with its key word in the accent colour and marked. */
const titleText = (
  ctx: Ctx,
  slide: Slide,
  opts: {
    x: number;
    y: number;
    fontSize: number;
    maxWidth: number;
    align: "left" | "center";
  },
): { elements: El[]; height: number } => {
  const full = makeText(slide.title, {
    x: opts.x,
    y: opts.y,
    fontSize: opts.fontSize,
    maxWidth: opts.maxWidth,
    maxLines: 3,
    align: opts.align,
  });
  const fontSize = (full as ExcalidrawTextElement).fontSize;
  const start = slide.highlight
    ? slide.title.toLowerCase().indexOf(slide.highlight.toLowerCase())
    : -1;
  const oneLine = !(full as ExcalidrawTextElement).text.includes("\n");
  if (start < 0 || !oneLine) {
    // no single-line highlight: mark the whole title lightly instead
    const under = squiggle(
      full.x,
      full.y + full.height + 10,
      Math.min(full.width, 420),
      ctx.theme.accent,
    );
    return { elements: [full, ...under], height: full.height + 20 };
  }
  const runs = [
    slide.title.slice(0, start),
    slide.title.slice(start, start + slide.highlight!.length),
    slide.title.slice(start + slide.highlight!.length),
  ];
  const space = fontSize * 0.28;
  const parts: El[] = [];
  let x = 0;
  runs.forEach((run, i) => {
    const text = run.trim();
    if (!text) {
      return;
    }
    if (x > 0 && /^\s/.test(run)) {
      x += space;
    }
    const el = makeText(text, {
      x,
      y: opts.y,
      fontSize,
      color: i === 1 ? ctx.theme.accent : INK,
    });
    parts.push(el);
    x += el.width + (/\s$/.test(run) ? space : 0);
  });
  const width = x;
  const left =
    opts.align === "center" ? opts.x + (opts.maxWidth - width) / 2 : opts.x;
  const placed = parts.map((el) => at(el, el.x + left, el.y));
  const word = placed.find((el) => el.strokeColor === ctx.theme.accent);
  const marks = word ? markWord(ctx, word) : [];
  // the marker sits behind the words; rings and underlines on top
  const elements =
    ctx.theme.mark === "marker" ? [...marks, ...placed] : [...placed, ...marks];
  return { elements, height: full.height + 20 };
};

/** Title at the top of a content slide. */
const header = (ctx: Ctx, slide: Slide): { elements: El[]; bottom: number } => {
  const title = titleText(ctx, slide, {
    x: PAD,
    y: 64,
    fontSize: 64,
    maxWidth: SLIDE_W - PAD * 2,
    align: ctx.theme.titleAlign,
  });
  return { elements: title.elements, bottom: 64 + title.height + 40 };
};

const footer = (deckTitle: string, index: number): El[] => [
  makeText(deckTitle, {
    x: PAD,
    y: SLIDE_H - 56,
    fontSize: 20,
    color: MUTED,
    maxWidth: 1000,
    maxLines: 1,
  }),
  makeText(String(index + 1), {
    x: SLIDE_W - PAD - 60,
    y: SLIDE_H - 58,
    fontSize: 24,
    color: MUTED,
    maxWidth: 60,
    align: "right",
  }),
];

// ─── Layouts ─────────────────────────────────────────────────────────────────

const titleSlide = (ctx: Ctx, slide: Slide, variant: number): El[] => {
  const { theme } = ctx;
  if (variant === 1) {
    // left-aligned title with an accent bar and a big doodle on the right
    const title = titleText(ctx, slide, {
      x: PAD + 50,
      y: 0,
      fontSize: 92,
      maxWidth: 900,
      align: "left",
    });
    const sub = slide.subtitle
      ? makeText(slide.subtitle, {
          x: PAD + 50,
          y: 0,
          fontSize: 38,
          maxWidth: 900,
          maxLines: 2,
          color: MUTED,
        })
      : null;
    const block = [
      ...title.elements,
      ...(sub ? [at(sub, sub.x, title.height + 40)] : []),
    ];
    const centered = centerIn(block, 120, SLIDE_H - 120);
    const [, minY, , maxY] = getCommonBounds(centered as any);
    return [
      ...shapes([
        {
          type: "rectangle",
          x: PAD,
          y: minY - 10,
          width: 16,
          height: maxY - minY + 20,
          backgroundColor: theme.accent,
          fillStyle: "solid",
          strokeColor: theme.accent,
        },
      ]),
      ...centered,
      // the product's logo when the title names one, else a doodle
      ...visual(ctx, { logo: slide.title, icon: "lightning" }, 1150, 300, 280),
    ];
  }
  if (variant === 2) {
    // title on a hand-drawn banner
    const title = titleText(ctx, slide, {
      x: 220,
      y: 0,
      fontSize: 84,
      maxWidth: SLIDE_W - 440,
      align: "center",
    });
    const sub = slide.subtitle
      ? makeText(slide.subtitle, {
          x: 220,
          y: 0,
          fontSize: 38,
          maxWidth: SLIDE_W - 440,
          maxLines: 2,
          align: "center",
          color: MUTED,
        })
      : null;
    const top = (SLIDE_H - title.height - (sub ? sub.height + 120 : 60)) / 2;
    const titleEls = title.elements.map((el) => at(el, el.x, el.y + top));
    return [
      ...shapes([
        {
          type: "rectangle",
          x: 160,
          y: top - 40,
          width: SLIDE_W - 320,
          height: title.height + 80,
          backgroundColor: theme.accentFill,
          fillStyle: "hachure",
          strokeColor: theme.accent,
          strokeWidth: 3,
          roughness: 2,
          roundness: { type: 3 },
        },
      ]),
      ...titleEls,
      ...(sub ? [at(sub, sub.x, top + title.height + 80)] : []),
      ...placeIcon("star", ctx.icons, 120, 110, 90),
      ...placeIcon("lightning", ctx.icons, SLIDE_W - 220, SLIDE_H - 220, 110),
    ];
  }
  // centred title with a doodle in the corner
  const title = titleText(ctx, slide, {
    x: (SLIDE_W - 1300) / 2,
    y: 0,
    fontSize: 96,
    maxWidth: 1300,
    align: "center",
  });
  const sub = slide.subtitle
    ? makeText(slide.subtitle, {
        x: (SLIDE_W - 1300) / 2,
        y: 0,
        fontSize: 40,
        maxWidth: 1300,
        maxLines: 2,
        align: "center",
        color: MUTED,
      })
    : null;
  const top = (SLIDE_H - title.height - (sub ? sub.height + 50 : 0)) / 2 - 20;
  return [
    ...title.elements.map((el) => at(el, el.x, el.y + top)),
    ...(sub ? [at(sub, sub.x, top + title.height + 50)] : []),
    ...placeIcon("lightning", ctx.icons, 110, 90, 120),
  ];
};

const hookSlide = (ctx: Ctx, slide: Slide): El[] => {
  const text = slide.question || slide.statement || slide.title;
  const mark = makeText("?", {
    x: PAD + 40,
    y: 0,
    fontSize: 420,
    color: ctx.theme.accent,
  });
  const question = makeText(text, {
    x: 560,
    y: 0,
    fontSize: 64,
    maxWidth: SLIDE_W - 560 - PAD,
    maxLines: 5,
  });
  return [
    at(mark, mark.x, (SLIDE_H - mark.height) / 2),
    at(question, question.x, (SLIDE_H - question.height) / 2 - 30),
    ...squiggle(560, (SLIDE_H + question.height) / 2, 360, ctx.theme.accent),
    ...placeIcon("thought-bubble", ctx.icons, SLIDE_W - 260, 90, 150),
  ];
};

const statementSlide = (ctx: Ctx, slide: Slide, top: number): El[] => {
  const text = slide.statement || slide.question || slide.title;
  const body = makeText(text, {
    x: 200,
    y: 0,
    fontSize: 72,
    maxWidth: SLIDE_W - 400,
    maxLines: 4,
    align: "center",
  });
  const y = top + (BODY_BOTTOM - top - body.height) / 2;
  return [
    ...shapes([
      {
        type: "rectangle",
        x: 150,
        y: y - 50,
        width: SLIDE_W - 300,
        height: body.height + 100,
        backgroundColor: ctx.theme.accentFill,
        fillStyle: "hachure",
        strokeColor: "transparent",
        opacity: 60,
        roughness: 2,
      },
    ]),
    at(body, body.x, y),
    ...placeIcon("star", ctx.icons, PAD, y - 90, 100),
  ];
};

const pointsSlide = (
  ctx: Ctx,
  slide: Slide,
  top: number,
  variant: number,
): El[] => {
  const items = slide.points.slice(0, 6);
  if (variant === 1 && items.length <= 4) {
    // icon cards side by side
    return cardsSlide(
      ctx,
      {
        ...slide,
        cards: items.map((p) => ({
          heading: "",
          text: p.text,
          icon: p.icon,
          logo: p.logo,
        })),
      },
      top,
    );
  }
  if (variant === 2 && items.length <= 5) {
    // zigzag: items alternate left and right down the slide, joined by a dashed path
    const room = BODY_BOTTOM - top;
    const row = room / items.length;
    const out: El[] = [];
    let prev: { x: number; y: number } | null = null;
    items.forEach((point, i) => {
      const leftSide = i % 2 === 0;
      const y = top + i * row;
      const iconX = leftSide ? PAD + 40 : SLIDE_W / 2 + 40;
      const size = Math.min(90, row - 20);
      out.push(
        ...visual(
          ctx,
          { logo: point.logo, text: point.text, icon: point.icon },
          iconX,
          y,
          size,
        ),
      );
      const text = makeText(point.text, {
        x: iconX + size + 30,
        y: 0,
        fontSize: 40,
        maxWidth: SLIDE_W / 2 - size - 120,
        maxLines: 2,
      });
      out.push(at(text, text.x, y + (size - text.height) / 2));
      const here = { x: iconX + size / 2, y: y + size + 8 };
      if (prev) {
        out.push(
          ...shapes([
            {
              type: "arrow",
              x: prev.x,
              y: prev.y,
              width: here.x - prev.x,
              height: y - 8 - prev.y,
              strokeStyle: "dashed",
              strokeColor: MUTED,
              points: [
                [0, 0],
                [here.x - prev.x, y - 8 - prev.y],
              ],
            },
          ]),
        );
      }
      prev = here;
    });
    return out;
  }
  // a list with an icon or logo per item
  const room = BODY_BOTTOM - top;
  const row = Math.min(150, room / items.length);
  const iconSize = Math.min(96, row - 30);
  const fontSize = items.length >= 5 ? 42 : 50;
  const out: El[] = [];
  items.forEach((point, i) => {
    const y = top + i * row;
    out.push(
      ...visual(
        ctx,
        { logo: point.logo, text: point.text, icon: point.icon || "star" },
        PAD + 10,
        y,
        iconSize,
      ),
    );
    const text = makeText(point.text, {
      x: PAD + iconSize + 50,
      y: 0,
      fontSize,
      maxWidth: SLIDE_W - PAD * 2 - iconSize - 60,
      maxLines: 2,
    });
    out.push(at(text, text.x, y + (iconSize - text.height) / 2));
  });
  return centerIn(out, top, BODY_BOTTOM);
};

const cardsSlide = (ctx: Ctx, slide: Slide, top: number): El[] => {
  const cards = slide.cards.length
    ? slide.cards
    : slide.points.map((p) => ({
        heading: "",
        text: p.text,
        icon: p.icon,
        logo: p.logo,
      }));
  const items = cards.slice(0, 4);
  const gap = 50;
  const w = (SLIDE_W - PAD * 2 - gap * (items.length - 1)) / items.length;
  const h = Math.min(520, BODY_BOTTOM - top);
  const out: El[] = [];
  items.forEach((card, i) => {
    const x = PAD + i * (w + gap);
    out.push(
      ...shapes([
        {
          type: "rectangle",
          x,
          y: top,
          width: w,
          height: h,
          backgroundColor: fill(ctx, i),
          fillStyle: "hachure",
          strokeColor: stroke(ctx, i),
          strokeWidth: 3,
          roundness: { type: 3 },
          angle: (ctx.theme.random() - 0.5) * 0.04,
        },
      ]),
    );
    const size = Math.min(130, w - 80);
    out.push(
      ...visual(
        ctx,
        { logo: card.logo, text: card.heading, icon: card.icon },
        x + (w - size) / 2,
        top + 40,
        size,
      ),
    );
    let y = top + 60 + size;
    if (card.heading) {
      const heading = makeText(card.heading, {
        x: x + 20,
        y,
        fontSize: 44,
        maxWidth: w - 40,
        maxLines: 2,
        align: "center",
        color: stroke(ctx, i),
      });
      out.push(heading);
      y += heading.height + 16;
    }
    out.push(
      makeText(card.text, {
        x: x + 24,
        y,
        fontSize: card.heading ? 32 : 38,
        maxWidth: w - 48,
        maxLines: 5,
        align: "center",
      }),
    );
  });
  return centerIn(out, top, BODY_BOTTOM);
};

const stepsSlide = (
  ctx: Ctx,
  slide: Slide,
  top: number,
  variant: number,
): El[] => {
  const items = slide.points.slice(0, 5);
  const out: El[] = [];
  if (variant === 1) {
    // a vertical ladder: numbers down the left, joined by a dashed line
    const row = Math.min(140, (BODY_BOTTOM - top) / items.length);
    const circle = Math.min(90, row - 24);
    const cx = PAD + 40 + circle / 2;
    out.push(
      ...shapes([
        {
          type: "line",
          x: cx,
          y: top + circle / 2,
          strokeStyle: "dashed",
          strokeColor: MUTED,
          points: [
            [0, 0],
            [0, row * (items.length - 1)],
          ],
        },
      ]),
    );
    items.forEach((point, i) => {
      const y = top + i * row;
      out.push(
        ...shapes([
          {
            type: "ellipse",
            x: cx - circle / 2,
            y,
            width: circle,
            height: circle,
            backgroundColor: fill(ctx, i),
            fillStyle: "solid",
            strokeColor: stroke(ctx, i),
            strokeWidth: 3,
          },
        ]),
      );
      const n = makeText(String(i + 1), {
        x: cx - 40,
        y: 0,
        fontSize: 48,
        maxWidth: 80,
        align: "center",
      });
      out.push(at(n, n.x, y + (circle - n.height) / 2));
      const text = makeText(point.text, {
        x: cx + circle / 2 + 50,
        y: 0,
        fontSize: 44,
        maxWidth: SLIDE_W - cx - circle - 300,
        maxLines: 2,
      });
      out.push(at(text, text.x, y + (circle - text.height) / 2));
      out.push(
        ...visual(
          ctx,
          { logo: point.logo, icon: point.icon },
          SLIDE_W - PAD - circle,
          y,
          circle,
        ),
      );
    });
    return centerIn(out, top, BODY_BOTTOM);
  }
  if (variant === 2) {
    // a staircase climbing to the right
    const n = items.length;
    const w = (SLIDE_W - PAD * 2 - 30 * (n - 1)) / n;
    const stepH = 70;
    const base = BODY_BOTTOM - 30;
    items.forEach((point, i) => {
      const x = PAD + i * (w + 30);
      const h = stepH * (i + 1) + 60;
      out.push(
        ...shapes([
          {
            type: "rectangle",
            x,
            y: base - h,
            width: w,
            height: h,
            backgroundColor: fill(ctx, i),
            fillStyle: "hachure",
            strokeColor: stroke(ctx, i),
            strokeWidth: 3,
          },
        ]),
      );
      const num = makeText(String(i + 1), {
        x,
        y: 0,
        fontSize: 54,
        maxWidth: w,
        align: "center",
        color: stroke(ctx, i),
      });
      out.push(at(num, num.x, base - h + 12));
      const text = makeText(point.text, {
        x: x + 6,
        y: 0,
        fontSize: 32,
        maxWidth: w - 12,
        maxLines: 4,
        align: "center",
      });
      out.push(at(text, text.x, base - h - text.height - 20));
    });
    return out;
  }
  // numbered circles across, joined by arrows, with an icon and a caption each
  const col = (SLIDE_W - PAD * 2) / items.length;
  const circle = 120;
  items.forEach((point, i) => {
    const cx = PAD + col * i + col / 2;
    const y = top + 20;
    out.push(
      ...shapes([
        {
          type: "ellipse",
          x: cx - circle / 2,
          y,
          width: circle,
          height: circle,
          backgroundColor: fill(ctx, i),
          fillStyle: "hachure",
          strokeColor: stroke(ctx, i),
          strokeWidth: 3,
        },
      ]),
    );
    const number = makeText(String(i + 1), {
      x: cx - 40,
      y: 0,
      fontSize: 60,
      maxWidth: 80,
      align: "center",
    });
    out.push(at(number, number.x, y + (circle - number.height) / 2));
    if (i < items.length - 1) {
      const len = col - circle - 32;
      out.push(
        ...shapes([
          {
            type: "arrow",
            x: cx + circle / 2 + 16,
            y: y + circle / 2,
            width: len,
            height: 0,
            strokeWidth: 3,
            points: [
              [0, 0],
              [len / 2, -10],
              [len, 0],
            ],
          },
        ]),
      );
    }
    out.push(
      ...visual(
        ctx,
        { logo: point.logo, icon: point.icon },
        cx - 60,
        y + circle + 40,
        120,
      ),
    );
    out.push(
      makeText(point.text, {
        x: cx - col / 2 + 16,
        y: y + circle + 190,
        fontSize: items.length >= 5 ? 36 : 42,
        maxWidth: col - 32,
        maxLines: 4,
        align: "center",
      }),
    );
  });
  return centerIn(out, top, BODY_BOTTOM);
};

const timelineSlide = (ctx: Ctx, slide: Slide, top: number): El[] => {
  const items = slide.timeline.slice(0, 6);
  const y = top + (BODY_BOTTOM - top) / 2;
  const col = (SLIDE_W - PAD * 2) / items.length;
  const out: El[] = shapes([
    {
      type: "arrow",
      x: PAD - 20,
      y,
      width: SLIDE_W - PAD * 2 + 40,
      height: 0,
      strokeWidth: 4,
      strokeColor: INK,
      points: [
        [0, 0],
        [SLIDE_W - PAD * 2 + 40, 0],
      ],
    },
  ]);
  items.forEach((item, i) => {
    const cx = PAD + col * i + col / 2;
    const above = i % 2 === 0;
    out.push(
      ...shapes([
        {
          type: "ellipse",
          x: cx - 18,
          y: y - 18,
          width: 36,
          height: 36,
          backgroundColor: ctx.theme.accent,
          fillStyle: "solid",
          strokeColor: ctx.theme.accent,
        },
      ]),
    );
    const when = makeText(item.when, {
      x: cx - col / 2,
      y: 0,
      fontSize: 44,
      maxWidth: col,
      maxLines: 1,
      align: "center",
      color: ctx.theme.accent,
    });
    const text = makeText(item.text, {
      x: cx - col / 2 + 10,
      y: 0,
      fontSize: 30,
      maxWidth: col - 20,
      maxLines: 4,
      align: "center",
    });
    if (above) {
      out.push(
        at(text, text.x, y - 50 - text.height),
        at(when, when.x, y - 60 - text.height - when.height),
      );
    } else {
      out.push(
        at(when, when.x, y + 40),
        at(text, text.x, y + 50 + when.height),
      );
    }
  });
  return out;
};

const compareSlide = (
  ctx: Ctx,
  slide: Slide,
  top: number,
  variant: number,
): El[] => {
  const gap = 120;
  const w = (SLIDE_W - PAD * 2 - gap) / 2;
  const h = BODY_BOTTOM - top;
  const out: El[] = [];
  const sides = [slide.left!, slide.right!];
  if (variant === 1) {
    // two columns with a cross or tick per point
    sides.forEach((sideSpec, i) => {
      const x = PAD + i * (w + gap);
      const color = i ? "#2f9e44" : "#e03131";
      const heading = makeText(sideSpec.heading || (i ? "After" : "Before"), {
        x,
        y: top,
        fontSize: 56,
        maxWidth: w,
        maxLines: 1,
        align: "center",
        color,
      });
      out.push(
        heading,
        ...squiggle(x + w / 2 - 120, top + heading.height + 8, 240, color),
      );
      let y = top + heading.height + 60;
      for (const point of sideSpec.points.slice(0, 5)) {
        out.push(...placeIcon(i ? "check" : "cross", ctx.icons, x, y, 54));
        const text = makeText(point, {
          x: x + 80,
          y,
          fontSize: 38,
          maxWidth: w - 90,
          maxLines: 2,
        });
        out.push(text);
        y += Math.max(text.height, 54) + 28;
      }
    });
    out.push(
      ...shapes([
        {
          type: "line",
          x: SLIDE_W / 2,
          y: top,
          strokeStyle: "dashed",
          strokeColor: MUTED,
          points: [
            [0, 0],
            [0, h - 20],
          ],
        },
      ]),
    );
    return out;
  }
  // two hatched boxes with VS between them
  sides.forEach((sideSpec, i) => {
    const x = PAD + i * (w + gap);
    out.push(
      ...shapes([
        {
          type: "rectangle",
          x,
          y: top,
          width: w,
          height: h,
          backgroundColor: i ? "#d3f9d8" : "#ffe3e3",
          fillStyle: "hachure",
          strokeColor: i ? "#2f9e44" : "#e03131",
          strokeWidth: 3,
          roundness: { type: 3 },
        },
      ]),
    );
    out.push(
      makeText(sideSpec.heading || (i ? "After" : "Before"), {
        x: x + 30,
        y: top + 30,
        fontSize: 54,
        maxWidth: w - 60,
        maxLines: 1,
        align: "center",
        color: i ? "#2f9e44" : "#e03131",
      }),
    );
    let y = top + 130;
    for (const point of sideSpec.points.slice(0, 5)) {
      const text = makeText(`• ${point}`, {
        x: x + 40,
        y,
        fontSize: 40,
        maxWidth: w - 80,
        maxLines: 2,
      });
      out.push(text);
      y += text.height + 26;
    }
  });
  const vs = makeText("VS", {
    x: SLIDE_W / 2 - 60,
    y: 0,
    fontSize: 56,
    maxWidth: 120,
    align: "center",
    color: ctx.theme.accent,
  });
  out.push(at(vs, vs.x, top + h / 2 - vs.height / 2));
  return out;
};

const statSlide = (
  ctx: Ctx,
  slide: Slide,
  top: number,
  variant: number,
): El[] => {
  const stat = slide.stat!;
  if (variant === 1) {
    // the number inside a big hand-drawn ring, the label beside it
    const ring = 440;
    const ry = top + (BODY_BOTTOM - top - ring) / 2;
    const value = makeText(stat.value, {
      x: PAD + 30,
      y: 0,
      fontSize: 150,
      maxWidth: ring - 60,
      maxLines: 1,
      align: "center",
      color: ctx.theme.accent,
    });
    const label = makeText(stat.label, {
      x: PAD + ring + 90,
      y: 0,
      fontSize: 56,
      maxWidth: SLIDE_W - PAD * 2 - ring - 100,
      maxLines: 4,
    });
    return [
      ...shapes([
        {
          type: "ellipse",
          x: PAD,
          y: ry,
          width: ring,
          height: ring,
          strokeColor: ctx.theme.accent,
          strokeWidth: 5,
          roughness: 2,
          backgroundColor: ctx.theme.accentFill,
          fillStyle: "hachure",
        },
      ]),
      at(value, value.x, ry + (ring - value.height) / 2),
      at(label, label.x, ry + ring / 2 - label.height / 2),
      ...placeIcon(
        stat.icon || "bar-chart",
        ctx.icons,
        SLIDE_W - PAD - 130,
        ry - 10,
        130,
      ),
    ];
  }
  // one huge number with the label under it
  const value = makeText(stat.value, {
    x: PAD,
    y: 0,
    fontSize: 200,
    maxWidth: SLIDE_W - PAD * 2,
    maxLines: 1,
    align: "center",
    color: ctx.theme.accent,
  });
  const label = makeText(stat.label, {
    x: PAD + 150,
    y: 0,
    fontSize: 48,
    maxWidth: SLIDE_W - PAD * 2 - 300,
    maxLines: 2,
    align: "center",
  });
  const block = value.height + 40 + label.height;
  const y = top + (BODY_BOTTOM - top - block) / 2;
  return [
    at(value, value.x, y),
    ...squiggle(
      SLIDE_W / 2 - value.width / 2,
      y + value.height + 4,
      value.width,
      ctx.theme.accent,
    ),
    at(label, label.x, y + value.height + 40),
    ...placeIcon(stat.icon || "bar-chart", ctx.icons, PAD + 20, y + 20, 150),
  ];
};

const quoteSlide = (
  ctx: Ctx,
  slide: Slide,
  top: number,
  variant: number,
): El[] => {
  const quote = slide.quote!;
  if (variant === 1) {
    // a speech bubble coming from a person
    const text = makeText(quote.text, {
      x: 520,
      y: 0,
      fontSize: 50,
      maxWidth: SLIDE_W - 520 - PAD - 60,
      maxLines: 5,
    });
    const by = quote.by
      ? makeText(`— ${quote.by}`, { x: 520, y: 0, fontSize: 34, color: MUTED })
      : null;
    const h = text.height + (by ? by.height + 30 : 0) + 100;
    const y = top + (BODY_BOTTOM - top - h) / 2;
    return [
      ...placeIcon("person", ctx.icons, PAD + 40, y + h / 2 - 40, 220),
      ...shapes([
        {
          type: "rectangle",
          x: 470,
          y,
          width: SLIDE_W - 470 - PAD,
          height: h,
          backgroundColor: ctx.theme.accentFill,
          fillStyle: "hachure",
          strokeColor: ctx.theme.accent,
          strokeWidth: 3,
          roundness: { type: 3 },
        },
        {
          type: "line",
          x: 470,
          y: y + h / 2 - 20,
          strokeColor: ctx.theme.accent,
          strokeWidth: 3,
          points: [
            [0, 0],
            [-90, 40],
            [0, 50],
          ],
        },
      ]),
      at(text, text.x, y + 50),
      ...(by ? [at(by, by.x, y + 60 + text.height)] : []),
    ];
  }
  const text = makeText(quote.text, {
    x: PAD + 120,
    y: 0,
    fontSize: 56,
    maxWidth: SLIDE_W - PAD * 2 - 240,
    maxLines: 5,
    align: "center",
  });
  const y = top + (BODY_BOTTOM - top - 60 - text.height) / 2;
  const out: El[] = [
    makeText("“", {
      x: PAD,
      y: y - 70,
      fontSize: 220,
      color: ctx.theme.accent,
    }),
    at(text, text.x, y),
  ];
  if (quote.by) {
    out.push(
      makeText(`— ${quote.by}`, {
        x: PAD,
        y: y + text.height + 40,
        fontSize: 36,
        maxWidth: SLIDE_W - PAD * 2 - 120,
        align: "right",
        color: MUTED,
      }),
    );
  }
  return out;
};

const logosSlide = (ctx: Ctx, slide: Slide, top: number): El[] => {
  const items = slide.logos.slice(0, 8);
  const cols = items.length <= 4 ? items.length : Math.ceil(items.length / 2);
  const rows = Math.ceil(items.length / cols);
  const colW = (SLIDE_W - PAD * 2) / cols;
  const rowH = (BODY_BOTTOM - top) / rows;
  const size = Math.min(150, rowH - 120, colW - 80);
  const out: El[] = [];
  items.forEach((item, i) => {
    const cx = PAD + (i % cols) * colW + colW / 2;
    const y = top + Math.floor(i / cols) * rowH + 10;
    out.push(
      ...visual(
        ctx,
        { logo: item.name, text: item.name, icon: "gear" },
        cx - size / 2,
        y,
        size,
      ),
    );
    const name = makeText(item.name, {
      x: cx - colW / 2 + 10,
      y: y + size + 16,
      fontSize: 36,
      maxWidth: colW - 20,
      maxLines: 1,
      align: "center",
    });
    out.push(name);
    if (item.note) {
      out.push(
        makeText(item.note, {
          x: cx - colW / 2 + 10,
          y: y + size + 22 + name.height,
          fontSize: 26,
          maxWidth: colW - 20,
          maxLines: 2,
          align: "center",
          color: MUTED,
        }),
      );
    }
  });
  return centerIn(out, top, BODY_BOTTOM);
};

const summarySlide = (
  ctx: Ctx,
  slide: Slide,
  top: number,
  variant: number,
): El[] => {
  const items = slide.points.slice(0, 5);
  if (variant === 1) {
    // takeaways on slightly tilted sticky notes
    const n = items.length;
    const gap = 36;
    const w = Math.min(360, (SLIDE_W - PAD * 2 - gap * (n - 1)) / n);
    const total = w * n + gap * (n - 1);
    const x0 = (SLIDE_W - total) / 2;
    const out: El[] = [];
    items.forEach((point, i) => {
      const x = x0 + i * (w + gap);
      const y = top + 40 + (i % 2) * 40;
      out.push(
        ...shapes([
          {
            type: "rectangle",
            x,
            y,
            width: w,
            height: w,
            backgroundColor: [
              "#fff3bf",
              "#d3f9d8",
              "#d0ebff",
              "#ffe8cc",
              "#f3d9fa",
            ][i % 5],
            fillStyle: "solid",
            strokeColor: "#adb5bd",
            angle: (i % 2 ? 1 : -1) * 0.04,
          },
        ]),
      );
      out.push(
        makeText(point.text, {
          x: x + 24,
          y: y + 36,
          fontSize: 42,
          maxWidth: w - 48,
          maxLines: 6,
          align: "center",
        }),
      );
    });
    return centerIn(out, top, BODY_BOTTOM);
  }
  // a checklist in a hand-drawn box
  const list = pointsSlide(
    ctx,
    {
      ...slide,
      points: items.map((p) => ({ ...p, icon: "check", logo: undefined })),
    },
    top + 20,
    0,
  );
  const [minX, minY, maxX, maxY] = getCommonBounds(list as any);
  return [
    ...shapes([
      {
        type: "rectangle",
        x: minX - 40,
        y: minY - 30,
        width: maxX - minX + 80,
        height: maxY - minY + 60,
        backgroundColor: "#fff9db",
        fillStyle: "hachure",
        strokeColor: ctx.theme.accent,
        roundness: { type: 3 },
      },
    ]),
    ...list,
  ];
};

/** How many looks each layout has; a deck picks one per slide at random. */
const VARIANTS: Partial<Record<SlideLayout, number>> = {
  title: 3,
  points: 3,
  steps: 3,
  compare: 2,
  stat: 2,
  quote: 2,
  summary: 2,
};

/**
 * Draws one slide as hand-drawn elements in a 16:9 frame at (originX, originY).
 * `visual` holds already-drawn elements for diagram, flow and architecture slides.
 */
export const renderSlide = (
  slide: Slide,
  ctx: {
    index: number;
    deckTitle: string;
    deckId: string;
    icons: IconBundle;
    logos?: LogoBundle;
    /** collects the logo ids the slide uses */
    logoIds?: Set<string>;
    theme?: DeckTheme;
    /** drawn elements for diagram, flow, architecture and chart slides */
    visual?: readonly El[];
    /** @deprecated use `visual` */
    diagram?: readonly El[];
    originX: number;
    originY: number;
  },
): El[] => {
  const c: Ctx = {
    theme: ctx.theme ?? makeTheme(ctx.index + 1),
    icons: ctx.icons,
    logos: ctx.logos,
    logoIds: ctx.logoIds ?? new Set(),
  };
  const variant = Math.floor(c.theme.random() * (VARIANTS[slide.layout] ?? 1));
  const drawn = ctx.visual ?? ctx.diagram;
  let body: El[];
  if (slide.layout === "title") {
    body = titleSlide(c, slide, variant);
  } else if (slide.layout === "hook") {
    body = [...hookSlide(c, slide), ...footer(ctx.deckTitle, ctx.index)];
  } else {
    const head = header(c, slide);
    const top = head.bottom + 20;
    const box = { x: PAD, y: top, w: SLIDE_W - PAD * 2, h: BODY_BOTTOM - top };
    let content: El[];
    switch (slide.layout) {
      case "cards":
        content = cardsSlide(c, slide, top);
        break;
      case "steps":
        content = stepsSlide(c, slide, top, variant);
        break;
      case "timeline":
        content = timelineSlide(c, slide, top);
        break;
      case "compare":
        content = compareSlide(c, slide, top, variant);
        break;
      case "stat":
        content = statSlide(c, slide, top, variant);
        break;
      case "quote":
        content = quoteSlide(c, slide, top, variant);
        break;
      case "statement":
        content = statementSlide(c, slide, top);
        break;
      case "logos":
        content = logosSlide(c, slide, top);
        break;
      case "summary":
        content = summarySlide(c, slide, top, variant);
        break;
      case "diagram":
      case "flow":
      case "architecture":
      case "chart":
        content = drawn?.length
          ? fitInto(drawn, box, 2.2)
          : pointsSlide(
              c,
              {
                ...slide,
                points: slide.points.length
                  ? slide.points
                  : [{ text: slide.diagram || slide.title, icon: "network" }],
              },
              top,
              0,
            );
        break;
      default:
        content = pointsSlide(c, slide, top, variant);
    }
    body = [...head.elements, ...content, ...footer(ctx.deckTitle, ctx.index)];
  }

  const frame = {
    ...newFrameElement({
      x: ctx.originX,
      y: ctx.originY,
      width: SLIDE_W,
      height: SLIDE_H,
      name: `${String(ctx.index + 1).padStart(2, "0")}. ${slide.title}`.slice(
        0,
        80,
      ),
    }),
    customData: {
      deck: {
        id: ctx.deckId,
        index: ctx.index,
        title: slide.title,
        layout: slide.layout,
        subtitle: slide.subtitle,
        lines: slideLines(slide),
        notes: slide.notes,
      },
    },
  } as El;
  // the page: a solid card so exports and the canvas show a clean slide
  const [page] = shapes([
    {
      type: "rectangle",
      x: 0,
      y: 0,
      width: SLIDE_W,
      height: SLIDE_H,
      backgroundColor: c.theme.paper,
      fillStyle: "solid",
      strokeColor: "transparent",
      roughness: 0,
      locked: true,
    },
  ]);
  return [
    ...[page, ...body].map(
      (el) =>
        ({
          ...el,
          x: el.x + ctx.originX,
          y: el.y + ctx.originY,
          frameId: frame.id,
        } as El),
    ),
    frame,
  ];
};

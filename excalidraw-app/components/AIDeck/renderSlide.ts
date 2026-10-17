import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { FONT_FAMILY, randomId, randomInteger } from "@excalidraw/common";
import { getCommonBounds, newFrameElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { resolveIcon } from "../AISketch/renderSketch";

import type { IconBundle } from "../AISketch/renderSketch";

// ─── Spec: what the model returns (see api/ai/deck.ts) ──────────────────────

export const SLIDE_LAYOUTS = [
  "title",
  "points",
  "steps",
  "compare",
  "stat",
  "quote",
  "diagram",
  "summary",
] as const;
export type SlideLayout = typeof SLIDE_LAYOUTS[number];

export type SlidePoint = { text: string; icon?: string };
export type Slide = {
  layout: SlideLayout;
  title: string;
  highlight?: string;
  subtitle?: string;
  points: SlidePoint[];
  left?: { heading: string; points: string[] };
  right?: { heading: string; points: string[] };
  stat?: { value: string; label: string; icon?: string };
  quote?: { text: string; by?: string };
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

const layoutOf = (value: unknown): SlideLayout =>
  (SLIDE_LAYOUTS as readonly string[]).includes(value as string)
    ? (value as SlideLayout)
    : "points";

export const normalizePlan = (raw: any, count: number): DeckPlan => {
  const slides = (Array.isArray(raw?.slides) ? raw.slides : [])
    .map((s: any) => ({
      layout: layoutOf(s?.layout),
      title: str(s?.title, 90),
    }))
    .filter((s: { title: string }) => s.title)
    .slice(0, count);
  if (!slides.length) {
    throw new Error("The AI did not return a slide plan. Try again.");
  }
  const title = str(raw?.title, 120) || slides[0].title;
  slides[0] = { layout: "title", title: slides[0].title || title };
  if (slides.length > 2) {
    slides[slides.length - 1].layout = "summary";
  }
  // keep the deck varied: never the same layout three times in a row
  for (let i = 3; i < slides.length - 1; i++) {
    const same = (j: number) => slides[j].layout === slides[i].layout;
    if (same(i - 1) && same(i - 2)) {
      slides[i].layout = slides[i].layout === "points" ? "steps" : "points";
    }
  }
  return { title, subtitle: str(raw?.subtitle, 160) || undefined, slides };
};

const side = (raw: any) =>
  raw && typeof raw === "object"
    ? {
        heading: str(raw.heading, 60),
        points: (Array.isArray(raw.points) ? raw.points : [])
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
  const points: SlidePoint[] = (Array.isArray(raw?.points) ? raw.points : [])
    .map((p: any) =>
      typeof p === "string"
        ? { text: str(p, 110) }
        : { text: str(p?.text, 110), icon: str(p?.icon, 40) || undefined },
    )
    .filter((p: SlidePoint) => p.text)
    .slice(0, 6);
  const slide: Slide = {
    layout: planned.layout,
    title,
    highlight: str(raw?.highlight, 40) || undefined,
    subtitle: str(raw?.subtitle, 160) || undefined,
    points,
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
    diagram: str(raw?.diagram, 400) || undefined,
    notes: str(raw?.notes, 1200),
  };
  // a layout whose own fields are missing falls back to a list of points
  const usable =
    (slide.layout === "compare" &&
      slide.left?.points.length &&
      slide.right?.points.length) ||
    (slide.layout === "stat" && slide.stat) ||
    (slide.layout === "quote" && slide.quote) ||
    (slide.layout === "diagram" && slide.diagram) ||
    slide.layout === "title" ||
    (["points", "steps", "summary"].includes(slide.layout) && points.length);
  if (!usable) {
    slide.layout = "points";
    if (!slide.points.length) {
      slide.points = (slide.notes.match(/[^.!?]+[.!?]/g) ?? [slide.title])
        .slice(0, 4)
        .map((s) => ({ text: str(s, 110) }));
    }
  }
  return slide;
};

// ─── Look ────────────────────────────────────────────────────────────────────

export const SLIDE_W = 1600;
export const SLIDE_H = 900;
const PAD = 90;
const INK = "#1e1e1e";
const MUTED = "#6b7280";
const RED = "#e03131";
const FONT = FONT_FAMILY.Excalifont;
/** pastel fills, cycled through steps and boxes */
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

type El = ExcalidrawElement;

const wrapText = (text: string, fontSize: number, maxWidth: number) => {
  const perLine = Math.max(8, Math.floor(maxWidth / (fontSize * CHAR_WIDTH)));
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

/** A measured text element at (x, y); wraps to maxWidth and shrinks to fit maxLines. */
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
  let fontSize = opts.fontSize;
  let wrapped = text;
  for (let i = 0; i < 6; i++) {
    wrapped = opts.maxWidth ? wrapText(text, fontSize, opts.maxWidth) : text;
    if (!opts.maxLines || wrapped.split("\n").length <= opts.maxLines) {
      break;
    }
    fontSize = Math.round(fontSize * 0.88);
  }
  const [el] = convertToExcalidrawElements(
    [
      {
        type: "text",
        x: 0,
        y: 0,
        text: wrapped,
        fontSize,
        fontFamily: FONT,
        strokeColor: opts.color ?? INK,
        textAlign: opts.align ?? "left",
      },
    ] as any,
    { regenerateIds: true },
  );
  const x =
    opts.align === "center" && opts.maxWidth
      ? opts.x + (opts.maxWidth - el.width) / 2
      : opts.align === "right" && opts.maxWidth
      ? opts.x + opts.maxWidth - el.width
      : opts.x;
  return { ...el, x, y: opts.y } as El;
};

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
const squiggle = (x: number, y: number, width: number, color = RED) =>
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
    box.w / (maxX - minX),
    box.h / (maxY - minY),
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

/** Title at the top of a content slide, with the key word in red and a squiggle under it. */
const header = (slide: Slide): { elements: El[]; bottom: number } => {
  const maxWidth = SLIDE_W - PAD * 2;
  const full = makeText(slide.title, {
    x: PAD,
    y: 64,
    fontSize: 64,
    maxWidth,
    maxLines: 2,
  });
  const elements: El[] = [];
  const at = slide.highlight
    ? slide.title.toLowerCase().indexOf(slide.highlight.toLowerCase())
    : -1;
  const oneLine = !(full as ExcalidrawTextElement).text.includes("\n");
  if (at >= 0 && oneLine) {
    // the title in up to three runs so the highlight can be red
    const runs = [
      slide.title.slice(0, at),
      slide.title.slice(at, at + slide.highlight!.length),
      slide.title.slice(at + slide.highlight!.length),
    ];
    const fontSize = (full as any).fontSize as number;
    const space = fontSize * 0.28;
    let x = PAD;
    runs.forEach((run, i) => {
      const text = run.trim();
      if (!text) {
        return;
      }
      if (x > PAD && /^\s/.test(run)) {
        x += space;
      }
      const el = makeText(text, {
        x,
        y: 64,
        fontSize,
        color: i === 1 ? RED : INK,
      });
      elements.push(el);
      x += el.width + (/\s$/.test(run) ? space : 0);
    });
  } else {
    elements.push(full);
  }
  const width = Math.min(maxWidth, full.width);
  elements.push(
    ...squiggle(PAD, 64 + full.height + 14, Math.max(160, width * 0.5)),
  );
  return { elements, bottom: 64 + full.height + 50 };
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

const titleSlide = (slide: Slide, icons: IconBundle): El[] => {
  const maxWidth = 1300;
  const title = makeText(slide.title, {
    x: (SLIDE_W - maxWidth) / 2,
    y: 0,
    fontSize: 96,
    maxWidth,
    maxLines: 3,
    align: "center",
  });
  const subtitle = slide.subtitle
    ? makeText(slide.subtitle, {
        x: (SLIDE_W - maxWidth) / 2,
        y: 0,
        fontSize: 40,
        maxWidth,
        maxLines: 2,
        align: "center",
        color: MUTED,
      })
    : null;
  const total = title.height + 70 + (subtitle ? subtitle.height : 0);
  const top = (SLIDE_H - total) / 2 - 20;
  const out: El[] = [{ ...title, y: top } as El];
  out.push(
    ...squiggle(
      SLIDE_W / 2 - Math.min(title.width, 900) / 2,
      top + title.height + 22,
      Math.min(title.width, 900),
    ),
  );
  if (subtitle) {
    out.push({ ...subtitle, y: top + title.height + 70 } as El);
  }
  out.push(...placeIcon("lightning", icons, 110, 90, 120));
  return out;
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

const BODY_BOTTOM = SLIDE_H - 90;

const pointsSlide = (
  slide: Slide,
  icons: IconBundle,
  top: number,
  checks = false,
): El[] => {
  const items = slide.points.slice(0, 6);
  const room = SLIDE_H - top - 110;
  const row = Math.min(150, room / items.length);
  const iconSize = Math.min(96, row - 30);
  const fontSize = items.length >= 5 ? 42 : 50;
  const out: El[] = [];
  items.forEach((point, i) => {
    const y = top + i * row;
    const icon = placeIcon(
      checks ? "check" : point.icon || "star",
      icons,
      PAD + 10,
      y,
      iconSize,
    );
    out.push(
      ...(icon.length
        ? icon
        : shapes([
            {
              type: "ellipse",
              x: PAD + 30,
              y: y + iconSize / 2 - 12,
              width: 24,
              height: 24,
              backgroundColor: RED,
              fillStyle: "solid",
              strokeColor: RED,
            },
          ])),
    );
    const text = makeText(point.text, {
      x: PAD + iconSize + 50,
      y: 0,
      fontSize,
      maxWidth: SLIDE_W - PAD * 2 - iconSize - 60,
      maxLines: 2,
    });
    out.push({ ...text, y: y + (iconSize - text.height) / 2 } as El);
  });
  if (checks) {
    // a hand-drawn box around the takeaways
    const [minX, minY, maxX, maxY] = getCommonBounds(out as any);
    out.unshift(
      ...shapes([
        {
          type: "rectangle",
          x: minX - 40,
          y: minY - 30,
          width: maxX - minX + 80,
          height: maxY - minY + 60,
          backgroundColor: "#fff9db",
          fillStyle: "hachure",
          strokeColor: "#f08c00",
          roundness: { type: 3 },
        },
      ]),
    );
  }
  return centerIn(out, top, BODY_BOTTOM);
};

const stepsSlide = (slide: Slide, icons: IconBundle, top: number): El[] => {
  const items = slide.points.slice(0, 5);
  const col = (SLIDE_W - PAD * 2) / items.length;
  const circle = 120;
  const out: El[] = [];
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
          backgroundColor: FILLS[i % FILLS.length],
          fillStyle: "hachure",
          strokeColor: STROKES[i % STROKES.length],
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
    out.push({ ...number, y: y + (circle - number.height) / 2 } as El);
    if (i < items.length - 1) {
      out.push(
        ...shapes([
          {
            type: "arrow",
            x: cx + circle / 2 + 16,
            y: y + circle / 2,
            width: col - circle - 32,
            height: 0,
            strokeWidth: 3,
            points: [
              [0, 0],
              [(col - circle - 32) / 2, -10],
              [col - circle - 32, 0],
            ],
          },
        ]),
      );
    }
    out.push(...placeIcon(point.icon, icons, cx - 60, y + circle + 40, 120));
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

const compareSlide = (slide: Slide, top: number): El[] => {
  const gap = 120;
  const w = (SLIDE_W - PAD * 2 - gap) / 2;
  const h = SLIDE_H - top - 110;
  const out: El[] = [];
  [slide.left!, slide.right!].forEach((sideSpec, i) => {
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
          strokeColor: i ? "#2f9e44" : RED,
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
        color: i ? "#2f9e44" : RED,
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
    fontSize: 52,
    maxWidth: 120,
    align: "center",
    color: RED,
  });
  out.push({ ...vs, y: top + h / 2 - vs.height / 2 } as El);
  return out;
};

const statSlide = (slide: Slide, icons: IconBundle, top: number): El[] => {
  const stat = slide.stat!;
  const value = makeText(stat.value, {
    x: PAD,
    y: 0,
    fontSize: 200,
    maxWidth: SLIDE_W - PAD * 2,
    maxLines: 1,
    align: "center",
    color: RED,
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
  const y = top + (SLIDE_H - top - 110 - block) / 2;
  return [
    { ...value, y } as El,
    ...squiggle(
      SLIDE_W / 2 - value.width / 2,
      y + value.height + 4,
      value.width,
    ),
    { ...label, y: y + value.height + 40 } as El,
    ...placeIcon(stat.icon || "bar-chart", icons, PAD + 20, y + 20, 150),
  ];
};

const quoteSlide = (slide: Slide, top: number): El[] => {
  const quote = slide.quote!;
  const text = makeText(quote.text, {
    x: PAD + 120,
    y: 0,
    fontSize: 56,
    maxWidth: SLIDE_W - PAD * 2 - 240,
    maxLines: 5,
    align: "center",
  });
  const y = top + (SLIDE_H - top - 160 - text.height) / 2;
  const out: El[] = [
    makeText("“", { x: PAD, y: y - 70, fontSize: 220, color: RED }),
    { ...text, y } as El,
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

/**
 * Draws one slide as hand-drawn elements in a 16:9 frame at (originX, originY).
 * `diagram` holds already-rendered sketch elements for "diagram" slides.
 */
export const renderSlide = (
  slide: Slide,
  ctx: {
    index: number;
    deckTitle: string;
    deckId: string;
    icons: IconBundle;
    diagram?: readonly El[];
    originX: number;
    originY: number;
  },
): El[] => {
  const { icons } = ctx;
  let body: El[];
  if (slide.layout === "title") {
    body = titleSlide(slide, icons);
  } else {
    const head = header(slide);
    const top = head.bottom + 20;
    let content: El[];
    switch (slide.layout) {
      case "steps":
        content = stepsSlide(slide, icons, top);
        break;
      case "compare":
        content = compareSlide(slide, top);
        break;
      case "stat":
        content = statSlide(slide, icons, top);
        break;
      case "quote":
        content = quoteSlide(slide, top);
        break;
      case "diagram":
        content = ctx.diagram?.length
          ? fitInto(ctx.diagram, {
              x: PAD,
              y: top,
              w: SLIDE_W - PAD * 2,
              h: SLIDE_H - top - 100,
            })
          : pointsSlide(
              {
                ...slide,
                points: [
                  { text: slide.diagram || slide.title, icon: "network" },
                ],
              },
              icons,
              top,
            );
        break;
      case "summary":
        content = pointsSlide(slide, icons, top + 20, true);
        break;
      default:
        content = pointsSlide(slide, icons, top);
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
        points: slide.points.map((p) => p.text),
        left: slide.left,
        right: slide.right,
        stat: slide.stat,
        quote: slide.quote,
        notes: slide.notes,
      },
    },
  } as El;
  // a white card so exports and the canvas show a clean page
  const [page] = shapes([
    {
      type: "rectangle",
      x: 0,
      y: 0,
      width: SLIDE_W,
      height: SLIDE_H,
      backgroundColor: "#ffffff",
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

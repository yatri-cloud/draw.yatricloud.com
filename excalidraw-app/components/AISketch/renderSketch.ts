import {
  convertToExcalidrawElements,
  FONT_FAMILY,
} from "@excalidraw/excalidraw";
import { randomId, randomInteger } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import {
  logoImage,
  matchLogo,
} from "@excalidraw/excalidraw/components/TTDDialog/logos";

import type { LocalPoint, Radians } from "@excalidraw/math";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import type { LogoBundle } from "@excalidraw/excalidraw/components/TTDDialog/logos";
import type { ExcalidrawElement } from "@excalidraw/element/types";

// ─── Spec: what the model returns (see api/ai/sketch.ts) ─────────────────────

const NODE_KINDS = ["box", "pill", "icon", "bubble", "note"] as const;
type NodeKind = typeof NODE_KINDS[number];

export type SketchNode = {
  id: string;
  kind: NodeKind;
  label: string;
  icon?: string;
  /** id in the official logo bundle, when the node is a real product or cloud service */
  logo?: string;
  color: string;
  emphasis: boolean;
};
export type SketchEdge = {
  from: string;
  to: string;
  label?: string;
  style: "solid" | "dashed";
};
export type SketchChart = {
  caption?: string;
  data: { label: string; value: number; display: string }[];
  stat?: { value: string; label: string };
};
export type SketchSpec = {
  title?: string;
  direction: "LR" | "TB";
  nodes: SketchNode[];
  edges: SketchEdge[];
  groups: { label: string; members: string[] }[];
  chart?: SketchChart;
  footer?: string;
};

export type IconBundle = Record<
  string,
  { width: number; height: number; elements: readonly Record<string, any>[] }
>;

// ─── Look ────────────────────────────────────────────────────────────────────

const PALETTE: Record<string, { bg: string; stroke: string }> = {
  blue: { bg: "#a5d8ff", stroke: "#1971c2" },
  green: { bg: "#b2f2bb", stroke: "#2f9e44" },
  yellow: { bg: "#ffec99", stroke: "#f08c00" },
  violet: { bg: "#d0bfff", stroke: "#6741d9" },
  red: { bg: "#ffc9c9", stroke: "#e03131" },
  orange: { bg: "#ffd8a8", stroke: "#e8590c" },
  gray: { bg: "#e9ecef", stroke: "#868e96" },
  teal: { bg: "#96f2d7", stroke: "#0c8599" },
  pink: { bg: "#fcc2d7", stroke: "#c2255c" },
};
const INK = "#1e1e1e";
const MUTED = "#868e96";
const PILL_BG = "#f1f3f5";
const FONT = FONT_FAMILY.Excalifont;
const ICON_SIZE = 80;
const LOGO_ICON_SIZE = 64;
const CORNER_LOGO = 44;
const GAP_RANK = 190;
const GAP_SIBLING = 72;
const NOTE_FILL = "#fcc2d7";
// boxes the model left uncoloured cycle through these, like the Mermaid restyle
const BOX_CYCLE = [
  "blue",
  "green",
  "violet",
  "orange",
  "teal",
  "pink",
  "yellow",
];

/** Wraps text to lines of at most `width` characters. */
const wrap = (text: string, width: number) => {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= width) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines.join("\n");
};

const ICON_SYNONYMS: Record<string, string> = {
  user: "user-avatar",
  avatar: "user-avatar",
  human: "person",
  customer: "person",
  people: "group-of-people",
  team: "group-of-people",
  users: "group-of-people",
  bot: "robot",
  agent: "robot",
  ai: "robot",
  file: "document",
  doc: "document",
  report: "document",
  files: "documents",
  db: "database",
  storage: "database",
  mobile: "phone",
  smartphone: "phone",
  computer: "laptop",
  pc: "desktop-monitor",
  monitor: "desktop-monitor",
  desktop: "desktop-monitor",
  settings: "gear",
  config: "gear",
  security: "shield",
  envelope: "email",
  message: "chat-bubble",
  chat: "chat-bubble",
  thought: "thought-bubble",
  idea: "thought-bubble",
  lightbulb: "thought-bubble",
  time: "clock",
  alarm: "alarm-clock",
  money: "credit-card",
  payment: "credit-card",
  card: "credit-card",
  web: "browser-window",
  website: "browser-window",
  browser: "browser-window",
  internet: "globe",
  world: "globe",
  shop: "cart",
  store: "cart",
  notification: "bell",
  company: "building",
  office: "building",
  docker: "docker-container",
  container: "docker-container",
  chart: "bar-chart",
  stats: "bar-chart",
  analytics: "bar-chart",
  pie: "pie-chart",
  git: "git-branch",
  branch: "git-branch",
  rack: "server-rack",
  datacenter: "server-rack",
  hierarchy: "org-chart",
  org: "org-chart",
  success: "check",
  done: "check",
  error: "cross",
  fail: "cross",
  alert: "warning",
  api: "network",
  plug: "network",
  rocket: "star",
  deploy: "cloud",
  fast: "lightning",
  speed: "lightning",
};

const pt = (x: number, y: number) => pointFrom<LocalPoint>(x, y);

const textWidth = (text: string, fontSize: number) =>
  Math.max(...text.split("\n").map((line) => line.length)) * fontSize * 0.56;

// ─── Normalise whatever the model returned ───────────────────────────────────

const str = (value: unknown, max = 120) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export const resolveIcon = (name: string, icons: IconBundle) => {
  const key = name
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-");
  if (icons[key]) {
    return key;
  }
  const synonym = ICON_SYNONYMS[key];
  if (synonym && icons[synonym]) {
    return synonym;
  }
  return Object.keys(icons).find(
    (icon) => key.startsWith(icon) || icon.startsWith(key),
  );
};

const humanize = (id: string) => {
  const words = id
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const normalizeSpec = (
  raw: any,
  icons: IconBundle,
  logos?: LogoBundle,
): SketchSpec => {
  if (!raw || typeof raw !== "object") {
    throw new Error("The AI response was not a diagram.");
  }
  const seen = new Set<string>();
  const nodes: SketchNode[] = [];
  for (const node of Array.isArray(raw.nodes) ? raw.nodes.slice(0, 30) : []) {
    const id = str(node?.id, 60);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const isKnownKind = (NODE_KINDS as readonly string[]).includes(node.kind);
    // the model sometimes puts the icon name in "kind" (e.g. "kind": "document")
    const iconName = str(node.icon) || (isKnownKind ? "" : str(node.kind));
    const icon = iconName ? resolveIcon(iconName, icons) : undefined;
    let kind: NodeKind = isKnownKind ? node.kind : icon ? "icon" : "box";
    const givenLabel = str(
      node.label,
      kind === "note" || kind === "bubble" ? 160 : 60,
    );
    // official logo: from the "logo" field, else an icon name or label that names a product
    const logo =
      logos && kind !== "bubble" && kind !== "note" && kind !== "pill"
        ? matchLogo(str(node.logo), logos) ??
          (icon ? undefined : matchLogo(iconName, logos)) ??
          matchLogo(givenLabel, logos)
        : undefined;
    if (kind === "icon" && !icon && !logo) {
      kind = "box";
    }
    // unlabelled nodes use the product name of their logo, else a readable form of their id
    const label = givenLabel || (logo ? logos![logo].title : humanize(id));
    nodes.push({
      id,
      kind,
      // unlabelled nodes fall back to a readable form of their id ("app_reader" -> "App reader")
      label,
      icon: kind === "icon" && !logo ? icon : undefined,
      logo,
      color: PALETTE[node.color] ? node.color : "none",
      emphasis: node.emphasis === true,
    });
  }

  const edges: SketchEdge[] = [];
  for (const edge of Array.isArray(raw.edges) ? raw.edges.slice(0, 60) : []) {
    const from = str(edge?.from, 60);
    const to = str(edge?.to, 60);
    if (seen.has(from) && seen.has(to) && from !== to) {
      edges.push({
        from,
        to,
        label: str(edge.label, 40) || undefined,
        style: edge.style === "dashed" ? "dashed" : "solid",
      });
    }
  }

  const groups = (Array.isArray(raw.groups) ? raw.groups : [])
    .map((group: any) => ({
      label: str(group?.label, 60),
      members: (Array.isArray(group?.members) ? group.members : []).filter(
        (member: unknown) => typeof member === "string" && seen.has(member),
      ),
    }))
    .filter((group: { members: string[] }) => group.members.length > 0);

  let chart: SketchChart | undefined;
  const data = (Array.isArray(raw.chart?.data) ? raw.chart.data : [])
    .slice(0, 16)
    .map((point: any) => {
      const value = Number(point?.value);
      return {
        label: str(point?.label, 20),
        value,
        display: str(point?.display, 12) || String(point?.value ?? ""),
      };
    })
    .filter(
      (point: { value: number }) =>
        Number.isFinite(point.value) && point.value >= 0,
    );
  if (data.length) {
    chart = {
      caption: str(raw.chart.caption, 80) || undefined,
      data,
      stat:
        raw.chart.stat && str(raw.chart.stat.value, 20)
          ? {
              value: str(raw.chart.stat.value, 20),
              label: str(raw.chart.stat.label, 40),
            }
          : undefined,
    };
  }

  if (!nodes.length && !chart) {
    throw new Error(
      "The AI response had nothing to draw. Try describing the diagram in more detail.",
    );
  }
  // A chart already shows the data; drop nodes the model adds that repeat it.
  let keptNodes = nodes;
  let keptEdges = edges;
  if (chart) {
    const chartLabels = new Set(chart.data.map((d) => d.label.toLowerCase()));
    const kinds = new Set(
      (Array.isArray(raw.nodes) ? raw.nodes : [])
        .filter((n: any) => n?.kind === "chart")
        .map((n: any) => str(n.id, 60)),
    );
    const repeats = (node: SketchNode) =>
      chartLabels.has(node.label.toLowerCase()) ||
      kinds.has(node.id) ||
      node.icon === "bar-chart" ||
      node.icon === "pie-chart";
    keptNodes = nodes.filter((node) => !repeats(node));
    const kept = new Set(keptNodes.map((node) => node.id));
    keptEdges = edges.filter((e) => kept.has(e.from) && kept.has(e.to));
  }

  return {
    title: str(raw.title, 80) || undefined,
    direction: raw.direction === "TB" ? "TB" : "LR",
    nodes: keptNodes,
    edges: keptEdges,
    groups,
    chart,
    footer: str(raw.footer, 120) || undefined,
  };
};

// ─── Layout ──────────────────────────────────────────────────────────────────

type Placed = SketchNode & {
  w: number;
  h: number;
  x: number;
  y: number;
  fontSize: number;
  iconW: number;
  iconH: number;
};

const measure = (node: SketchNode, icons: IconBundle): Placed => {
  const base = { ...node, x: 0, y: 0, iconW: 0, iconH: 0 };
  const label = node.label || (node.kind === "icon" ? "" : node.id);
  switch (node.kind) {
    case "icon": {
      const icon = node.logo
        ? { width: LOGO_ICON_SIZE, height: LOGO_ICON_SIZE }
        : icons[node.icon!];
      const scale = node.logo
        ? 1
        : ICON_SIZE / Math.max(icon.width, icon.height);
      const iconW = icon.width * scale;
      const iconH = icon.height * scale;
      const labelW = label ? textWidth(label, 20) : 0;
      return {
        ...base,
        label,
        fontSize: 20,
        iconW,
        iconH,
        w: Math.max(iconW, labelW),
        h: iconH + (label ? 40 : 0),
      };
    }
    case "pill":
      return {
        ...base,
        label,
        fontSize: 20,
        w: textWidth(label, 20) + 48,
        h: 46,
      };
    case "bubble":
      return {
        ...base,
        label,
        fontSize: 20,
        w: Math.min(textWidth(label, 20), 420) + 52,
        h: label.length > 38 ? 92 : 62,
      };
    case "note": {
      // sticky note: wrapped text on a slightly tilted pastel square
      const wrapped = wrap(label, 18);
      const lines = wrapped.split("\n").length;
      return {
        ...base,
        label: wrapped,
        fontSize: 20,
        w: Math.max(170, textWidth(wrapped, 20) + 48),
        h: Math.max(120, lines * 28 + 48),
      };
    }
    default: {
      const fontSize = node.emphasis ? 36 : 20;
      return {
        ...base,
        label,
        fontSize,
        w: Math.max(
          node.emphasis ? 210 : 150,
          textWidth(label, fontSize) + (node.emphasis ? 90 : 52),
        ),
        h: node.emphasis ? 120 : 72,
      };
    }
  }
};

/** Longest-path layering with cycle edges ignored, then barycentre ordering. */
const assignRanks = (ids: string[], edges: SketchEdge[]) => {
  const out = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    out.get(edge.from)?.push(edge.to);
  }
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const next of out.get(id) ?? []) {
      if (state.get(next) === 1) {
        back.add(`${id}>${next}`);
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    state.set(id, 2);
  };
  const hasIncoming = new Set(edges.map((e) => e.to));
  for (const id of [...ids.filter((id) => !hasIncoming.has(id)), ...ids]) {
    if (!state.has(id)) {
      visit(id);
    }
  }
  const rank = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const edge of edges) {
      if (back.has(`${edge.from}>${edge.to}`)) {
        continue;
      }
      const next = rank.get(edge.from)! + 1;
      if (next > rank.get(edge.to)!) {
        rank.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return { rank, back };
};

// ─── Elements ────────────────────────────────────────────────────────────────

type Skeleton = ExcalidrawElementSkeleton;

const shapeSkeleton = (node: Placed): Skeleton[] => {
  const palette = PALETTE[node.color];
  if (node.kind === "note") {
    return [
      {
        type: "rectangle",
        id: node.id,
        x: node.x,
        y: node.y,
        width: node.w,
        height: node.h,
        angle: -0.035 as Radians,
        strokeColor: INK,
        backgroundColor: palette?.bg ?? NOTE_FILL,
        fillStyle: "solid",
        strokeWidth: 1,
        roughness: 1,
        label: {
          text: node.label,
          fontSize: 20,
          fontFamily: FONT,
          strokeColor: INK,
        },
      },
    ];
  }
  const fill =
    node.kind === "pill"
      ? palette?.bg ?? PILL_BG
      : node.kind === "bubble"
      ? "#ffffff"
      : palette?.bg ?? (node.emphasis ? PALETTE.violet.bg : "transparent");
  const rect: Skeleton = {
    type: "rectangle",
    id: node.id,
    x: node.x,
    y: node.y,
    width: node.w,
    height: node.h,
    strokeColor: INK,
    backgroundColor: fill,
    fillStyle: "solid",
    strokeWidth: 2,
    roughness: 1,
    roundness: { type: 3 },
    label: {
      text: node.label,
      fontSize: node.fontSize,
      fontFamily: FONT,
      strokeColor: INK,
    },
  };
  if (node.kind !== "bubble") {
    return [rect];
  }
  // speech-bubble tail pointing down-left at the speaker
  return [
    rect,
    {
      type: "line",
      x: node.x + 34,
      y: node.y + node.h - 2,
      points: [pt(0, 0), pt(-16, 34), pt(26, 0)],
      strokeColor: INK,
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      strokeWidth: 2,
      roughness: 1,
    },
  ];
};

const cloneIcon = (node: Placed, icons: IconBundle): ExcalidrawElement[] => {
  const icon = icons[node.icon!];
  const scale = node.iconW / icon.width;
  const ox = node.x + (node.w - node.iconW) / 2;
  const oy = node.y;
  const ids = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const el of icon.elements) {
    ids.set(el.id, randomId());
  }
  const groupId = `${node.id}-group`;
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
  })) as unknown as ExcalidrawElement[];
};

/** Turns a spec into hand-drawn Excalidraw elements, positioned around (0, 0). */
export const renderSketch = (
  spec: SketchSpec,
  icons: IconBundle,
  logos?: LogoBundle,
  /** force left-to-right or top-to-bottom instead of the automatic choice */
  forceDirection?: "LR" | "TB",
): { elements: ExcalidrawElement[]; logoIds: string[] } => {
  const skeletons: Skeleton[] = [];
  const iconElements: ExcalidrawElement[] = [];
  // logos used by the sketch; their images are loaded by the caller with logoFiles
  const logoIds = new Set<string>();
  const addLogoFile = (id: string) => {
    logoIds.add(id);
  };
  const centered = new Map<string, number>(); // text id -> desired centre x

  let cycle = 0;
  const placed = new Map(
    spec.nodes
      .map((node) =>
        node.kind === "box" && node.color === "none" && !node.emphasis
          ? { ...node, color: BOX_CYCLE[cycle++ % BOX_CYCLE.length] }
          : node,
      )
      .map((node) => [node.id, measure(node, icons)]),
  );
  const bubbleOf = new Map<string, Placed>(); // speaker id -> bubble
  const speakerOf = new Map<string, string>(); // bubble id -> speaker id
  for (const node of placed.values()) {
    if (node.kind !== "bubble") {
      continue;
    }
    // the speaker is whoever points at the bubble; failing that, whatever it points at
    const link =
      spec.edges.find(
        (e) => e.to === node.id && placed.get(e.from)?.kind !== "bubble",
      ) ??
      spec.edges.find(
        (e) => e.from === node.id && placed.get(e.to)?.kind !== "bubble",
      );
    const speaker = link
      ? link.to === node.id
        ? link.from
        : link.to
      : undefined;
    if (speaker && !bubbleOf.has(speaker)) {
      bubbleOf.set(speaker, node);
      speakerOf.set(node.id, speaker);
    }
  }

  // "speaker -> bubble -> listener" becomes "speaker -> listener"; the bubble sits on the speaker
  const flowEdges = spec.edges.filter(
    (e) => !speakerOf.has(e.from) && !speakerOf.has(e.to),
  );
  for (const e of spec.edges) {
    const speaker = speakerOf.get(e.from);
    if (
      speaker &&
      e.to !== speaker &&
      !speakerOf.has(e.to) &&
      !flowEdges.some((f) => f.from === speaker && f.to === e.to)
    ) {
      flowEdges.push({ ...e, from: speaker });
    }
  }
  const connected = new Set([
    ...flowEdges.flatMap((e) => [e.from, e.to]),
    ...bubbleOf.keys(),
  ]);
  const flowIds = spec.nodes
    .map((n) => n.id)
    .filter(
      (id) => !speakerOf.has(id) && (connected.has(id) || connected.size === 0),
    );
  const trayIds = spec.nodes
    .map((n) => n.id)
    .filter((id) => !speakerOf.has(id) && !flowIds.includes(id));

  // ranks, groups pulled into one rank, then order inside each rank
  const { rank, back } = assignRanks(flowIds, flowEdges);
  if (connected.size === 0) {
    flowIds.forEach((id, index) => rank.set(id, index));
  }
  for (const group of spec.groups) {
    const members = group.members.filter((m) => rank.has(m));
    // line up siblings like a list of tools; members that link to each other keep their own ranks
    const linked = flowEdges.some(
      (e) => members.includes(e.from) && members.includes(e.to),
    );
    if (members.length < 2 || linked) {
      continue;
    }
    const target = Math.max(...members.map((m) => rank.get(m)!));
    members.forEach((m) => rank.set(m, target));
  }
  const layers: string[][] = [];
  for (const id of flowIds) {
    (layers[rank.get(id)!] ??= []).push(id);
  }
  const order = new Map<string, number>();
  layers.forEach((layer, r) => {
    if (r > 0) {
      const bary = (id: string) => {
        const preds = flowEdges
          .filter((e) => e.to === id && order.has(e.from))
          .map((e) => order.get(e.from)!);
        return preds.length
          ? preds.reduce((a, b) => a + b, 0) / preds.length
          : Infinity;
      };
      layer.sort((a, b) => bary(a) - bary(b));
    }
    layer.forEach((id, index) => order.set(id, index));
  });
  // left to right reads best for explainers; only long chains go top to bottom
  const LR = forceDirection
    ? forceDirection === "LR"
    : spec.direction !== "TB" || layers.length <= 5;

  // position: ranks along the main axis, siblings across it, all centred on 0
  const extra = (id: string) =>
    bubbleOf.has(id) ? bubbleOf.get(id)!.h + 60 : 0;
  let main = 0;
  for (const layer of layers.filter(Boolean)) {
    const nodes = layer.map((id) => placed.get(id)!);
    const thickness = Math.max(
      ...nodes.map((n) =>
        LR ? Math.max(n.w, bubbleOf.get(n.id)?.w ?? 0) : n.h + extra(n.id),
      ),
    );
    const span = nodes.reduce(
      (sum, n) => sum + (LR ? n.h + extra(n.id) : n.w) + GAP_SIBLING,
      -GAP_SIBLING,
    );
    let cross = -span / 2;
    for (const n of nodes) {
      if (LR) {
        n.x = main + (thickness - n.w) / 2;
        n.y = cross + extra(n.id);
        cross += n.h + extra(n.id) + GAP_SIBLING;
      } else {
        n.x = cross;
        n.y = main + extra(n.id);
        cross += n.w + GAP_SIBLING;
      }
    }
    main += thickness + GAP_RANK;
  }
  for (const [speaker, bubble] of bubbleOf) {
    const s = placed.get(speaker)!;
    bubble.x = s.x + s.w / 2 - 30;
    bubble.y = s.y - bubble.h - 46;
  }

  const bounds = (ids: string[]) => {
    const boxes = ids.map((id) => placed.get(id)!).filter(Boolean);
    return {
      minX: Math.min(...boxes.map((b) => b.x)),
      minY: Math.min(...boxes.map((b) => b.y)),
      maxX: Math.max(...boxes.map((b) => b.x + b.w)),
      maxY: Math.max(...boxes.map((b) => b.y + b.h)),
    };
  };
  const graphIds = [...flowIds, ...speakerOf.keys()];
  let content = graphIds.length
    ? bounds(graphIds)
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  // tray: unconnected pills, boxes and sticky notes in a row under the graph
  const trayShapes = trayIds.map((id) => placed.get(id)!);
  let cursorY = graphIds.length ? content.maxY + 80 : 0;
  if (trayShapes.length) {
    const rowW = trayShapes.reduce((sum, n) => sum + n.w + 32, -32);
    let x = (content.minX + content.maxX) / 2 - rowW / 2;
    for (const n of trayShapes) {
      n.x = x;
      n.y = cursorY;
      x += n.w + 32;
    }
    cursorY += Math.max(...trayShapes.map((n) => n.h)) + 40;
  }
  const allIds = [...graphIds, ...trayIds];
  if (allIds.length) {
    content = bounds(allIds);
  }

  // group captions above each group's members
  for (const group of spec.groups) {
    const members = group.members.filter((m) => flowIds.includes(m));
    if (!members.length || !group.label) {
      continue;
    }
    const b = bounds(members);
    const id = randomId();
    skeletons.push({
      type: "text",
      id,
      x: b.minX,
      y: b.minY - 52,
      text: group.label,
      fontSize: 20,
      fontFamily: FONT,
      strokeColor: MUTED,
    });
    centered.set(id, (b.minX + b.maxX) / 2);
    content.minY = Math.min(content.minY, b.minY - 52);
  }

  // nodes
  for (const node of placed.values()) {
    if (node.kind === "icon") {
      const groupId = `${node.id}-group`;
      // invisible anchor so arrows can bind to the icon
      skeletons.push({
        type: "rectangle",
        id: node.id,
        x: node.x + (node.w - node.iconW) / 2 - 6,
        y: node.y - 6,
        width: node.iconW + 12,
        height: node.iconH + 12,
        strokeColor: "transparent",
        backgroundColor: "transparent",
        groupIds: [groupId],
      });
      if (node.logo) {
        addLogoFile(node.logo);
        iconElements.push(
          logoImage(
            node.logo,
            node.x + (node.w - node.iconW) / 2,
            node.y,
            node.iconW,
            [groupId],
          ),
        );
      } else {
        iconElements.push(...cloneIcon(node, icons));
      }
      if (node.label) {
        const id = randomId();
        skeletons.push({
          type: "text",
          id,
          x: node.x,
          y: node.y + node.iconH + 12,
          text: node.label,
          fontSize: 20,
          fontFamily: FONT,
          strokeColor: INK,
          groupIds: [groupId],
        });
        centered.set(id, node.x + node.w / 2);
      }
    } else if (node.logo && (node.kind === "box" || node.kind === "note")) {
      // official logo on the box's corner, grouped so they move together
      const groupId = `${node.id}-group`;
      addLogoFile(node.logo);
      skeletons.push(
        ...shapeSkeleton(node).map(
          (sk) => ({ ...sk, groupIds: [groupId] } as Skeleton),
        ),
      );
      iconElements.push(
        logoImage(
          node.logo,
          node.x + node.w - CORNER_LOGO * 0.7,
          node.y + node.h - CORNER_LOGO * 0.7,
          CORNER_LOGO,
          [groupId],
        ),
      );
    } else {
      skeletons.push(...shapeSkeleton(node));
    }
  }

  // arrows between node borders; links that point back become green curves
  const border = (n: Placed, toward: { x: number; y: number }) => {
    const top = n.kind === "icon" ? n.y - 6 : n.y;
    const h = n.kind === "icon" ? n.iconH + 12 : n.h;
    const cx = n.x + n.w / 2;
    const cy = top + h / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;
    const halfW = (n.kind === "icon" ? n.iconW + 12 : n.w) / 2;
    const t = Math.min(
      dx ? halfW / Math.abs(dx) : Infinity,
      dy ? h / 2 / Math.abs(dy) : Infinity,
    );
    return { x: cx + dx * t, y: cy + dy * t, cx, cy };
  };
  for (const edge of flowEdges) {
    const a = placed.get(edge.from)!;
    const b = placed.get(edge.to)!;
    const aCenter = border(a, { x: 0, y: 0 });
    const bCenter = border(b, { x: 0, y: 0 });
    const start = border(a, { x: bCenter.cx, y: bCenter.cy });
    const end = border(b, { x: aCenter.cx, y: aCenter.cy });
    const isBack =
      back.has(`${edge.from}>${edge.to}`) ||
      rank.get(edge.to)! < rank.get(edge.from)!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // back links curve to one side of the straight line so they do not cover the forward arrow
    const length = Math.hypot(dx, dy) || 1;
    const bend = isBack
      ? { x: dx / 2 + (dy / length) * 70, y: dy / 2 - (dx / length) * 70 }
      : null;
    skeletons.push({
      type: "arrow",
      x: start.x,
      y: start.y,
      points: bend
        ? [pt(0, 0), pt(bend.x, bend.y), pt(dx, dy)]
        : [pt(0, 0), pt(dx, dy)],
      strokeColor: isBack ? PALETTE.green.stroke : INK,
      strokeWidth: 2,
      strokeStyle: edge.style,
      roughness: 1,
      roundness: bend ? { type: 2 } : null,
      start: { id: edge.from },
      end: { id: edge.to },
      ...(edge.label
        ? { label: { text: edge.label, fontSize: 16, fontFamily: FONT } }
        : null),
    } as unknown as Skeleton);
  }

  // chart under the graph (or on its own)
  if (spec.chart) {
    const { data, caption, stat } = spec.chart;
    const barW = 80;
    const gap = 36;
    const plotH = 280;
    const plotW = data.length * barW + (data.length - 1) * gap;
    const statW = stat
      ? Math.max(textWidth(stat.value, 64), textWidth(stat.label, 22)) + 120
      : 0;
    const left = allIds.length
      ? (content.minX + content.maxX) / 2 - (plotW + statW) / 2
      : -(plotW + statW) / 2;
    const top = allIds.length ? content.maxY + 110 : 0;
    const max = Math.max(...data.map((d) => d.value)) || 1;
    const median = [...data.map((d) => d.value)].sort((a, b) => a - b)[
      Math.floor(data.length / 2)
    ];
    if (caption) {
      skeletons.push({
        type: "text",
        x: left,
        y: top,
        text: caption,
        fontSize: 20,
        fontFamily: FONT,
        strokeColor: MUTED,
      });
    }
    const baseY = top + 60 + plotH;
    data.forEach((d, i) => {
      const h = Math.max(6, (d.value / max) * plotH);
      const x = left + i * (barW + gap);
      skeletons.push({
        type: "rectangle",
        x,
        y: baseY - h,
        width: barW,
        height: h,
        strokeColor: INK,
        backgroundColor:
          d.value > median ? PALETTE.orange.bg : PALETTE.yellow.bg,
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 1,
        roundness: { type: 3 },
      });
      const valueId = randomId();
      skeletons.push({
        type: "text",
        id: valueId,
        x,
        y: baseY - h - 34,
        text: d.display,
        fontSize: 20,
        fontFamily: FONT,
        strokeColor: INK,
      });
      centered.set(valueId, x + barW / 2);
      const labelId = randomId();
      skeletons.push({
        type: "text",
        id: labelId,
        x,
        y: baseY + 14,
        text: d.label,
        fontSize: 18,
        fontFamily: FONT,
        strokeColor: MUTED,
      });
      centered.set(labelId, x + barW / 2);
    });
    skeletons.push({
      type: "line",
      x: left - 20,
      y: baseY,
      points: [pt(0, 0), pt(plotW + 40, 0)],
      strokeColor: INK,
      strokeWidth: 2,
      roughness: 1,
    });
    if (stat) {
      const cx = left + plotW + statW / 2 + 40;
      const valueId = randomId();
      skeletons.push({
        type: "text",
        id: valueId,
        x: cx,
        y: top + 120,
        text: stat.value,
        fontSize: 64,
        fontFamily: FONT,
        strokeColor: INK,
      });
      centered.set(valueId, cx);
      if (stat.label) {
        const labelId = randomId();
        skeletons.push({
          type: "text",
          id: labelId,
          x: cx,
          y: top + 210,
          text: stat.label,
          fontSize: 22,
          fontFamily: FONT,
          strokeColor: MUTED,
        });
        centered.set(labelId, cx);
      }
    }
    const chartBox = {
      minX: left - 20,
      minY: top,
      maxX: left + plotW + statW + 40,
      maxY: baseY + 50,
    };
    content = allIds.length
      ? {
          minX: Math.min(content.minX, chartBox.minX),
          minY: content.minY,
          maxX: Math.max(content.maxX, chartBox.maxX),
          maxY: chartBox.maxY,
        }
      : chartBox;
  }

  // title with a coloured underline, footer as a one-line takeaway
  const midX = (content.minX + content.maxX) / 2;
  if (spec.title) {
    const id = randomId();
    const y = content.minY - 150;
    const w = textWidth(spec.title, 44);
    skeletons.push({
      type: "text",
      id,
      x: midX - w / 2,
      y,
      text: spec.title,
      fontSize: 44,
      fontFamily: FONT,
      strokeColor: INK,
    });
    centered.set(id, midX);
    skeletons.push({
      type: "line",
      x: midX - w / 2 - 10,
      y: y + 70,
      points: [pt(0, 0), pt(w + 20, 0)],
      strokeColor: PALETTE.blue.stroke,
      strokeWidth: 4,
      roughness: 1,
    });
  }
  if (spec.footer) {
    const id = randomId();
    skeletons.push({
      type: "text",
      id,
      x: midX,
      y: content.maxY + 70,
      text: spec.footer,
      fontSize: 28,
      fontFamily: FONT,
      strokeColor: INK,
    });
    centered.set(id, midX);
  }

  const converted = convertToExcalidrawElements(skeletons, {
    regenerateIds: false,
  });
  const recentered = converted.map((el) =>
    el.type === "text" && centered.has(el.id)
      ? { ...el, x: centered.get(el.id)! - el.width / 2 }
      : el,
  );
  return {
    elements: [...recentered, ...iconElements] as ExcalidrawElement[],
    logoIds: [...logoIds],
  };
};

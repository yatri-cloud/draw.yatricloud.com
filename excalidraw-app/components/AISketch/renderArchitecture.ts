import {
  convertToExcalidrawElements,
  FONT_FAMILY,
} from "@excalidraw/excalidraw";
import {
  logoImage,
  matchLogo,
} from "@excalidraw/excalidraw/components/TTDDialog/logos";

import type {
  CloudIconManifest,
  LogoBundle,
} from "@excalidraw/excalidraw/components/TTDDialog/logos";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";

// ─── Spec: what the model returns (see api/ai/architecture.ts) ───────────────

const GROUP_TYPES = [
  "cloud",
  "account",
  "region",
  "az",
  "vpc",
  "public_subnet",
  "private_subnet",
  "onprem",
  "cluster",
  "generic",
] as const;
type GroupType = typeof GROUP_TYPES[number];

export type ArchGroup = {
  id: string;
  type: GroupType;
  label: string;
  parent?: string;
};
export type ArchNode = {
  id: string;
  service: string;
  label: string;
  group?: string;
};
export type ArchEdge = {
  from: string;
  to: string;
  label?: string;
  dashed: boolean;
  bidirectional: boolean;
};
export type ArchSpec = {
  title?: string;
  direction: "LR" | "TB";
  groups: ArchGroup[];
  nodes: ArchNode[];
  edges: ArchEdge[];
};

const str = (value: unknown, max = 80) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const isId = (value: string) => /^[A-Za-z0-9_-]{1,60}$/.test(value);

export const normalizeArchSpec = (raw: any): ArchSpec => {
  if (!raw || typeof raw !== "object") {
    throw new Error("The AI response was not an architecture diagram.");
  }
  const groups: ArchGroup[] = [];
  const groupIds = new Set<string>();
  for (const g of Array.isArray(raw.groups) ? raw.groups.slice(0, 30) : []) {
    const id = str(g?.id, 60);
    if (!isId(id) || groupIds.has(id)) {
      continue;
    }
    groupIds.add(id);
    groups.push({
      id,
      type: (GROUP_TYPES as readonly string[]).includes(g.type)
        ? g.type
        : "generic",
      label: str(g.label) || id,
      parent: str(g.parent, 60) || undefined,
    });
  }
  // drop unknown parents and cycles
  const parentOf = new Map(groups.map((g) => [g.id, g.parent]));
  for (const g of groups) {
    const seen = new Set([g.id]);
    let parent = g.parent;
    while (parent) {
      if (!groupIds.has(parent) || seen.has(parent)) {
        g.parent = undefined;
        parentOf.set(g.id, undefined);
        break;
      }
      seen.add(parent);
      parent = parentOf.get(parent);
    }
  }

  const nodes: ArchNode[] = [];
  const nodeIds = new Set<string>();
  for (const n of Array.isArray(raw.nodes) ? raw.nodes.slice(0, 40) : []) {
    const id = str(n?.id, 60);
    if (!isId(id) || nodeIds.has(id) || groupIds.has(id)) {
      continue;
    }
    const service = str(n.service) || str(n.label) || id;
    nodeIds.add(id);
    nodes.push({
      id,
      service,
      label: str(n.label) || service,
      group: groupIds.has(str(n.group, 60)) ? str(n.group, 60) : undefined,
    });
  }

  const edges: ArchEdge[] = [];
  const seenEdges = new Set<string>();
  for (const e of Array.isArray(raw.edges) ? raw.edges.slice(0, 80) : []) {
    const from = str(e?.from, 60);
    const to = str(e?.to, 60);
    const key = `${from}>${to}`;
    if (
      nodeIds.has(from) &&
      nodeIds.has(to) &&
      from !== to &&
      !seenEdges.has(key)
    ) {
      seenEdges.add(key);
      edges.push({
        from,
        to,
        label: str(e.label, 40) || undefined,
        dashed: e.style === "dashed",
        bidirectional: e.bidirectional === true,
      });
    }
  }

  if (!nodes.length) {
    throw new Error(
      "The AI response had no services to draw. Try describing the system in more detail.",
    );
  }
  // keep only groups that contain something
  const used = new Set<string>();
  for (const n of nodes) {
    let g = n.group;
    while (g && !used.has(g)) {
      used.add(g);
      g = parentOf.get(g);
    }
  }
  return {
    title: str(raw.title, 80) || undefined,
    direction: raw.direction === "TB" ? "TB" : "LR",
    groups: groups.filter((g) => used.has(g.id)),
    nodes,
    edges,
  };
};

// ─── Icons ───────────────────────────────────────────────────────────────────

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9.+#]+/g, " ")
    .trim();

/**
 * Icon lookup for architecture diagrams: every official icon (services first,
 * then resources and groups) by exact name, plus the regular matcher.
 */
export const buildArchitectureIcons = (
  logos: LogoBundle,
  manifest: CloudIconManifest | null,
) => {
  // name -> candidate ids, best first; generic names ("Users") exist for several providers
  const exact = new Map<string, string[]>();
  // singular form too, so "Access Point" finds AWS's "Access Points"
  const singular = (key: string) => key.replace(/(\w{3,})s$/, "$1");
  const add = (name: string, id: string) => {
    const key = normalize(name);
    if (key.length < 2) {
      return;
    }
    for (const form of new Set([key, singular(key)])) {
      const ids = exact.get(form) ?? [];
      if (!ids.includes(id)) {
        exact.set(form, [...ids, id]);
      }
    }
  };
  const order = { service: 0, resource: 1, group: 2, category: 3 } as Record<
    string,
    number
  >;
  const icons = [...(manifest?.icons ?? [])].sort(
    (a, b) => (order[a.k] ?? 9) - (order[b.k] ?? 9),
  );
  const bundle: LogoBundle = { ...logos };
  for (const icon of icons) {
    bundle[icon.id] ??= {
      title: icon.t,
      aliases: [],
      category: icon.c,
      provider: icon.p,
      url: `/cloud-icons/${icon.p}/${icon.id}.svg`,
    };
    add(icon.t, icon.id);
    // "Elastic Load Balancing: Application Load Balancer" -> "Application Load Balancer"
    const part = icon.t.split(": ")[1];
    if (part && part.includes(" ")) {
      add(part, icon.id);
    }
    for (const alias of icon.a) {
      add(alias, icon.id);
    }
  }
  for (const [id, logo] of Object.entries(logos)) {
    add(logo.title, id);
  }
  const pick = (ids: string[] | undefined, provider?: string) =>
    ids && (ids.find((id) => bundle[id]?.provider === provider) ?? ids[0]);
  /** `provider` breaks ties between same-named icons, e.g. AWS vs Azure "Users". */
  const lookup = (name: string, provider?: string) =>
    pick(exact.get(name), provider) ??
    pick(exact.get(singular(name)), provider);
  const resolve = (service: string, label: string, provider?: string) => {
    const name = normalize(service);
    const bare = name.replace(
      /^(amazon|aws|azure|microsoft|google cloud|google|gcp) /,
      "",
    );
    const direct = lookup(name, provider) ?? lookup(bare, provider);
    if (direct) {
      return direct;
    }
    // "Amazon DynamoDB Global Tables" -> "Amazon DynamoDB"
    const words = name.split(" ");
    for (let n = words.length - 1; n >= 2; n--) {
      const shorter = lookup(words.slice(0, n).join(" "), provider);
      if (shorter) {
        return shorter;
      }
    }
    return matchLogo(service, logos) ?? matchLogo(label, logos);
  };
  /** The provider most services in the spec belong to. */
  const mainProvider = (services: string[]) => {
    const counts = new Map<string, number>();
    for (const service of services) {
      const provider = bundle[resolve(service, service) ?? ""]?.provider;
      if (provider) {
        counts.set(provider, (counts.get(provider) ?? 0) + 1);
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  return { bundle, resolve, mainProvider };
};

// ─── Look ────────────────────────────────────────────────────────────────────

const INK = "#232f3e";
const EDGE = "#545b64";
const FONT = FONT_FAMILY.Nunito;
const ICON = 56;
const NODE_W = 140;
const NODE_H = ICON + 52;

type GroupStyle = {
  stroke: string;
  fill: string;
  dashed: boolean;
  icon?: string;
};
const GROUP_STYLE: Record<GroupType, GroupStyle> = {
  cloud: {
    stroke: INK,
    fill: "transparent",
    dashed: false,
    icon: "aws-group-aws-cloud-logo",
  },
  account: {
    stroke: "#e7157b",
    fill: "transparent",
    dashed: false,
    icon: "aws-group-aws-account",
  },
  region: {
    stroke: "#00a4a6",
    fill: "transparent",
    dashed: true,
    icon: "aws-group-region",
  },
  az: { stroke: "#00a4a6", fill: "transparent", dashed: true },
  vpc: {
    stroke: "#8c4fff",
    fill: "transparent",
    dashed: false,
    icon: "aws-group-virtual-private-cloud-vpc",
  },
  public_subnet: {
    stroke: "#7aa116",
    fill: "#f2f6e8",
    dashed: false,
    icon: "aws-group-public-subnet",
  },
  private_subnet: {
    stroke: "#00a4a6",
    fill: "#e6f6f7",
    dashed: false,
    icon: "aws-group-private-subnet",
  },
  onprem: {
    stroke: "#7d8998",
    fill: "transparent",
    dashed: false,
    icon: "aws-group-corporate-data-center",
  },
  cluster: { stroke: "#ed7100", fill: "transparent", dashed: true },
  generic: { stroke: "#7d8998", fill: "transparent", dashed: true },
};

const textWidth = (text: string, size: number) =>
  Math.max(...text.split("\n").map((l) => l.length)) * size * 0.58;

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
  return lines.slice(0, 3).join("\n");
};

// ─── Layout (ELK) ────────────────────────────────────────────────────────────

let elkPromise: Promise<{
  layout: (graph: ElkNode) => Promise<ElkNode>;
}> | null = null;
const loadElk = () =>
  (elkPromise ??= import("elkjs/lib/elk.bundled.js").then((mod) => {
    const ELK = (mod as any).default ?? mod;
    return new ELK();
  }));

type Box = { x: number; y: number; width: number; height: number };
export type ArchLayout = {
  groups: Map<string, Box>;
  nodes: Map<string, Box>;
  edges: Map<string, { x: number; y: number }[]>;
};

export const layoutArchitecture = async (
  spec: ArchSpec,
  direction: "LR" | "TB",
): Promise<ArchLayout> => {
  const elk = await loadElk();
  const children = new Map<string | undefined, ElkNode[]>();
  const push = (parent: string | undefined, node: ElkNode) =>
    children.set(parent, [...(children.get(parent) ?? []), node]);
  for (const n of spec.nodes) {
    push(n.group, { id: n.id, width: NODE_W, height: NODE_H });
  }
  const build = (group: ArchGroup): ElkNode => ({
    id: group.id,
    layoutOptions: {
      "elk.padding": "[top=56,left=28,bottom=28,right=28]",
    },
    children: [
      ...spec.groups.filter((g) => g.parent === group.id).map(build),
      ...(children.get(group.id) ?? []),
    ],
  });
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction === "LR" ? "RIGHT" : "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
      "elk.spacing.nodeNode": "56",
      "elk.spacing.edgeNode": "28",
      "elk.spacing.edgeEdge": "18",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.edgeLabels.placement": "CENTER",
      "elk.json.shapeCoords": "ROOT",
      "elk.json.edgeCoords": "ROOT",
    },
    children: [
      ...spec.groups.filter((g) => !g.parent).map(build),
      ...(children.get(undefined) ?? []),
    ],
    edges: spec.edges.map(
      (e, i): ElkExtendedEdge => ({
        id: `e${i}`,
        sources: [e.from],
        targets: [e.to],
        labels: e.label
          ? [{ text: e.label, width: textWidth(e.label, 14) + 12, height: 22 }]
          : [],
      }),
    ),
  };
  const result = await elk.layout(graph);

  const groups = new Map<string, Box>();
  const nodes = new Map<string, Box>();
  const groupIds = new Set(spec.groups.map((g) => g.id));
  const walk = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      const box = {
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? 0,
        height: child.height ?? 0,
      };
      (groupIds.has(child.id) ? groups : nodes).set(child.id, box);
      walk(child);
    }
  };
  walk(result);
  const edges = new Map<string, { x: number; y: number }[]>();
  const collect = (node: ElkNode) => {
    for (const edge of (node.edges ?? []) as ElkExtendedEdge[]) {
      const section = edge.sections?.[0];
      if (section) {
        edges.set(edge.id, [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ]);
      }
    }
    for (const child of node.children ?? []) {
      collect(child);
    }
  };
  collect(result);
  return { groups, nodes, edges };
};

// ─── Elements ────────────────────────────────────────────────────────────────

/**
 * Draws an architecture spec in the official provider style: icons with
 * labels, nested group containers with their group icons, orthogonal links.
 * Returns the logo ids used; load their images with `logoFiles`.
 */
export const renderArchitecture = (
  spec: ArchSpec,
  layout: ArchLayout,
  icons: ReturnType<typeof buildArchitectureIcons>,
): { elements: ExcalidrawElement[]; logoIds: string[] } => {
  const skeletons: ExcalidrawElementSkeleton[] = [];
  const images: ExcalidrawElement[] = [];
  const logoIds = new Set<string>();
  const centered = new Map<string, number>();
  const provider = icons.mainProvider(spec.nodes.map((n) => n.service));

  // groups, outermost first so inner ones draw on top
  const depth = (g: ArchGroup): number => {
    const parent = spec.groups.find((x) => x.id === g.parent);
    return parent ? depth(parent) + 1 : 0;
  };
  for (const group of [...spec.groups].sort((a, b) => depth(a) - depth(b))) {
    const box = layout.groups.get(group.id);
    if (!box) {
      continue;
    }
    const style = GROUP_STYLE[group.type];
    skeletons.push({
      type: "rectangle",
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      strokeColor: style.stroke,
      backgroundColor: style.fill,
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: style.dashed ? "dashed" : "solid",
      roughness: 0,
    });
    // official AWS group icons only in AWS diagrams
    const iconId =
      provider === "aws" && style.icon && icons.bundle[style.icon]
        ? style.icon
        : undefined;
    if (iconId) {
      logoIds.add(iconId);
      images.push(logoImage(iconId, box.x, box.y, 32) as ExcalidrawElement);
    }
    skeletons.push({
      type: "text",
      x: box.x + (iconId ? 40 : 12),
      y: box.y + 8,
      text: group.label,
      fontSize: 16,
      fontFamily: FONT,
      strokeColor: style.stroke === "transparent" ? INK : style.stroke,
    });
  }

  // services: official icon, label underneath, invisible anchor for links
  for (const node of spec.nodes) {
    const box = layout.nodes.get(node.id);
    if (!box) {
      continue;
    }
    const iconId = icons.resolve(node.service, node.label, provider);
    const cx = box.x + box.width / 2;
    skeletons.push({
      type: "rectangle",
      id: node.id,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      roughness: 0,
    });
    if (iconId) {
      logoIds.add(iconId);
      images.push(
        logoImage(iconId, cx - ICON / 2, box.y + 4, ICON) as ExcalidrawElement,
      );
    } else {
      // no official icon: a neat rounded tile with the initials
      skeletons.push({
        type: "rectangle",
        x: cx - ICON / 2,
        y: box.y + 4,
        width: ICON,
        height: ICON,
        strokeColor: INK,
        backgroundColor: "#e9ecef",
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 0,
        roundness: { type: 3 },
        label: {
          text: node.label
            .split(/\s+/)
            .map((w) => w[0])
            .join("")
            .slice(0, 3)
            .toUpperCase(),
          fontSize: 16,
          fontFamily: FONT,
        },
      });
    }
    const id = `${node.id}-label`;
    skeletons.push({
      type: "text",
      id,
      x: cx,
      y: box.y + ICON + 10,
      text: wrap(node.label, 18),
      fontSize: 14,
      fontFamily: FONT,
      textAlign: "center",
      strokeColor: INK,
    });
    centered.set(id, cx);
  }

  // links along the orthogonal routes ELK computed
  spec.edges.forEach((edge, i) => {
    const route = layout.edges.get(`e${i}`);
    if (!route || route.length < 2) {
      return;
    }
    const [start, ...rest] = route;
    skeletons.push({
      type: "arrow",
      x: start.x,
      y: start.y,
      points: [[0, 0], ...rest.map((p) => [p.x - start.x, p.y - start.y])],
      strokeColor: EDGE,
      strokeWidth: 2,
      strokeStyle: edge.dashed ? "dashed" : "solid",
      roughness: 0,
      roundness: null,
      startArrowhead: edge.bidirectional ? "arrow" : null,
      endArrowhead: "arrow",
      ...(edge.label
        ? {
            label: {
              text: edge.label,
              fontSize: 14,
              fontFamily: FONT,
              strokeColor: INK,
            },
          }
        : null),
    } as unknown as ExcalidrawElementSkeleton);
  });

  // title above everything
  if (spec.title) {
    const all = [...layout.groups.values(), ...layout.nodes.values()];
    const minX = Math.min(...all.map((b) => b.x));
    const minY = Math.min(...all.map((b) => b.y));
    skeletons.push({
      type: "text",
      x: minX,
      y: minY - 64,
      text: spec.title,
      fontSize: 28,
      fontFamily: FONT,
      strokeColor: INK,
    });
  }

  const converted = convertToExcalidrawElements(skeletons, {
    regenerateIds: false,
  }).map((el) =>
    el.type === "text" && centered.has(el.id)
      ? { ...el, x: centered.get(el.id)! - el.width / 2 }
      : el,
  );
  return {
    elements: [...converted, ...images] as ExcalidrawElement[],
    logoIds: [...logoIds],
  };
};

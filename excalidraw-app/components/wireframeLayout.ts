import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

/** keeps the request small enough for the model's context */
const MAX_LINES = 300;
const MAX_TEXT = 200;

type Box = { x: number; y: number; w: number; h: number };
type Node = { el: ExcalidrawElement; box: Box; children: Node[] };

const CONTAINERS = new Set(["rectangle", "ellipse", "diamond", "frame"]);

const boxOf = (el: ExcalidrawElement, origin: Box): Box => ({
  x: Math.round(Math.min(el.x, el.x + el.width) - origin.x),
  y: Math.round(Math.min(el.y, el.y + el.height) - origin.y),
  w: Math.round(Math.abs(el.width)),
  h: Math.round(Math.abs(el.height)),
});

const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 2 &&
  inner.y >= outer.y - 2 &&
  inner.x + inner.w <= outer.x + outer.w + 2 &&
  inner.y + inner.h <= outer.y + outer.h + 2 &&
  inner.w * inner.h < outer.w * outer.h;

const clip = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT)}…` : flat;
};

const device = (width: number) =>
  width <= 500 ? "mobile" : width <= 1000 ? "tablet" : "desktop";

const colors = (el: ExcalidrawElement) => {
  const parts: string[] = [];
  if (el.backgroundColor && el.backgroundColor !== "transparent") {
    parts.push(`fill ${el.backgroundColor}`);
  }
  if (el.strokeStyle !== "solid") {
    parts.push(`${el.strokeStyle} border`);
  }
  if (el.roundness) {
    parts.push("rounded");
  }
  return parts;
};

/**
 * Describes a wireframe as an indented outline: each shape with its position
 * and size inside the frame, its label, and the shapes nested in it. A
 * text-only model can rebuild the layout from this without seeing the image.
 */
export const describeWireframe = (
  frame: ExcalidrawFrameLikeElement,
  children: readonly ExcalidrawElement[],
) => {
  const origin: Box = { x: frame.x, y: frame.y, w: 0, h: 0 };
  const live = children.filter((el) => !el.isDeleted);
  const byId = new Map(live.map((el) => [el.id, el]));

  // a shape's bound text is its label, not a separate element
  const labels = new Map<string, string>();
  for (const el of live) {
    if (el.type === "text" && el.containerId && byId.has(el.containerId)) {
      labels.set(el.containerId, clip(el.originalText || el.text));
    }
  }

  const nodes: Node[] = live
    .filter(
      (el) =>
        !(el.type === "text" && el.containerId && byId.has(el.containerId)),
    )
    .map((el) => ({ el, box: boxOf(el, origin), children: [] }));

  // each element hangs under the smallest shape that contains it
  const roots: Node[] = [];
  for (const node of nodes) {
    const parent = nodes
      .filter(
        (other) =>
          other !== node &&
          CONTAINERS.has(other.el.type) &&
          inside(node.box, other.box),
      )
      .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0];
    (parent ? parent.children : roots).push(node);
  }

  const lines: string[] = [
    `Frame "${frame.name ?? "Wireframe"}": ${Math.round(
      frame.width,
    )}x${Math.round(frame.height)} px (${device(frame.width)} layout)`,
  ];

  const describe = (node: Node): string => {
    const { el, box } = node;
    const at = `at (${box.x},${box.y}) ${box.w}x${box.h}`;
    const label = labels.get(el.id);
    const extra = colors(el);
    const quoted = label ? ` "${label}"` : "";
    switch (el.type) {
      case "text": {
        const text = el as ExcalidrawTextElement;
        return `text ${at}, font ${text.fontSize}px${
          text.textAlign !== "left" ? `, ${text.textAlign}` : ""
        }: "${clip(text.originalText || text.text)}"`;
      }
      case "line":
        return box.h <= 4
          ? `horizontal line ${at}`
          : box.w <= 4
          ? `vertical line ${at}`
          : `line ${at}`;
      case "arrow": {
        const arrow = el as Extract<ExcalidrawElement, { type: "arrow" }>;
        const from = arrow.startBinding?.elementId;
        const to = arrow.endBinding?.elementId;
        const name = (id?: string) =>
          (id && (labels.get(id) || byId.get(id)?.type)) || "?";
        return from || to
          ? `arrow from ${name(from)} to ${name(to)}${quoted}`
          : `arrow ${at}${quoted}`;
      }
      case "image":
        return `image ${at}`;
      case "freedraw":
        return `scribble ${at} (decorative mark or icon)`;
      default:
        return `${el.type}${quoted} ${at}${
          extra.length ? `, ${extra.join(", ")}` : ""
        }`;
    }
  };

  const order = (list: Node[]) =>
    [...list].sort((a, b) =>
      Math.abs(a.box.y - b.box.y) > 12 ? a.box.y - b.box.y : a.box.x - b.box.x,
    );

  const walk = (list: Node[], depth: number) => {
    for (const node of order(list)) {
      if (lines.length >= MAX_LINES) {
        return;
      }
      lines.push(`${"  ".repeat(depth)}- ${describe(node)}`);
      walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);

  if (lines.length >= MAX_LINES) {
    lines.push("- … (more elements omitted)");
  }
  return lines.join("\n");
};

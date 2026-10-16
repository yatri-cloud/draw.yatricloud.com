import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

// Colour families: pastel fill for nodes, light tint + stroke for the group that holds them.
const FAMILIES = [
  { node: "#a5d8ff", tint: "#e7f5ff", stroke: "#1971c2" }, // blue
  { node: "#b2f2bb", tint: "#ebfbee", stroke: "#2f9e44" }, // green
  { node: "#d0bfff", tint: "#f3f0ff", stroke: "#6741d9" }, // violet
  { node: "#ffd8a8", tint: "#fff4e6", stroke: "#e8590c" }, // orange
  { node: "#fcc2d7", tint: "#fff0f6", stroke: "#c2255c" }, // pink
  { node: "#96f2d7", tint: "#e6fcf5", stroke: "#0c8599" }, // teal
  { node: "#ffec99", tint: "#fff9db", stroke: "#f08c00" }, // yellow
];
const DECISION = FAMILIES[6];
const INK = "#1e1e1e";

/** Mermaid flowchart settings with the given gaps between siblings and between layers. */
export const mermaidLayoutConfig = (nodeSpacing: number, rankSpacing: number) =>
  ({
    flowchart: {
      curve: "basis",
      nodeSpacing,
      rankSpacing,
      padding: 26,
      diagramPadding: 24,
    },
    themeVariables: { fontSize: "20px" },
  } as const);

/** Default: roomy layout with curved links. */
export const SPACIOUS_MERMAID_CONFIG = mermaidLayoutConfig(110, 130);

/**
 * Spacing variations tried when fitting a diagram to a frame shape: balanced,
 * wider gaps between siblings, wider gaps between layers.
 */
export const LAYOUT_SPACING_PRESETS: [number, number][] = [
  [110, 130],
  [180, 100],
  [90, 200],
];

type Shape = NonDeletedExcalidrawElement;

const isShape = (el: NonDeletedExcalidrawElement) =>
  el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond";

const contains = (outer: Shape, inner: Shape) =>
  outer !== inner &&
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width &&
  outer.y + outer.height >= inner.y + inner.height;

/**
 * Restyles a diagram converted from Mermaid: groups (subgraphs) get a tinted
 * background with a dashed coloured border, nodes get the matching pastel fill,
 * standalone nodes cycle through the palette, and decisions are yellow.
 */
export const beautifyDiagram = (
  elements: readonly NonDeletedExcalidrawElement[],
): NonDeletedExcalidrawElement[] => {
  const shapes = elements.filter(isShape);
  const groups = shapes
    .filter((shape) => shapes.some((other) => contains(shape, other)))
    // reading order, so neighbouring groups get different colours
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const groupFamily = new Map(
    groups.map((group, index) => [group.id, FAMILIES[index % FAMILIES.length]]),
  );
  // a node takes the colour of the smallest group that contains it
  const innermostGroup = (shape: Shape) =>
    groups
      .filter((group) => contains(group, shape))
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];

  let loose = 0;
  const style = new Map<string, Partial<ExcalidrawElement>>();
  const textColor = new Map<string, string>(); // container id -> label colour

  for (const shape of [...shapes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const rounded =
      shape.type === "rectangle" ? { roundness: { type: 3 as const } } : {};
    const family = groupFamily.get(shape.id);
    if (family) {
      style.set(shape.id, {
        backgroundColor: family.tint,
        strokeColor: family.stroke,
        strokeStyle: "dashed",
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 1,
        ...rounded,
      });
      textColor.set(shape.id, family.stroke);
      continue;
    }
    const parent = innermostGroup(shape);
    const fill =
      shape.type === "diamond"
        ? DECISION.node
        : parent
        ? groupFamily.get(parent.id)!.node
        : FAMILIES[loose++ % FAMILIES.length].node;
    style.set(shape.id, {
      backgroundColor: fill,
      strokeColor: INK,
      fillStyle: "solid",
      strokeWidth: 2,
      roughness: 1,
      ...rounded,
    });
    textColor.set(shape.id, INK);
  }

  return elements.map((el) => {
    if (style.has(el.id)) {
      return { ...el, ...style.get(el.id) } as NonDeletedExcalidrawElement;
    }
    if (el.type === "text" && el.containerId && textColor.has(el.containerId)) {
      return { ...el, strokeColor: textColor.get(el.containerId)! };
    }
    if (el.type === "arrow" || el.type === "line") {
      return { ...el, strokeColor: INK, strokeWidth: 2, roughness: 1 };
    }
    return el;
  });
};

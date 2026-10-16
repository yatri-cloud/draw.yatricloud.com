/**
 * Mermaid rewrites that let long flows fill a square (or 4:5) frame.
 *
 * Mermaid lays every flowchart out along one axis, so a 16-step pipeline comes
 * out as a thin column or strip. These helpers turn top-level groups
 * (subgraphs) into columns or rows: links between groups are drawn group to
 * group, and each group gets its own direction, which Mermaid only honours when
 * no link crosses the group's border node to node.
 */

const ID = "[A-Za-z_][A-Za-z0-9_]*";
const SHAPE = String.raw`(?:\[[^\]]*\]|\(\([^)]*\)\)|\([^)]*\)|\{\{[^}]*\}\}|\{[^}]*\}|>[^\]]*\])`;
const ARROW = String.raw`(?:<-->|-->|---|==>|-\.->)`;
const EDGE_LINE = new RegExp(
  String.raw`^(\s*)(${ID})(${SHAPE})?\s*(${ARROW})\s*(?:\|\s*([^|]*?)\s*\|\s*)?(${ID})(${SHAPE})?\s*;?\s*$`,
);
const HEADER = /^\s*(?:flowchart|graph)\b/;
const SUBGRAPH = new RegExp(String.raw`^\s*subgraph\s+(${ID})`);
const END = /^\s*end\s*;?\s*$/;
const DIRECTION = /^\s*direction\s+(?:TB|TD|BT|LR|RL)\s*;?\s*$/;
const STYLING = /^\s*(?:classDef|class|style|linkStyle)\s/;

const CHAIN_SPLIT = new RegExp(String.raw`\s*(${ARROW})\s*(\|[^|]*\|)?\s*`);

/**
 * Splits chained links ("A --> B --> C") into one link per line, so every
 * link can be analysed and rewritten on its own.
 */
export const splitChainedEdges = (definition: string) =>
  definition
    .split("\n")
    .flatMap((line) => {
      if (SUBGRAPH.test(line) || HEADER.test(line)) {
        return [line];
      }
      const parts = line.trim().replace(/;$/, "").split(CHAIN_SPLIT);
      // parts: node, arrow, label, node, arrow, label, node ...
      if (parts.length < 7) {
        return [line];
      }
      const indent = /^\s*/.exec(line)![0];
      const links: string[] = [];
      for (let i = 0; i + 3 < parts.length; i += 3) {
        links.push(
          `${indent}${parts[i]} ${parts[i + 1]}${parts[i + 2] ?? ""} ${
            parts[i + 3]
          }`,
        );
      }
      return links;
    })
    .join("\n");

/** Removes classDef/class/style/linkStyle lines; colours are applied by the app. */
export const stripMermaidStyling = (definition: string) =>
  definition
    .split("\n")
    .filter((line) => !STYLING.test(line))
    .join("\n");

const idsInLine = (line: string): string[] => {
  const edge = EDGE_LINE.exec(line);
  if (edge) {
    return [edge[2], edge[6]];
  }
  const lead = new RegExp(String.raw`^\s*(${ID})\s*(?:${SHAPE}|;|$)`).exec(
    line,
  );
  return lead && !["end", "direction", "subgraph", "click"].includes(lead[1])
    ? [lead[1]]
    : [];
};

/** Top-level subgraph of every node declared or linked inside it. */
const topLevelMembership = (lines: string[]) => {
  const owner = new Map<string, string>();
  const groups: string[] = [];
  let depth = 0;
  let current: string | null = null;
  for (const line of lines) {
    const start = SUBGRAPH.exec(line);
    if (start) {
      if (depth === 0) {
        current = start[1];
        groups.push(current);
      }
      depth++;
      continue;
    }
    if (END.test(line) && depth > 0) {
      depth--;
      if (depth === 0) {
        current = null;
      }
      continue;
    }
    if (current) {
      for (const id of idsInLine(line)) {
        if (!owner.has(id)) {
          owner.set(id, current);
        }
      }
    }
  }
  return { owner, groups };
};

/**
 * Splits a long flowchart without groups into evenly sized stages
 * ("Steps 1-4", "Steps 5-8", ...), so it can wrap into columns or rows.
 * Returns null when the diagram already has groups or is short.
 */
export const chunkIntoStages = (definition: string, minNodes = 8) => {
  const lines = definition.split("\n");
  if (!lines.some((line) => HEADER.test(line))) {
    return null;
  }
  if (lines.some((line) => SUBGRAPH.test(line))) {
    return null;
  }
  const order: string[] = [];
  for (const line of lines) {
    if (HEADER.test(line)) {
      continue;
    }
    for (const id of idsInLine(line)) {
      if (!order.includes(id)) {
        order.push(id);
      }
    }
  }
  if (order.length < minNodes) {
    return null;
  }
  const size = Math.ceil(Math.sqrt(order.length));
  const stages: string[] = [];
  for (let i = 0; i < order.length; i += size) {
    const ids = order.slice(i, i + size);
    const n = i / size + 1;
    stages.push(
      `    subgraph Stage${n}["Steps ${i + 1}-${i + ids.length}"]`,
      ...ids.map((id) => `        ${id}`),
      "    end",
    );
  }
  return [...lines, ...stages].join("\n");
};

/**
 * Lays the top-level groups out as columns (outer "LR", steps top to bottom
 * inside each group) or rows (outer "TB", steps left to right). Links between
 * groups become group-to-group links. Returns null with fewer than two groups.
 */
export const toPhaseLayout = (definition: string, outer: "LR" | "TB") => {
  const lines = definition.split("\n");
  const headerIndex = lines.findIndex((line) => HEADER.test(line));
  if (headerIndex === -1) {
    return null;
  }
  const { owner, groups } = topLevelMembership(lines);
  if (groups.length < 2) {
    return null;
  }
  const inner = outer === "LR" ? "TB" : "LR";
  const out: string[] = [];
  const groupLinks = new Set<string>();
  let depth = 0;

  lines.forEach((line, index) => {
    if (index === headerIndex) {
      out.push(line.replace(/^(\s*(?:flowchart|graph)).*$/, `$1 ${outer}`));
      return;
    }
    const start = SUBGRAPH.exec(line);
    if (start) {
      out.push(line);
      if (depth === 0) {
        out.push(`        direction ${inner}`);
      }
      depth++;
      return;
    }
    if (END.test(line) && depth > 0) {
      depth--;
      out.push(line);
      return;
    }
    if (DIRECTION.test(line) && depth === 1) {
      return; // replaced by the inner direction above
    }
    const edge = EDGE_LINE.exec(line);
    if (edge) {
      const [, indent, from, fromShape, arrow, label, to, toShape] = edge;
      const a = owner.get(from);
      const b = owner.get(to);
      if (a && b && a !== b) {
        // keep any node labels declared inline on this link
        if (fromShape) {
          out.push(`${indent}${from}${fromShape}`);
        }
        if (toShape) {
          out.push(`${indent}${to}${toShape}`);
        }
        const key = `${a}>${b}`;
        if (!groupLinks.has(key)) {
          groupLinks.add(key);
          out.push(
            `${indent}${a} ${arrow}${
              label ? `|"${label.replace(/"/g, "")}"|` : ""
            } ${b}`,
          );
        }
        return;
      }
    }
    out.push(line);
  });
  return out.join("\n");
};

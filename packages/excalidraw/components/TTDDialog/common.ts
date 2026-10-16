import {
  DEFAULT_EXPORT_PADDING,
  EDITOR_LS_KEYS,
  THEME,
} from "@excalidraw/common";

import { convertToExcalidrawElements } from "@excalidraw/element";

import { exportToCanvas } from "@excalidraw/utils";

import type {
  NonDeletedExcalidrawElement,
  Theme,
} from "@excalidraw/element/types";

import type { MermaidConfig } from "@excalidraw/mermaid-to-excalidraw";

import { EditorLocalStorage } from "../../data/EditorLocalStorage";

import {
  beautifyDiagram,
  LAYOUT_SPACING_PRESETS,
  mermaidLayoutConfig,
  SPACIOUS_MERMAID_CONFIG,
} from "./beautifyDiagram";
import {
  aspectMismatch,
  FRAME_RATIOS,
  frameAspect,
  wrapInAspectFrame,
} from "./frame";

import { addLogosToDiagram, loadLogos, logoFiles } from "./logos";
import { freeInsertPosition } from "./placement";

import {
  chunkIntoStages,
  splitChainedEdges,
  stripMermaidStyling,
  toPhaseLayout,
} from "./wrapLayout";

import type { FrameRatio } from "./frame";

import type { DiagramDirection } from "./TTDContext";
import type { MermaidToExcalidrawLibProps } from "./types";

import type { AppClassProperties, BinaryFiles } from "../../types";

export const resetPreview = ({
  canvasRef,
  setError,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  setError: (error: Error | null) => void;
}) => {
  const canvasNode = canvasRef.current;

  if (!canvasNode) {
    return;
  }
  const parent = canvasNode.parentElement;
  if (!parent) {
    return;
  }
  parent.style.background = "";
  setError(null);
  canvasNode.replaceChildren();
};

export const autoQuoteMermaidLabels = (mermaidCode: string): string => {
  if (!mermaidCode) {
    return "";
  }

  const lines = mermaidCode.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Skip lines that are comments or don't look like they contain node declarations
    if (line.trim().startsWith("%%")) {
      continue;
    }

    // Prefix pattern that can precede a valid node ID:
    // Start of line, whitespace, or any standard Mermaid arrow/connector
    const prefix = /(^|\s+|-->|---|-\.-?\.>|==>)\s*/.source;

    // 1. Match square brackets: ID[label] -> ID["label"]
    const squareRegex = new RegExp(
      `${prefix}([a-zA-Z0-9_-]+)\\s*(\\[)\\s*([^"\\s][^\\]]*?)(\\s*\\])`,
      "g",
    );
    line = line.replace(
      squareRegex,
      (match, prefixMatch, id, openBrack, label, closeBrack) => {
        const cleanedLabel = label.replace(/"/g, "'").trim();
        return `${prefixMatch}${id}["${cleanedLabel}"]`;
      },
    );

    // 2. Match round brackets: ID(label) -> ID("label")
    const roundRegex = new RegExp(
      `${prefix}([a-zA-Z0-9_-]+)\\s*(\\()\\s*([^"\\s][^\\)]*?)(\\s*\\))`,
      "g",
    );
    line = line.replace(
      roundRegex,
      (match, prefixMatch, id, openBrack, label, closeBrack) => {
        const cleanedLabel = label.replace(/"/g, "'").trim();
        return `${prefixMatch}${id}("${cleanedLabel}")`;
      },
    );

    // 3. Match curly brackets: ID{label} -> ID{"label"}
    const curlyRegex = new RegExp(
      `${prefix}([a-zA-Z0-9_-]+)\\s*(\\{)\\s*([^"\\s][^\\}]*?)(\\s*\\})`,
      "g",
    );
    line = line.replace(
      curlyRegex,
      (match, prefixMatch, id, openBrack, label, closeBrack) => {
        const cleanedLabel = label.replace(/"/g, "'").trim();
        return `${prefixMatch}${id}{"${cleanedLabel}"}`;
      },
    );

    lines[i] = line;
  }

  return lines.join("\n");
};

export const cleanMermaidMessage = (content: string): string => {
  if (!content) {
    return "";
  }

  let cleaned = "";

  // 1. Check for closed ```mermaid block
  let match = content.match(/```mermaid\s*([\s\S]*?)\s*```/);
  if (match) {
    cleaned = match[1].trim();
  } else {
    // 2. Check for unclosed ```mermaid block (e.g. streaming)
    match = content.match(/```mermaid\s*([\s\S]*)/);
    if (match) {
      cleaned = match[1].trim();
    } else {
      // 3. Check for closed generic ``` block
      match = content.match(/```\s*([\s\S]*?)\s*```/);
      if (match) {
        cleaned = match[1].trim();
      } else {
        // 4. Check for unclosed generic ``` block (e.g. streaming)
        match = content.match(/```\s*([\s\S]*)/);
        if (match) {
          cleaned = match[1].trim();
        } else {
          // 5. If there are any leftover markdown fences, strip them
          cleaned = content
            .replace(/```mermaid/g, "")
            .replace(/```/g, "")
            .trim();
        }
      }
    }
  }

  // Auto-quote unquoted labels to prevent syntax errors
  return autoQuoteMermaidLabels(cleaned);
};

const MAX_MERGED_LABEL = 28;

const SIMPLE_EDGE =
  /^(\s*)([A-Za-z0-9_]+)\s*-->\s*(?:\|\s*"?([^|"]*?)"?\s*\|\s*)?([A-Za-z0-9_]+)\s*;?\s*$/;

/**
 * Merges a link and its reverse ("A --> B" and "B --> A") into one
 * two-headed arrow with both labels, so request/response pairs do not draw as
 * two parallel arrows with overlapping labels.
 */
export const mergeReverseEdges = (definition: string) => {
  const lines = definition.split("\n");
  const edges = lines.map((line) => SIMPLE_EDGE.exec(line));
  const removed = new Set<number>();
  edges.forEach((edge, i) => {
    if (!edge || removed.has(i)) {
      return;
    }
    const j = edges.findIndex(
      (other, k) =>
        k > i &&
        !removed.has(k) &&
        other &&
        other[2] === edge[4] &&
        other[4] === edge[2],
    );
    if (j === -1) {
      return;
    }
    const parts = [edge[3], edges[j]![3]]
      .map((text) => text?.trim())
      .filter(Boolean) as string[];
    // long combined labels collide with neighbouring links; keep the first one
    const label =
      parts.join(" / ").length <= MAX_MERGED_LABEL
        ? parts.join(" / ")
        : parts[0];
    lines[i] = `${edge[1]}${edge[2]} <-->${label ? `|"${label}"|` : ""} ${
      edge[4]
    }`;
    removed.add(j);
  });
  return lines.filter((_, k) => !removed.has(k)).join("\n");
};

/** Rewrites the flowchart header to the chosen direction; other diagram types are unchanged. */
export const applyDiagramDirection = (
  definition: string,
  direction: DiagramDirection = "auto",
) =>
  direction === "auto"
    ? definition
    : definition.replace(
        /^(\s*(?:flowchart|graph))(?:[ \t]+(?:TD|TB|LR|RL|BT))?[ \t]*;?[ \t]*$/m,
        `$1 ${direction}`,
      );

type ParseApi = Awaited<MermaidToExcalidrawLibProps["api"]>;

/** Width and height of a parsed (not yet converted) Mermaid result. */
const parsedSize = (elements: readonly any[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    if (typeof el.width === "number" && typeof el.height === "number") {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    }
  }
  return Number.isFinite(minX)
    ? { width: maxX - minX, height: maxY - minY }
    : null;
};

/** The direction and spacing whose layout comes closest to the frame shape. */
const pickArrangement = async (
  api: ParseApi,
  definition: string,
  direction: DiagramDirection,
  aspect: number,
) => {
  const directions: DiagramDirection[] =
    direction === "auto" ? ["LR", "TB"] : [direction];
  // plain left-to-right / top-to-bottom, with each spacing preset
  const variants: { definition: string; presets: [number, number][] }[] =
    directions.map((dir) => ({
      definition: applyDiagramDirection(definition, dir),
      presets: LAYOUT_SPACING_PRESETS,
    }));
  // wrapped: groups (or stages of a long chain) as columns or rows
  const single = splitChainedEdges(definition);
  const grouped = chunkIntoStages(single) ?? single;
  for (const outer of direction === "auto"
    ? (["LR", "TB"] as const)
    : ([direction === "LR" ? "LR" : "TB"] as const)) {
    const wrapped = toPhaseLayout(grouped, outer);
    if (wrapped) {
      variants.push({
        definition: wrapped,
        presets: LAYOUT_SPACING_PRESETS.slice(0, 2),
      });
    }
  }
  let best: { definition: string; config: unknown; score: number } | null =
    null;
  for (const { definition: candidate, presets } of variants) {
    for (const [nodeSpacing, rankSpacing] of presets) {
      const config = mermaidLayoutConfig(nodeSpacing, rankSpacing);
      try {
        const parsed = await api.parseMermaidToExcalidraw(
          candidate,
          config as unknown as MermaidConfig,
        );
        const size = parsedSize(parsed.elements);
        const score = size
          ? aspectMismatch(size.width, size.height, aspect)
          : Infinity;
        if (!best || score < best.score) {
          best = { definition: candidate, config, score };
        }
      } catch {
        // invalid in this arrangement; the normal path reports parse errors
      }
    }
  }
  return best;
};

export const convertMermaidToExcalidraw = async ({
  canvasRef,
  mermaidToExcalidrawLib,
  mermaidDefinition,
  setError,
  data,
  theme,
  direction = "auto",
  frameRatio = "free",
  fitArrangement = true,
}: {
  /** try several arrangements to best fill the frame (skipped while streaming) */
  fitArrangement?: boolean;
  direction?: DiagramDirection;
  /** fit the diagram to this shape and wrap it in a frame of that ratio */
  frameRatio?: FrameRatio;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  mermaidToExcalidrawLib: MermaidToExcalidrawLibProps;
  mermaidDefinition: string;
  setError: (error: Error | null) => void;
  data: React.MutableRefObject<{
    elements: readonly NonDeletedExcalidrawElement[];
    files: BinaryFiles | null;
  }>;
  theme: Theme;
}): Promise<{ success: true } | { success: false; error?: Error }> => {
  const canvasNode = canvasRef.current;
  const parent = canvasNode?.parentElement;

  if (!canvasNode || !parent) {
    return { success: false };
  }

  const cleanedDefinition = mergeReverseEdges(
    applyDiagramDirection(
      stripMermaidStyling(
        cleanMermaidMessage(mermaidDefinition) || mermaidDefinition,
      ),
      direction,
    ),
  );

  if (!cleanedDefinition) {
    resetPreview({ canvasRef, setError });
    return { success: false };
  }

  let ret;
  try {
    const api = await mermaidToExcalidrawLib.api;

    // For a framed shape, try left-to-right and top-to-bottom with different
    // spacing and keep the arrangement whose shape is closest to the frame.
    const aspect = frameAspect(frameRatio);
    let layoutConfig: unknown = SPACIOUS_MERMAID_CONFIG;
    let definition = cleanedDefinition;
    if (
      aspect &&
      fitArrangement &&
      /^\s*(?:flowchart|graph)\b/m.test(cleanedDefinition)
    ) {
      const best = await pickArrangement(
        api,
        cleanedDefinition,
        direction,
        aspect,
      );
      if (best) {
        definition = best.definition;
        layoutConfig = best.config;
      }
    }

    try {
      ret = await api.parseMermaidToExcalidraw(
        definition,
        layoutConfig as MermaidConfig,
      );
    } catch (err: unknown) {
      const originalParseError = err as Error;

      if (!cleanedDefinition.includes('"')) {
        return { success: false, error: originalParseError };
      }

      try {
        ret = await api.parseMermaidToExcalidraw(
          definition.replace(/"/g, "'"),
          layoutConfig as MermaidConfig,
        );
      } catch {
        // Keep the original error so line/column references stay aligned with
        // the user's unmodified input.
        return { success: false, error: originalParseError };
      }
    }

    const { elements, files = {} } = ret;
    setError(null);

    const styled = beautifyDiagram(
      convertToExcalidrawElements(elements as any, {
        regenerateIds: true,
      }),
    );
    // official logos on nodes that name a product or cloud service
    const logos = await loadLogos().catch(() => null);
    const withLogos = logos
      ? addLogosToDiagram(styled, logos)
      : { elements: styled, logoIds: [] };
    const logoImages = logos ? await logoFiles(withLogos.logoIds, logos) : {};

    data.current = {
      elements: aspect
        ? wrapInAspectFrame(
            withLogos.elements,
            aspect,
            FRAME_RATIOS.find((r) => r.value === frameRatio)!.title,
          )
        : withLogos.elements,
      files: { ...files, ...logoImages },
    };

    const canvas = await exportToCanvas({
      elements: data.current.elements,
      files: data.current.files,
      exportPadding: DEFAULT_EXPORT_PADDING,
      maxWidthOrHeight:
        Math.max(parent.offsetWidth, parent.offsetHeight) *
        window.devicePixelRatio,
      appState: {
        exportWithDarkMode: theme === THEME.DARK,
      },
    });

    parent.style.background = "var(--default-bg-color)";
    canvasNode.replaceChildren(canvas);
    return { success: true };
  } catch (err: any) {
    parent.style.background = "var(--default-bg-color)";
    if (cleanedDefinition) {
      setError(err);
    }

    // Return error so caller can display meaningful error message
    return { success: false, error: err };
  }
};
export const saveMermaidDataToStorage = (mermaidDefinition: string) => {
  EditorLocalStorage.set(
    EDITOR_LS_KEYS.MERMAID_TO_EXCALIDRAW,
    mermaidDefinition,
  );
};

export const insertToEditor = ({
  app,
  data,
  text,
  shouldSaveMermaidDataToStorage,
}: {
  app: AppClassProperties;
  data: React.MutableRefObject<{
    elements: readonly NonDeletedExcalidrawElement[];
    files: BinaryFiles | null;
  }>;
  text?: string;
  shouldSaveMermaidDataToStorage?: boolean;
}) => {
  const { elements: newElements, files } = data.current;

  if (!newElements.length) {
    return;
  }

  app.addElementsFromPasteOrLibrary({
    elements: newElements,
    files,
    // next to existing drawings instead of on top of them
    position: freeInsertPosition(app, newElements),
    fit: "scale-down",
  });
  app.setOpenDialog(null);

  if (shouldSaveMermaidDataToStorage && text) {
    saveMermaidDataToStorage(text);
  }
};

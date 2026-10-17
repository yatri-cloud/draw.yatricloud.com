import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  beautifyDiagram,
  SPACIOUS_MERMAID_CONFIG,
} from "@excalidraw/excalidraw/components/TTDDialog/beautifyDiagram";
import {
  addLogosToDiagram,
  loadCloudIconManifest,
  logoFiles,
} from "@excalidraw/excalidraw/components/TTDDialog/logos";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { LogoBundle } from "@excalidraw/excalidraw/components/TTDDialog/logos";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import {
  buildArchitectureIcons,
  layoutArchitecture,
  normalizeArchSpec,
  renderArchitecture,
} from "../AISketch/renderArchitecture";
import { normalizeSpec, renderSketch } from "../AISketch/renderSketch";

import type { IconBundle } from "../AISketch/renderSketch";
import type { Slide } from "./renderSlide";

/** A drawn slide visual plus the image files it needs. */
export type Drawn = { elements: ExcalidrawElement[]; files: BinaryFiles };

type Post = (url: string, body: unknown) => Promise<any>;

/** "diagram" slides: a hand-drawn explainer from AI Sketch. */
export const drawSketch = async (
  slide: Slide,
  ctx: { post: Post; icons: IconBundle; logos?: LogoBundle },
): Promise<Drawn> => {
  const data = await ctx.post("/api/ai/sketch", {
    prompt: slide.diagram,
    icons: Object.keys(ctx.icons),
  });
  const spec = normalizeSpec(data.spec, ctx.icons, ctx.logos);
  const drawn = renderSketch(
    { ...spec, title: undefined, footer: undefined },
    ctx.icons,
    ctx.logos,
    "LR",
  );
  return {
    elements: drawn.elements,
    files: ctx.logos ? await logoFiles(drawn.logoIds, ctx.logos) : {},
  };
};

/** "flow" slides: a colourful flowchart from Text to diagram (Mermaid). */
export const drawFlow = async (
  slide: Slide,
  ctx: { post: Post; logos?: LogoBundle },
): Promise<Drawn> => {
  const data = await ctx.post("/api/ai/chat", {
    message: `${slide.diagram}\n\nMake it a compact flowchart LR with at most 8 nodes.`,
    stream: false,
  });
  const definition: string = data?.response ?? "";
  if (!/^\s*(flowchart|graph|sequenceDiagram)\b/m.test(definition)) {
    throw new Error("no flowchart");
  }
  const { parseMermaidToExcalidraw } = await import(
    "@excalidraw/mermaid-to-excalidraw"
  );
  const parsed = await parseMermaidToExcalidraw(
    definition,
    SPACIOUS_MERMAID_CONFIG as any,
  );
  if (parsed.files && Object.keys(parsed.files).length) {
    // drawn as a picture rather than shapes; a list reads better on a slide
    throw new Error("unsupported diagram type");
  }
  const styled = beautifyDiagram(
    convertToExcalidrawElements(parsed.elements as any, {
      regenerateIds: true,
    }),
  ) as NonDeletedExcalidrawElement[];
  if (!ctx.logos) {
    return { elements: styled, files: {} };
  }
  const withLogos = addLogosToDiagram(styled, ctx.logos);
  return {
    elements: withLogos.elements,
    files: await logoFiles(withLogos.logoIds, ctx.logos),
  };
};

/** "architecture" slides: a cloud diagram from AI Architecture, with official icons. */
export const drawArchitecture = async (
  slide: Slide,
  ctx: { post: Post; logos?: LogoBundle },
): Promise<Drawn> => {
  const [data, manifest] = await Promise.all([
    ctx.post("/api/ai/architecture", { prompt: slide.diagram }),
    loadCloudIconManifest().catch(() => null),
  ]);
  const spec = normalizeArchSpec(data.spec);
  const icons = buildArchitectureIcons(ctx.logos ?? {}, manifest);
  const drawn = renderArchitecture(
    spec,
    await layoutArchitecture(spec, "LR"),
    icons,
  );
  return {
    elements: drawn.elements,
    files: await logoFiles(drawn.logoIds, icons.bundle),
  };
};

/** "chart" slides: the hand-drawn bar chart from AI Sketch, from the slide's numbers. */
export const drawChart = (slide: Slide, icons: IconBundle): Drawn => {
  const drawn = renderSketch(
    {
      direction: "LR",
      nodes: [],
      edges: [],
      groups: [],
      chart: { caption: slide.chart!.caption, data: slide.chart!.data },
    },
    icons,
  );
  return { elements: drawn.elements, files: {} };
};

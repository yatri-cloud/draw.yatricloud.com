import { getCommonBounds, newFrameElement } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

/** Output shapes for generated diagrams; square suits social posts and explainers. */
export type FrameRatio = "1:1" | "4:5" | "16:9" | "free";

export const FRAME_RATIOS: {
  value: FrameRatio;
  label: string;
  title: string;
}[] = [
  { value: "1:1", label: "Square", title: "Square 1:1 (social posts)" },
  { value: "4:5", label: "4:5", title: "Portrait 4:5 (Instagram, LinkedIn)" },
  { value: "16:9", label: "16:9", title: "Wide 16:9 (slides, video)" },
  { value: "free", label: "Free", title: "No frame, natural size" },
];

export const DEFAULT_FRAME_RATIO: FrameRatio = "1:1";

/** width / height for a ratio, or null for no frame */
export const frameAspect = (ratio: FrameRatio) => {
  if (ratio === "free") {
    return null;
  }
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
};

/** 0 when the box has exactly the target shape; grows as it gets wider or taller. */
export const aspectMismatch = (width: number, height: number, aspect: number) =>
  Math.abs(Math.log(Math.max(width, 1) / Math.max(height, 1) / aspect));

const PADDING_RATIO = 0.05;

/**
 * Puts the elements in a frame of exactly `aspect` (width / height): the
 * diagram is centred, nothing is cropped, and the frame adds padding around it.
 */
export const wrapInAspectFrame = (
  elements: readonly NonDeletedExcalidrawElement[],
  aspect: number,
  name: string,
): NonDeletedExcalidrawElement[] => {
  const content = elements.filter((el) => el.type !== "frame");
  if (!content.length) {
    return [...elements];
  }
  const [minX, minY, maxX, maxY] = getCommonBounds(content);
  const pad = Math.max(maxX - minX, maxY - minY) * PADDING_RATIO + 32;
  let width = maxX - minX + pad * 2;
  let height = maxY - minY + pad * 2;
  if (width / height > aspect) {
    height = width / aspect;
  } else {
    width = height * aspect;
  }
  const frame = newFrameElement({
    x: (minX + maxX) / 2 - width / 2,
    y: (minY + maxY) / 2 - height / 2,
    width,
    height,
    name,
  });
  return [
    ...content.map(
      (el) => ({ ...el, frameId: frame.id } as NonDeletedExcalidrawElement),
    ),
    frame,
  ];
};

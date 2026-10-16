import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { AppClassProperties } from "../../types";

const GAP = 160;

/**
 * Where to insert generated elements so they do not land on top of existing
 * drawings: to the right of everything on the canvas, top-aligned with it.
 * An empty canvas uses the viewport centre.
 */
export const freeInsertPosition = (
  app: AppClassProperties,
  elements: readonly ExcalidrawElement[],
): { clientX: number; clientY: number } | "center" => {
  const existing = app.scene.getNonDeletedElements();
  if (!existing.length || !elements.length) {
    return "center";
  }
  const [, sceneMinY, sceneMaxX] = getCommonBounds(existing);
  const [minX, minY, maxX, maxY] = getCommonBounds(elements);
  const { x, y } = sceneCoordsToViewportCoords(
    {
      sceneX: sceneMaxX + GAP + (maxX - minX) / 2,
      sceneY: sceneMinY + (maxY - minY) / 2,
    },
    app.state,
  );
  return { clientX: x, clientY: y };
};

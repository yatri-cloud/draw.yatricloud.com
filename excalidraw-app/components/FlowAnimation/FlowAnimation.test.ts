import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import type { ExcalidrawArrowElement } from "@excalidraw/element/types";

import { flowRanks } from "./FlowAnimation";

describe("flow animation order", () => {
  it("orders bound arrows along the flow, even when listed out of order", () => {
    const box = (id: string, x: number) => ({
      type: "rectangle" as const,
      id,
      x,
      y: 0,
      width: 100,
      height: 60,
    });
    const arrow = (id: string, from: string, to: string, x: number) => ({
      type: "arrow" as const,
      id,
      x,
      y: 30,
      width: 100,
      height: 0,
      start: { id: from },
      end: { id: to },
    });
    const elements = convertToExcalidrawElements(
      [
        box("a", 0),
        box("b", 200),
        box("c", 400),
        box("d", 600),
        arrow("cd", "c", "d", 500),
        arrow("ab", "a", "b", 100),
        arrow("bc", "b", "c", 300),
      ] as any,
      { regenerateIds: false },
    );
    const arrows = elements.filter(
      (el) => el.type === "arrow",
    ) as ExcalidrawArrowElement[];
    const ranks = Object.fromEntries(
      flowRanks(arrows).map((rank, i) => [arrows[i].id, rank]),
    );
    expect(ranks).toEqual({ ab: 0, bc: 1, cd: 2 });
  });
});

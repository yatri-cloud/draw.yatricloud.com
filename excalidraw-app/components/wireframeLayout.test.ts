import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";

import { describeWireframe } from "./wireframeLayout";

describe("wireframe outline", () => {
  it("nests shapes, uses labels and positions relative to the frame", () => {
    const elements = convertToExcalidrawElements(
      [
        {
          type: "frame",
          id: "f",
          x: 100,
          y: 100,
          width: 1200,
          height: 600,
          children: ["nav", "logo", "cta", "note"],
        },
        {
          type: "rectangle",
          id: "nav",
          x: 100,
          y: 100,
          width: 1200,
          height: 60,
        },
        {
          type: "text",
          id: "logo",
          x: 120,
          y: 115,
          text: "Acme",
          fontSize: 24,
        },
        {
          type: "rectangle",
          id: "cta",
          x: 600,
          y: 300,
          width: 140,
          height: 44,
          label: { text: "Get started" },
        },
        {
          type: "text",
          id: "note",
          x: 120,
          y: 500,
          text: "button opens a modal",
        },
      ] as any,
      { regenerateIds: false },
    );
    const frame = elements.find(
      (el) => el.type === "frame",
    ) as ExcalidrawFrameLikeElement;
    const outline = describeWireframe(
      frame,
      elements.filter((el) => el.type !== "frame"),
    );
    const lines = outline.split("\n");

    expect(lines[0]).toMatch(/^Frame ".*": 1200x600 px \(desktop layout\)$/);
    expect(lines[1]).toBe("- rectangle at (0,0) 1200x60");
    expect(lines[2]).toMatch(/^ {2}- text at \(20,15\) .*font 24px: "Acme"$/);
    expect(outline).toContain('- rectangle "Get started" at (500,200) 140x44');
    // the label is part of its box, not a separate text line
    expect(outline.match(/Get started/g)).toHaveLength(1);
    expect(lines.at(-1)).toMatch(/text at \(20,400\).*"button opens a modal"$/);
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  applyDiagramDirection,
  convertMermaidToExcalidraw,
  mergeReverseEdges,
} from "./common";

type ConvertMermaidArgs = Parameters<typeof convertMermaidToExcalidraw>[0];
type ParseMermaidToExcalidraw = Awaited<
  ConvertMermaidArgs["mermaidToExcalidrawLib"]["api"]
>["parseMermaidToExcalidraw"];

const createConvertArgs = (
  mermaidDefinition: string,
  parseMermaidToExcalidraw: ParseMermaidToExcalidraw,
): ConvertMermaidArgs => {
  const parent = document.createElement("div");
  const canvas = document.createElement("div");
  parent.appendChild(canvas);

  return {
    canvasRef: { current: canvas },
    mermaidToExcalidrawLib: {
      loaded: true,
      api: Promise.resolve({ parseMermaidToExcalidraw }),
    },
    mermaidDefinition,
    setError: vi.fn(),
    data: {
      current: {
        elements: [],
        files: null,
      },
    },
    theme: "light",
  };
};

describe("convertMermaidToExcalidraw", () => {
  it("returns the original parse error when quote-normalized fallback also fails", async () => {
    const originalError = new Error("Parse error on line 9: ...");
    const fallbackError = new Error("Parse error on line 6: ...");

    const parseMermaidToExcalidraw = vi
      .fn<ParseMermaidToExcalidraw>()
      .mockRejectedValueOnce(originalError)
      .mockRejectedValueOnce(fallbackError);

    const mermaidDefinition =
      'graph TD\nA["One"]\nB["Two"]x\nC["Three"]\nD["Four"]';

    const result = await convertMermaidToExcalidraw(
      createConvertArgs(mermaidDefinition, parseMermaidToExcalidraw),
    );

    expect(parseMermaidToExcalidraw).toHaveBeenCalledTimes(2);
    // second argument is the layout config (spacing, curved links)
    expect(parseMermaidToExcalidraw).toHaveBeenNthCalledWith(
      1,
      mermaidDefinition,
      expect.anything(),
    );
    expect(parseMermaidToExcalidraw).toHaveBeenNthCalledWith(
      2,
      mermaidDefinition.replace(/"/g, "'"),
      expect.anything(),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(originalError);
    }
  });

  it("does not retry quote normalization when the input has no double quotes", async () => {
    const originalError = new Error("Parse error on line 9: ...");
    const parseMermaidToExcalidraw = vi
      .fn<ParseMermaidToExcalidraw>()
      .mockRejectedValueOnce(originalError);

    const mermaidDefinition = "graph TD\nA[One]\nB[Two]x";

    const result = await convertMermaidToExcalidraw(
      createConvertArgs(mermaidDefinition, parseMermaidToExcalidraw),
    );

    expect(parseMermaidToExcalidraw).toHaveBeenCalledTimes(1);
    expect(parseMermaidToExcalidraw).toHaveBeenCalledWith(mermaidDefinition);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(originalError);
    }
  });
});

describe("diagram layout helpers", () => {
  it("merges a link and its reverse into one two-headed arrow", () => {
    const merged = mergeReverseEdges(
      [
        "flowchart TD",
        '  Login -->|"submit"| Gateway',
        "  Gateway --> Auth",
        '  Gateway -->|"token"| Login',
      ].join("\n"),
    );
    expect(merged).toBe(
      [
        "flowchart TD",
        '  Login <-->|"submit / token"| Gateway',
        "  Gateway --> Auth",
      ].join("\n"),
    );
  });

  it("keeps only the first label when the merged label would be long", () => {
    const merged = mergeReverseEdges(
      [
        "flowchart TD",
        '  EC2 -->|"Allocate Public IP"| EIP',
        '  EIP -->|"Assign to Instance"| EC2',
      ].join("\n"),
    );
    expect(merged).toBe(
      ["flowchart TD", '  EC2 <-->|"Allocate Public IP"| EIP'].join("\n"),
    );
  });

  it("leaves one-way links alone", () => {
    const def = "flowchart LR\n  A --> B\n  B --> C";
    expect(mergeReverseEdges(def)).toBe(def);
  });

  it("switches flowchart direction and ignores other diagram types", () => {
    expect(applyDiagramDirection("flowchart TD\n  A --> B", "LR")).toBe(
      "flowchart LR\n  A --> B",
    );
    expect(applyDiagramDirection("graph LR\n  A --> B", "TB")).toBe(
      "graph TB\n  A --> B",
    );
    expect(applyDiagramDirection("flowchart TD\n  A --> B", "auto")).toBe(
      "flowchart TD\n  A --> B",
    );
    expect(applyDiagramDirection("sequenceDiagram\n  A->>B: hi", "LR")).toBe(
      "sequenceDiagram\n  A->>B: hi",
    );
  });
});

describe("frame shapes", () => {
  it("wraps content in a frame of the exact ratio without cropping", async () => {
    const { wrapInAspectFrame, aspectMismatch } = await import("./frame");
    const { convertToExcalidrawElements } = await import("@excalidraw/element");
    const content = convertToExcalidrawElements([
      { type: "rectangle", x: 0, y: 0, width: 900, height: 200 },
      { type: "rectangle", x: 0, y: 300, width: 200, height: 100 },
    ]);
    const framed = wrapInAspectFrame(content as any, 1, "Square");
    const frame = framed.find((el) => el.type === "frame")!;
    expect(frame.width).toBeCloseTo(frame.height);
    for (const el of framed.filter((el) => el.type !== "frame")) {
      expect(el.frameId).toBe(frame.id);
      expect(el.x).toBeGreaterThanOrEqual(frame.x);
      expect(el.y).toBeGreaterThanOrEqual(frame.y);
      expect(el.x + el.width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(el.y + el.height).toBeLessThanOrEqual(frame.y + frame.height);
    }
    expect(aspectMismatch(1600, 900, 16 / 9)).toBeCloseTo(0, 2);
    expect(aspectMismatch(2000, 1000, 1)).toBeGreaterThan(
      aspectMismatch(1100, 1000, 1),
    );
  });
});

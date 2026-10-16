import { describe, expect, it } from "vitest";

import {
  chunkIntoStages,
  splitChainedEdges,
  stripMermaidStyling,
  toPhaseLayout,
} from "./wrapLayout";

describe("wrapped layouts for square frames", () => {
  it("removes model styling lines", () => {
    expect(
      stripMermaidStyling(
        "flowchart TD\n  A --> B\n  classDef x fill:#fff\n  class A x\n  style B fill:#000",
      ),
    ).toBe("flowchart TD\n  A --> B");
  });

  it("splits chained links into single links", () => {
    expect(splitChainedEdges('flowchart TD\n  A["a"] --> B -->|"go"| C')).toBe(
      'flowchart TD\n  A["a"] --> B\n  B -->|"go"| C',
    );
  });

  it("chunks a long chain into stages and ignores short or grouped ones", () => {
    const chain = `flowchart TD\n${"ABCDEFGHI"
      .split("")
      .slice(0, -1)
      .map((id, i) => `  ${id} --> ${"ABCDEFGHI"[i + 1]}`)
      .join("\n")}`;
    const staged = chunkIntoStages(chain)!;
    expect(staged).toContain('subgraph Stage1["Steps 1-3"]');
    expect(staged).toContain('subgraph Stage3["Steps 7-9"]');
    expect(chunkIntoStages("flowchart TD\n  A --> B")).toBeNull();
    expect(
      chunkIntoStages("flowchart TD\n  subgraph G\n    A\n  end\n  A --> B"),
    ).toBeNull();
  });

  it("links groups to groups and gives each group its own direction", () => {
    const def = [
      "flowchart TD",
      '  subgraph P1["One"]',
      "    A --> B",
      "  end",
      '  subgraph P2["Two"]',
      "    C --> D",
      "  end",
      '  B -->|"next"| C',
    ].join("\n");
    const wrapped = toPhaseLayout(def, "LR")!;
    expect(wrapped.split("\n")[0]).toBe("flowchart LR");
    expect(wrapped).toContain("direction TB");
    expect(wrapped).toContain('P1 -->|"next"| P2');
    expect(wrapped).not.toContain("B -->");
    expect(toPhaseLayout("flowchart TD\n  A --> B", "LR")).toBeNull();
  });
});

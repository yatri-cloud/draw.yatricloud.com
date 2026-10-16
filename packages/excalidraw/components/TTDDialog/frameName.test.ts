import { diagramName, mermaidTitle } from "./frame";

describe("generated diagram frame name", () => {
  it("reads the title comment or frontmatter title from Mermaid", () => {
    expect(
      mermaidTitle("flowchart LR\n%% title: Serverless Image Upload\nA-->B"),
    ).toBe("Serverless Image Upload");
    expect(mermaidTitle('---\ntitle: "Checkout Flow"\n---\nflowchart TD')).toBe(
      "Checkout Flow",
    );
    expect(mermaidTitle("flowchart TD\nA-->B")).toBeUndefined();
  });

  it("prefers the title, then a short form of the prompt", () => {
    expect(diagramName("Azure Serverless API", "anything")).toBe(
      "Azure Serverless API",
    );
    expect(
      diagramName(
        undefined,
        "Create an architecture diagram of a serverless API on Azure.",
      ),
    ).toBe("Serverless API on Azure");
    expect(diagramName(undefined, "draw user login flow")).toBe(
      "User login flow",
    );
    expect(diagramName()).toBe("Diagram");
  });
});

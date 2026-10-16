// TEMPORARY: headless preview helper used during development checks. Deleted after use.
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import { exportToSvg } from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import { convertMermaidToExcalidraw } from "@excalidraw/excalidraw/components/TTDDialog/common";

const PHASED = `flowchart TD
    subgraph P1["Phase 1: Account Setup"]
        A["Create AWS Account"] --> B["Login to Console"]
    end
    subgraph P2["Phase 2: Launch EC2"]
        C["Launch EC2 Instance"] --> D["Choose AMI"] --> E["Select Instance Type"]
        E --> F["Create Key Pair"] --> G["Configure Security Group"]
    end
    subgraph P3["Phase 3: Configure"]
        H["Connect via SSH"] --> I["Update Packages"] --> J["Install Docker"] --> K["Pull Image"]
    end
    subgraph P4["Phase 4: Deploy"]
        L["Run Container"] --> M["Map Ports"] --> N["Configure Domain"]
    end
    subgraph P5["Phase 5: Monitor"]
        O["Set up CloudWatch"] --> P["Create Alarms"]
    end
    B --> C
    G --> H
    K --> L
    N --> O
    classDef primary fill:#e1f5fe,stroke:#01579b,stroke-width:2px,color:#000;
    class A,B primary`;
const CHAIN = `flowchart TD
    A["Write code"] --> B["Commit"] --> C["Push"] --> D["CI build"]
    D --> E["Unit tests"] --> F["Security scan"] --> G["Build image"] --> H["Push to registry"]
    H --> I["Deploy staging"] --> J["Smoke tests"] --> K["Approve"] --> L["Deploy production"]`;

export const previewWrap = async () => {
  const out: Record<string, any> = {};
  for (const [name, def] of [["phased", PHASED], ["chain", CHAIN]] as const) {
    for (const frameRatio of ["1:1", "free"] as const) {
      const parent = document.createElement("div"); const canvas = document.createElement("div"); parent.appendChild(canvas); document.body.appendChild(parent);
      const data = { current: { elements: [] as any[], files: null as any } };
      let err: any = null;
      const r = await convertMermaidToExcalidraw({ canvasRef: { current: canvas }, mermaidToExcalidrawLib: { loaded: true, api: Promise.resolve({ parseMermaidToExcalidraw }) } as any, mermaidDefinition: def, setError: (e: any) => (err = e), data: data as any, theme: "light" as any, frameRatio });
      const content = data.current.elements.filter((e: any) => e.type !== "frame");
      const [a, b, c, d] = content.length ? getCommonBounds(content) : [0, 0, 0, 0];
      out[`${name}-${frameRatio}`] = { ok: r.success, err: err && String(err.message || err).slice(0, 200), size: `${Math.round(c - a)}x${Math.round(d - b)}`, aspect: ((c - a) / (d - b || 1)).toFixed(2),
        svg: content.length ? (await exportToSvg({ elements: data.current.elements, files: data.current.files, appState: { exportBackground: true, viewBackgroundColor: "#ffffff" } as any })).outerHTML : "" };
    }
  }
  return JSON.stringify(out);
};

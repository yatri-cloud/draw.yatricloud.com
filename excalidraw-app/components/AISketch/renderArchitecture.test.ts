import fs from "fs";
import path from "path";

import { exportToSvg } from "@excalidraw/excalidraw";
import logosJson from "@excalidraw/excalidraw/components/TTDDialog/logos.json";
import { svgToDataURL } from "@excalidraw/excalidraw/components/TTDDialog/logos";

import type {
  CloudIconManifest,
  LogoBundle,
} from "@excalidraw/excalidraw/components/TTDDialog/logos";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import specs from "./__fixtures__/arch-specs.json";
import {
  buildArchitectureIcons,
  layoutArchitecture,
  normalizeArchSpec,
  renderArchitecture,
} from "./renderArchitecture";

const PUBLIC = path.join(__dirname, "../../../public");
const manifest = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "cloud-icons/manifest.json"), "utf8"),
) as CloudIconManifest;
const icons = buildArchitectureIcons(
  (logosJson as { logos: LogoBundle }).logos,
  manifest,
);

// Set ARCH_SVG_DIR to write each rendered fixture as SVG for a visual check.
const svgDir = process.env.ARCH_SVG_DIR;

const inside = (
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

describe("AI architecture diagrams", () => {
  it("resolves official icons from service names", () => {
    expect(icons.resolve("Amazon CloudFront", "CDN")).toBe(
      "aws-amazon-cloudfront",
    );
    expect(icons.resolve("Application Load Balancer", "ALB")).toBe(
      "aws-res-elastic-load-balancing-application-load-balancer",
    );
    expect(icons.resolve("Amazon ECS", "Containers")).toBe(
      "aws-amazon-elastic-container-service",
    );
    expect(icons.resolve("Azure Functions", "API")).toBe("azure-function-apps");
    expect(icons.resolve("Amazon DynamoDB Global Tables", "", "aws")).toBe(
      "aws-amazon-dynamodb",
    );
    expect(icons.resolve("S3 Multi-Region Access Point", "", "aws")).toMatch(
      /multi-region-access-point/,
    );
    expect(icons.resolve("Users", "Users", "aws")).toBe(
      "aws-res-general-users",
    );
    expect(icons.resolve("Users", "Users", "azure")).toBe("azure-users");
    expect(
      icons.mainProvider(["Amazon S3", "AWS Lambda", "Users", "Amazon RDS"]),
    ).toBe("aws");
  });

  it.each(Object.entries(specs))(
    "lays out the %s fixture inside its groups",
    async (name, raw) => {
      const spec = normalizeArchSpec(raw);
      const layout = await layoutArchitecture(spec, spec.direction);

      for (const node of spec.nodes) {
        const box = layout.nodes.get(node.id)!;
        expect(box).toBeDefined();
        if (node.group) {
          expect(inside(layout.groups.get(node.group)!, box)).toBe(true);
        }
      }
      for (const group of spec.groups) {
        if (group.parent) {
          expect(
            inside(
              layout.groups.get(group.parent)!,
              layout.groups.get(group.id)!,
            ),
          ).toBe(true);
        }
      }
      const boxes = spec.nodes.map((n) => layout.nodes.get(n.id)!);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i], boxes[j]];
          const overlap =
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height;
          expect(overlap).toBe(false);
        }
      }
      expect(layout.edges.size).toBe(spec.edges.length);

      const { elements, logoIds } = renderArchitecture(spec, layout, icons);
      expect(elements.length).toBeGreaterThan(spec.nodes.length);
      expect(logoIds.length).toBeGreaterThan(0);

      if (svgDir) {
        const files: BinaryFiles = {};
        for (const id of logoIds) {
          const logo = icons.bundle[id];
          const svg =
            logo.svg ?? fs.readFileSync(path.join(PUBLIC, logo.url!), "utf8");
          files[`logo-${id}`] = {
            id: `logo-${id}` as any,
            dataURL: svgToDataURL(svg),
            mimeType: "image/svg+xml",
            created: 0,
          };
        }
        const svg = await exportToSvg({
          elements: elements as NonDeletedExcalidrawElement[],
          appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
          files,
        });
        fs.mkdirSync(svgDir, { recursive: true });
        fs.writeFileSync(path.join(svgDir, `arch-${name}.svg`), svg.outerHTML);
      }
    },
  );
});

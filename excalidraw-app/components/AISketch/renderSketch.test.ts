import fs from "fs";
import path from "path";

import { exportToSvg } from "@excalidraw/excalidraw";

import logosJson from "@excalidraw/excalidraw/components/TTDDialog/logos.json";

import {
  buildLogoBundle,
  matchLogo,
} from "@excalidraw/excalidraw/components/TTDDialog/logos";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import type {
  CloudIconManifest,
  LogoBundle,
} from "@excalidraw/excalidraw/components/TTDDialog/logos";

import iconsJson from "./icons.json";
import specs from "./__fixtures__/sketch-specs.json";
import { normalizeSpec, renderSketch, resolveIcon } from "./renderSketch";

import type { IconBundle } from "./renderSketch";

const icons = (iconsJson as { icons: IconBundle }).icons;

// Set SKETCH_SVG_DIR to write each rendered fixture as SVG for a visual check.
const svgDir = process.env.SKETCH_SVG_DIR;

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

describe("AI Sketch renderer", () => {
  it.each(Object.entries(specs))(
    "renders the %s fixture",
    async (name, raw) => {
      const spec = normalizeSpec(raw, icons);
      const { elements } = renderSketch(spec, icons);

      expect(elements.length).toBeGreaterThan(0);
      expect(new Set(elements.map((el) => el.id)).size).toBe(elements.length);
      for (const el of elements) {
        for (const key of ["x", "y", "width", "height"] as const) {
          expect(Number.isFinite(el[key])).toBe(true);
        }
      }

      // every node shape exists and no two node shapes overlap
      const shapes = spec.nodes
        .map((node) => elements.find((el) => el.id === node.id))
        .filter((el): el is NonNullable<typeof el> => !!el);
      expect(shapes.length).toBe(spec.nodes.length);
      for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) {
          expect([
            shapes[i].id,
            shapes[j].id,
            overlaps(shapes[i], shapes[j]),
          ]).toEqual([shapes[i].id, shapes[j].id, false]);
        }
      }

      // arrows are bound to the shapes they connect
      for (const arrow of elements.filter((el) => el.type === "arrow")) {
        expect((arrow as any).startBinding?.elementId).toBeTruthy();
        expect((arrow as any).endBinding?.elementId).toBeTruthy();
      }

      if (svgDir) {
        const svg = await exportToSvg({
          elements: elements as NonDeletedExcalidrawElement[],
          appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
          files: null,
        });
        fs.mkdirSync(svgDir, { recursive: true });
        fs.writeFileSync(path.join(svgDir, `${name}.svg`), svg.outerHTML);
      }
    },
  );

  it("maps model icon names and kinds onto the bundle", () => {
    expect(resolveIcon("browser", icons)).toBe("browser-window");
    expect(resolveIcon("User", icons)).toBe("user-avatar");
    expect(resolveIcon("db", icons)).toBe("database");

    const spec = normalizeSpec(
      {
        nodes: [
          { id: "a", kind: "document", label: "Report" },
          { id: "b", kind: "icon", icon: "no-such-icon", label: "Thing" },
          { id: "b", kind: "box", label: "Duplicate id" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "missing" },
        ],
      },
      icons,
    );
    expect(spec.nodes.map((n) => [n.id, n.kind, n.icon])).toEqual([
      ["a", "icon", "document"],
      ["b", "box", undefined],
    ]);
    expect(spec.edges).toEqual([{ from: "a", to: "b", style: "solid" }]);
  });

  it("rejects responses with nothing to draw", () => {
    expect(() => normalizeSpec({ nodes: [] }, icons)).toThrow();
    expect(() => normalizeSpec("flowchart TD", icons)).toThrow();
  });
});

describe("logo matching", () => {
  // brand logos plus the official cloud icon catalogue built into public/cloud-icons
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../../public/cloud-icons/manifest.json"),
      "utf8",
    ),
  ) as CloudIconManifest;
  const logos = buildLogoBundle(
    (logosJson as { logos: LogoBundle }).logos,
    manifest,
  );

  it("finds official logos for named products and services", () => {
    expect(matchLogo("Amazon S3", logos)).toBe(
      "aws-amazon-simple-storage-service",
    );
    expect(matchLogo("S3", logos)).toBe("aws-amazon-simple-storage-service");
    expect(matchLogo("AWS Lambda", logos)).toBe("aws-aws-lambda");
    expect(matchLogo("Amazon SQS", logos)).toBe(
      "aws-amazon-simple-queue-service",
    );
    expect(matchLogo("AKS", logos)).toBe("azure-kubernetes-services");
    expect(matchLogo("Azure Cosmos DB", logos)).toBe("azure-azure-cosmos-db");
    expect(matchLogo("BigQuery", logos)).toBeDefined();
    expect(matchLogo("EC2 Instance", logos)).toBe("aws-amazon-ec2");
    expect(matchLogo("EBS Volume", logos)).toBe(
      "aws-amazon-elastic-block-store",
    );
    expect(matchLogo("S3 bucket for images", logos)).toBe(
      "aws-amazon-simple-storage-service",
    );
    expect(matchLogo("Orders DB (Postgres)", logos)).toBe("postgresql");
    expect(matchLogo("k8s", logos)).toBe("kubernetes");
    expect(matchLogo("Cloud Run", logos)).toBe("gcp-cloud-run");
  });

  it("does not put logos on generic or short accidental matches", () => {
    expect(matchLogo("Go to checkout", logos)).toBeUndefined();
    expect(matchLogo("Message queue", logos)).toBeUndefined();
    expect(matchLogo("Cache", logos)).toBeUndefined();
    expect(matchLogo("Serverless functions", logos)).toBeUndefined();
    expect(matchLogo("Go", logos)).toBe("go");
    expect(matchLogo("Elastic IP", logos)).toBe(
      "aws-res-amazon-ec2-elastic-ip-address",
    );
    expect(matchLogo("Express server", logos)).toBeUndefined();
    expect(matchLogo("Express", logos)).toBe("express");
  });
});

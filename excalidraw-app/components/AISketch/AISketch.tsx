import { useApp } from "@excalidraw/excalidraw/components/App";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import DropdownMenu from "@excalidraw/excalidraw/components/dropdownMenu/DropdownMenu";
import { MagicIcon } from "@excalidraw/excalidraw/components/icons";
import {
  loadCloudIconManifest,
  loadLogos,
  logoFiles,
} from "@excalidraw/excalidraw/components/TTDDialog/logos";
import { freeInsertPosition } from "@excalidraw/excalidraw/components/TTDDialog/placement";
import {
  aspectMismatch,
  DEFAULT_FRAME_RATIO,
  diagramName,
  FRAME_RATIOS,
  frameAspect,
  wrapInAspectFrame,
} from "@excalidraw/excalidraw/components/TTDDialog/frame";
import { useTunnels } from "@excalidraw/excalidraw/context/tunnels";
import { getCommonBounds } from "@excalidraw/element";

import { useRef, useState } from "react";

import type { FrameRatio } from "@excalidraw/excalidraw/components/TTDDialog/frame";
import type { LogoBundle } from "@excalidraw/excalidraw/components/TTDDialog/logos";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { atom, useAtom, useSetAtom } from "../../app-jotai";

import {
  buildArchitectureIcons,
  layoutArchitecture,
  normalizeArchSpec,
  renderArchitecture,
} from "./renderArchitecture";
import { normalizeSpec, renderSketch } from "./renderSketch";

import "./AISketch.scss";

import type { IconBundle } from "./renderSketch";

/** Which AI drawing dialog is open, if any. */
export type AISketchMode = "sketch" | "architecture";
export const aiSketchOpenAtom = atom<AISketchMode | false>(false);

const ARCHITECTURE_EXAMPLES = [
  "Multi-region active-active on AWS with Route 53, CloudFront, two regions each with a VPC, ALB and ECS, S3 cross-region replication, DynamoDB global tables and ElastiCache global datastore",
  "Three-tier web app on AWS in two availability zones: CloudFront, ALB in public subnets, EC2 auto scaling in private subnets, RDS primary and standby",
  "Serverless API on Azure: Front Door, Azure Functions, Cosmos DB, Blob Storage, Key Vault and Azure Monitor",
  "Data pipeline on Google Cloud: Pub/Sub ingestion, Dataflow processing, BigQuery warehouse, Looker dashboards",
];

const EXAMPLES = [
  "How a user asks an AI agent a question, the agent calls three tools, and returns a report",
  "Online checkout: customer, cart, payment API, database and a confirmation email",
  "GitHub stars per day: Mon 1.4K, Tue 3.6K, Wed 3.7K, Thu 5.6K, Fri 10.8K. 25K total",
  "How 2FA codes work between a phone app and a server",
];

let iconsPromise: Promise<IconBundle> | null = null;
const loadIcons = () =>
  (iconsPromise ??= import("./icons.json").then(
    (mod) => (mod.default ?? mod).icons as IconBundle,
  ));

/** "AI Sketch" entry in the toolbar's Generate menu. */
export const AISketchTrigger = () => {
  const { TTDDialogTriggerTunnel } = useTunnels();
  const setOpen = useSetAtom(aiSketchOpenAtom);
  return (
    <TTDDialogTriggerTunnel.In>
      <DropdownMenu.Item
        onSelect={() => setOpen("sketch")}
        icon={MagicIcon}
        badge={<DropdownMenu.Item.Badge>AI</DropdownMenu.Item.Badge>}
      >
        AI Sketch
      </DropdownMenu.Item>
      <DropdownMenu.Item
        onSelect={() => setOpen("architecture")}
        icon={MagicIcon}
        badge={<DropdownMenu.Item.Badge>AI</DropdownMenu.Item.Badge>}
      >
        AI Architecture
      </DropdownMenu.Item>
    </TTDDialogTriggerTunnel.In>
  );
};

export const AISketchDialog = () => {
  const app = useApp();
  const [open, setOpen] = useAtom(aiSketchOpenAtom);
  const mode: AISketchMode = open || "sketch";
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<null | "loading">(null);
  const [error, setError] = useState("");
  const [frameRatio, setFrameRatio] = useState<FrameRatio>(DEFAULT_FRAME_RATIO);
  const abortRef = useRef<AbortController | null>(null);

  if (!open) {
    return null;
  }

  const close = () => {
    abortRef.current?.abort();
    setStatus(null);
    setError("");
    setOpen(false);
  };

  /** Frames the result, loads its icons and inserts it next to existing drawings. */
  const insert = async (
    candidates: { elements: ExcalidrawElement[]; logoIds: string[] }[],
    bundle: LogoBundle | undefined,
    name: string,
  ) => {
    const aspect = frameAspect(frameRatio);
    const fit = (result: typeof candidates[number]) => {
      if (!aspect) {
        return 0;
      }
      const [minX, minY, maxX, maxY] = getCommonBounds(result.elements);
      return aspectMismatch(maxX - minX, maxY - minY, aspect);
    };
    // for a framed shape, keep whichever arrangement fills it best
    const best = candidates.reduce((a, b) => (fit(b) < fit(a) ? b : a));
    const elements = aspect
      ? wrapInAspectFrame(
          best.elements as NonDeletedExcalidrawElement[],
          aspect,
          name,
        )
      : best.elements;
    const files = bundle ? await logoFiles(best.logoIds, bundle) : null;
    app.addElementsFromPasteOrLibrary({
      elements,
      files,
      // next to existing drawings instead of on top of them
      position: freeInsertPosition(app, elements),
      fit: "scale-down",
    });
  };

  const requestSpec = async (endpoint: string, body: unknown) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abortRef.current!.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : `AI returned status ${response.status}`,
      );
    }
    return data.spec;
  };

  const generateArchitecture = async (text: string) => {
    const [logos, manifest, raw] = await Promise.all([
      loadLogos().catch(() => undefined),
      loadCloudIconManifest().catch(() => null),
      requestSpec("/api/ai/architecture", { prompt: text }),
    ]);
    const spec = normalizeArchSpec(raw);
    const icons = buildArchitectureIcons(logos ?? {}, manifest);
    const directions = frameAspect(frameRatio)
      ? (["LR", "TB"] as const)
      : [spec.direction];
    const candidates = await Promise.all(
      directions.map(async (dir) =>
        renderArchitecture(spec, await layoutArchitecture(spec, dir), icons),
      ),
    );
    await insert(candidates, icons.bundle, diagramName(spec.title, text));
  };

  const generate = async () => {
    const text = prompt.trim();
    if (!text || status) {
      return;
    }
    setStatus("loading");
    setError("");
    abortRef.current = new AbortController();
    try {
      if (mode === "architecture") {
        await generateArchitecture(text);
        setStatus(null);
        setOpen(false);
        return;
      }
      const [icons, logos] = await Promise.all([
        loadIcons(),
        loadLogos().catch(() => undefined),
      ]);
      const spec = normalizeSpec(
        await requestSpec("/api/ai/sketch", {
          prompt: text,
          icons: Object.keys(icons),
        }),
        icons,
        logos,
      );
      const candidates = frameAspect(frameRatio)
        ? (["LR", "TB"] as const).map((dir) =>
            renderSketch(spec, icons, logos, dir),
          )
        : [renderSketch(spec, icons, logos)];
      await insert(candidates, logos, diagramName(spec.title, text));
      setStatus(null);
      setOpen(false);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setError(err?.message || "Something went wrong. Please try again.");
      }
      setStatus(null);
    }
  };

  return (
    <Dialog
      onCloseRequest={close}
      title={mode === "architecture" ? "AI Architecture" : "AI Sketch"}
      size="regular"
      className="AISketch"
    >
      <div className="AISketch__modes" role="tablist">
        {(
          [
            ["sketch", "Explainer"],
            ["architecture", "Architecture"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            className={`AISketch__mode${
              mode === value ? " AISketch__mode--active" : ""
            }`}
            onClick={() => setOpen(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="AISketch__intro">
        {mode === "architecture"
          ? "Describe a system. AI Architecture draws a cloud architecture diagram with the official AWS, Azure and Google Cloud icons, regions, VPCs and subnets, and labelled connections, ready to edit."
          : "Describe an idea, a flow or some numbers. AI Sketch draws a hand-drawn explainer with icons, speech bubbles, colours and simple charts, and places it on the canvas so you can edit it."}
      </p>
      <textarea
        className="AISketch__input"
        value={prompt}
        placeholder={
          mode === "architecture"
            ? "e.g. Web app on AWS: CloudFront, ALB, ECS on Fargate in private subnets, RDS PostgreSQL and S3"
            : "e.g. How a request travels from the browser through a CDN to the server and database"
        }
        rows={5}
        maxLength={4000}
        autoFocus
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            generate();
          }
        }}
      />
      <div className="AISketch__examples">
        {(mode === "architecture" ? ARCHITECTURE_EXAMPLES : EXAMPLES).map(
          (example) => (
            <button
              key={example}
              type="button"
              className="AISketch__example"
              onClick={() => setPrompt(example)}
            >
              {example}
            </button>
          ),
        )}
      </div>
      {error && <div className="AISketch__error">{error}</div>}
      <div
        className="AISketch__frame"
        role="radiogroup"
        aria-label="Frame shape"
      >
        <span>Frame</span>
        {FRAME_RATIOS.map((ratio) => (
          <button
            key={ratio.value}
            type="button"
            role="radio"
            title={ratio.title}
            aria-checked={frameRatio === ratio.value}
            className={`AISketch__frame-option${
              frameRatio === ratio.value
                ? " AISketch__frame-option--active"
                : ""
            }`}
            onClick={() => setFrameRatio(ratio.value)}
          >
            {ratio.label}
          </button>
        ))}
      </div>
      <div className="AISketch__actions">
        <span className="AISketch__hint">Cmd/Ctrl + Enter</span>
        <FilledButton
          size="large"
          label={status ? "Drawing..." : "Generate"}
          status={status}
          disabled={!prompt.trim()}
          onClick={generate}
        />
      </div>
    </Dialog>
  );
};

import { useApp } from "@excalidraw/excalidraw/components/App";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import DropdownMenu from "@excalidraw/excalidraw/components/dropdownMenu/DropdownMenu";
import { MagicIcon } from "@excalidraw/excalidraw/components/icons";
import {
  loadLogos,
  logoFiles,
} from "@excalidraw/excalidraw/components/TTDDialog/logos";
import { freeInsertPosition } from "@excalidraw/excalidraw/components/TTDDialog/placement";
import {
  aspectMismatch,
  DEFAULT_FRAME_RATIO,
  FRAME_RATIOS,
  frameAspect,
  wrapInAspectFrame,
} from "@excalidraw/excalidraw/components/TTDDialog/frame";
import { useTunnels } from "@excalidraw/excalidraw/context/tunnels";
import { getCommonBounds } from "@excalidraw/element";

import { useRef, useState } from "react";

import type { FrameRatio } from "@excalidraw/excalidraw/components/TTDDialog/frame";
import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { atom, useAtom, useSetAtom } from "../../app-jotai";

import { normalizeSpec, renderSketch } from "./renderSketch";

import "./AISketch.scss";

import type { IconBundle } from "./renderSketch";

export const aiSketchOpenAtom = atom(false);

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
        onSelect={() => setOpen(true)}
        icon={MagicIcon}
        badge={<DropdownMenu.Item.Badge>AI</DropdownMenu.Item.Badge>}
      >
        AI Sketch
      </DropdownMenu.Item>
    </TTDDialogTriggerTunnel.In>
  );
};

export const AISketchDialog = () => {
  const app = useApp();
  const [open, setOpen] = useAtom(aiSketchOpenAtom);
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

  const generate = async () => {
    const text = prompt.trim();
    if (!text || status) {
      return;
    }
    setStatus("loading");
    setError("");
    abortRef.current = new AbortController();
    try {
      const [icons, logos] = await Promise.all([
        loadIcons(),
        loadLogos().catch(() => undefined),
      ]);
      const response = await fetch("/api/ai/sketch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, icons: Object.keys(icons) }),
        signal: abortRef.current.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : `AI returned status ${response.status}`,
        );
      }
      const spec = normalizeSpec(data.spec, icons, logos);
      const aspect = frameAspect(frameRatio);
      // for a framed shape, keep whichever arrangement fills it best
      const candidates = aspect
        ? (["LR", "TB"] as const).map((dir) =>
            renderSketch(spec, icons, logos, dir),
          )
        : [renderSketch(spec, icons, logos)];
      const fit = (result: typeof candidates[number]) => {
        if (!aspect) {
          return 0;
        }
        const [minX, minY, maxX, maxY] = getCommonBounds(result.elements);
        return aspectMismatch(maxX - minX, maxY - minY, aspect);
      };
      const best = candidates.reduce((a, b) => (fit(b) < fit(a) ? b : a));
      const elements = aspect
        ? wrapInAspectFrame(
            best.elements as NonDeletedExcalidrawElement[],
            aspect,
            FRAME_RATIOS.find((r) => r.value === frameRatio)!.title,
          )
        : best.elements;
      const files = logos ? await logoFiles(best.logoIds, logos) : null;
      app.addElementsFromPasteOrLibrary({
        elements,
        files,
        // next to existing drawings instead of on top of them
        position: freeInsertPosition(app, elements),
        fit: "scale-down",
      });
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
      title="AI Sketch"
      size="regular"
      className="AISketch"
    >
      <p className="AISketch__intro">
        Describe an idea, a flow or some numbers. AI Sketch draws a hand-drawn
        explainer with icons, speech bubbles, colours and simple charts, and
        places it on the canvas so you can edit it.
      </p>
      <textarea
        className="AISketch__input"
        value={prompt}
        placeholder="e.g. How a request travels from the browser through a CDN to the server and database"
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
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="AISketch__example"
            onClick={() => setPrompt(example)}
          >
            {example}
          </button>
        ))}
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

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
import { useTunnels } from "@excalidraw/excalidraw/context/tunnels";
import { randomId } from "@excalidraw/common";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { atom, useAtom, useSetAtom } from "../../app-jotai";
import {
  ImageAttach,
  imageFileToDataURL,
  MAX_IMAGES,
  pastedImages,
} from "../AISketch/ImageAttach";
import { normalizeSpec, renderSketch } from "../AISketch/renderSketch";

import {
  collectSlideFrames,
  exportGuidePDF,
  exportHTML,
  exportImagesZip,
  exportMarkdown,
  exportPPTX,
  exportSlidesPDF,
  renderSlideImages,
} from "./exportDeck";
import {
  normalizePlan,
  normalizeSlide,
  renderSlide,
  SLIDE_H,
  SLIDE_W,
} from "./renderSlide";

import "./AIDeck.scss";

import type { SlideImage } from "./exportDeck";
import type { DeckPlan, Slide } from "./renderSlide";
import type { IconBundle } from "../AISketch/renderSketch";

/** Which deck dialog view is open, if any. */
export const aiDeckOpenAtom = atom<"create" | "export" | false>(false);

const SLIDE_COUNTS = [6, 10, 15, 20, 30];
/** slides written per AI call, and AI calls running at once */
const FILL_BATCH = 3;
const CONCURRENCY = 4;
const COLUMNS = 3;
const GAP_X = 200;
const GAP_Y = 240;

const EXAMPLES = [
  "Atomic Habits by James Clear: the key ideas and how to apply them",
  "How UPI payments work in India, from tapping Pay to money in the bank",
  "Docker vs Kubernetes for beginners",
  "7 boring businesses that quietly make people rich",
];

let iconsPromise: Promise<IconBundle> | null = null;
const loadIcons = () =>
  (iconsPromise ??= import("../AISketch/icons.json").then(
    (mod) => (mod.default ?? mod).icons as IconBundle,
  ));

/** Runs tasks with at most `limit` in flight; results keep their order. */
const pool = async <T,>(tasks: (() => Promise<T>)[], limit: number) => {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
  return results;
};

const postJSON = async (url: string, body: unknown, signal: AbortSignal) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `AI returned status ${response.status}`,
    );
  }
  return data;
};

/** "AI Deck" and "Export slides" entries in the toolbar's Generate menu. */
export const AIDeckTrigger = () => {
  const { TTDDialogTriggerTunnel } = useTunnels();
  const setOpen = useSetAtom(aiDeckOpenAtom);
  return (
    <TTDDialogTriggerTunnel.In>
      <DropdownMenu.Item
        onSelect={() => setOpen("create")}
        icon={MagicIcon}
        badge={<DropdownMenu.Item.Badge>AI</DropdownMenu.Item.Badge>}
      >
        AI Deck
      </DropdownMenu.Item>
    </TTDDialogTriggerTunnel.In>
  );
};

type Format = "present" | "pptx" | "pdf" | "guide" | "zip" | "md" | "html";
const FORMATS: { value: Format; label: string; hint: string }[] = [
  {
    value: "present",
    label: "Present",
    hint: "Full screen, arrow keys, N for notes",
  },
  {
    value: "pptx",
    label: "PowerPoint (.pptx)",
    hint: "One slide per frame, with speaker notes",
  },
  { value: "pdf", label: "PDF slides", hint: "16:9 pages, ready to share" },
  {
    value: "guide",
    label: "PDF guide",
    hint: "A4 handout: slides, key points and notes",
  },
  {
    value: "zip",
    label: "Images + Markdown (.zip)",
    hint: "PNG per slide and a Markdown guide",
  },
  { value: "md", label: "Markdown", hint: "Text outline with notes" },
  {
    value: "html",
    label: "Web slideshow (.html)",
    hint: "One file that plays in any browser",
  },
];

export const AIDeckDialog = () => {
  const app = useApp();
  const [open, setOpen] = useAtom(aiDeckOpenAtom);
  const [content, setContent] = useState("");
  // screenshots, notes or pages to build the deck from (read by the vision model)
  const [images, setImages] = useState<string[]>([]);
  const [count, setCount] = useState(10);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [deckTitle, setDeckTitle] = useState("");
  const [presenting, setPresenting] = useState<SlideImage[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scene = useCallback(
    () => ({
      elements: app.scene.getNonDeletedElements(),
      files: app.files,
      appState: app.state,
    }),
    [app],
  );

  if (presenting) {
    return (
      <Presenter slides={presenting} onClose={() => setPresenting(null)} />
    );
  }
  if (!open) {
    return null;
  }

  const close = () => {
    abortRef.current?.abort();
    setProgress(null);
    setError("");
    setOpen(false);
  };

  const generate = async () => {
    let text = content.trim();
    if ((!text && !images.length) || progress) {
      return;
    }
    setError("");
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;
    try {
      setProgress(
        images.length ? "Reading the images..." : "Planning the story...",
      );
      const [icons, logos, planned] = await Promise.all([
        loadIcons(),
        loadLogos().catch(() => undefined),
        postJSON(
          "/api/ai/deck",
          { action: "plan", content: text, slides: count, images },
          signal,
        ),
      ]);
      const plan: DeckPlan = normalizePlan(planned.plan, count);
      // with images, the server returns the text it read from them; the slides are written from it
      if (typeof planned.source === "string" && planned.source.trim()) {
        text = planned.source;
      }
      const iconNames = Object.keys(icons);

      // write the slides a few at a time, several calls in parallel
      const batches: [number, number][] = [];
      for (let i = 0; i < plan.slides.length; i += FILL_BATCH) {
        batches.push([i, Math.min(plan.slides.length, i + FILL_BATCH)]);
      }
      let written = 0;
      setProgress(`Writing slides 0 of ${plan.slides.length}...`);
      const filled = await pool(
        batches.map(([from, to]) => async () => {
          let raw: any[] = [];
          for (let attempt = 0; attempt < 2 && !raw.length; attempt++) {
            try {
              const data = await postJSON(
                "/api/ai/deck",
                {
                  action: "fill",
                  content: text,
                  plan,
                  from,
                  to,
                  icons: iconNames,
                },
                signal,
              );
              raw = Array.isArray(data.slides) ? data.slides : [];
            } catch (err) {
              if (signal.aborted) {
                throw err;
              }
            }
          }
          written += to - from;
          setProgress(`Writing slides ${written} of ${plan.slides.length}...`);
          return plan.slides
            .slice(from, to)
            .map((planned, i) =>
              normalizeSlide(
                raw.find((r) => r?.title === planned.title) ?? raw[i],
                planned,
              ),
            );
        }),
        CONCURRENCY,
      );
      const slides: Slide[] = filled.flat();
      if (slides[0] && !slides[0].subtitle && plan.subtitle) {
        slides[0].subtitle = plan.subtitle;
      }

      // diagram slides get a hand-drawn sketch from AI Sketch
      const diagramIndexes = slides
        .map((s, i) => (s.layout === "diagram" && s.diagram ? i : -1))
        .filter((i) => i >= 0);
      if (diagramIndexes.length) {
        setProgress("Drawing the diagrams...");
      }
      const logoIds = new Set<string>();
      const diagrams = new Map<number, ExcalidrawElement[]>();
      await pool(
        diagramIndexes.map((i) => async () => {
          try {
            const data = await postJSON(
              "/api/ai/sketch",
              { prompt: slides[i].diagram, icons: iconNames },
              signal,
            );
            const spec = normalizeSpec(data.spec, icons, logos);
            const drawn = renderSketch(
              { ...spec, title: undefined, footer: undefined },
              icons,
              logos,
              "LR",
            );
            drawn.logoIds.forEach((id) => logoIds.add(id));
            diagrams.set(i, drawn.elements);
          } catch (err) {
            if (signal.aborted) {
              throw err;
            }
            // the slide falls back to a list
          }
        }),
        CONCURRENCY,
      );

      setProgress("Placing the slides...");
      const deckId = randomId();
      const elements = slides.flatMap((slide, i) =>
        renderSlide(slide, {
          index: i,
          deckTitle: plan.title,
          deckId,
          icons,
          diagram: diagrams.get(i),
          originX: (i % COLUMNS) * (SLIDE_W + GAP_X),
          originY: Math.floor(i / COLUMNS) * (SLIDE_H + GAP_Y),
        }),
      );
      const files =
        logos && logoIds.size ? await logoFiles([...logoIds], logos) : null;
      app.addElementsFromPasteOrLibrary({
        elements,
        files,
        position: freeInsertPosition(app, elements),
        fit: "scale-down",
      });
      setDeckTitle(plan.title);
      setImages([]);
      setProgress(null);
      setOpen("export");
    } catch (err: any) {
      setProgress(null);
      if (!signal.aborted) {
        setError(err?.message || "Something went wrong. Try again.");
      }
    }
  };

  const runExport = async (format: Format) => {
    if (progress) {
      return;
    }
    setError("");
    const source = scene();
    const frames = collectSlideFrames(source);
    if (!frames.length) {
      setError(
        "There are no frames on the canvas. Generate a deck, or draw frames to use as slides.",
      );
      return;
    }
    try {
      setProgress(`Rendering slide 0 of ${frames.length}...`);
      const slides = await renderSlideImages(source, frames, (done, total) =>
        setProgress(`Rendering slide ${done} of ${total}...`),
      );
      const title =
        deckTitle || slides[0]?.meta?.title || slides[0]?.title || "Slides";
      setProgress("Saving...");
      switch (format) {
        case "present":
          setOpen(false);
          setPresenting(slides);
          break;
        case "pptx":
          await exportPPTX(slides, title);
          break;
        case "pdf":
          await exportSlidesPDF(slides, title);
          break;
        case "guide":
          await exportGuidePDF(slides, title);
          break;
        case "zip":
          await exportImagesZip(slides, title);
          break;
        case "md":
          exportMarkdown(slides, title);
          break;
        case "html":
          exportHTML(slides, title);
          break;
      }
      setProgress(null);
    } catch (err: any) {
      setProgress(null);
      setError(err?.message || "Export failed.");
    }
  };

  const frameCount = open === "export" ? collectSlideFrames(scene()).length : 0;

  return (
    <Dialog
      onCloseRequest={close}
      title={open === "export" ? "Export slides" : "AI Deck"}
      size="regular"
      className="AIDeck"
    >
      <div className="AIDeck__modes" role="tablist">
        {(
          [
            ["create", "Create"],
            ["export", "Export & present"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={open === value}
            className={`AIDeck__mode${
              open === value ? " AIDeck__mode--active" : ""
            }`}
            onClick={() => setOpen(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {open === "create" ? (
        <>
          <p className="AIDeck__intro">
            Paste an article, notes or a book summary, or just describe a topic.
            AI Deck plans the story and draws every slide by hand, whiteboard
            style, as 16:9 frames you can edit. Then present it or export it as
            PowerPoint, PDF, a PDF guide, images or a web slideshow.
          </p>
          <textarea
            className="AIDeck__input"
            value={content}
            placeholder="e.g. Explain how compound interest works, with an example and common mistakes"
            rows={8}
            maxLength={12000}
            autoFocus
            onChange={(event) => setContent(event.target.value)}
            onPaste={async (event) => {
              const files = pastedImages(event);
              if (files.length) {
                event.preventDefault();
                const urls = await Promise.all(
                  files
                    .slice(0, MAX_IMAGES - images.length)
                    .map(imageFileToDataURL),
                );
                setImages((current) =>
                  [...current, ...urls].slice(0, MAX_IMAGES),
                );
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                generate();
              }
            }}
          />
          <ImageAttach
            images={images}
            onChange={setImages}
            label="Add images"
            hint="up to 3: slides, notes, book pages or screenshots to build the deck from"
          />
          <div className="AIDeck__examples">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="AIDeck__example"
                onClick={() => setContent(example)}
              >
                {example}
              </button>
            ))}
          </div>
          <div
            className="AIDeck__count"
            role="radiogroup"
            aria-label="Number of slides"
          >
            <span>Slides</span>
            {SLIDE_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={count === n}
                className={`AIDeck__count-option${
                  count === n ? " AIDeck__count-option--active" : ""
                }`}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
          {error && <div className="AIDeck__error">{error}</div>}
          <div className="AIDeck__actions">
            <span className="AIDeck__hint">
              {progress ?? "Cmd/Ctrl + Enter"}
            </span>
            <FilledButton
              size="large"
              label={progress ? "Creating..." : "Create deck"}
              status={progress ? "loading" : null}
              disabled={!content.trim() && !images.length}
              onClick={generate}
            />
          </div>
        </>
      ) : (
        <>
          <p className="AIDeck__intro">
            {frameCount
              ? `${frameCount} slide${
                  frameCount === 1 ? "" : "s"
                } ready. Uses the selected frames, or else the latest AI deck, or else every frame on the canvas, in slide order.`
              : "No frames yet. Create a deck, or draw frames (Frame tool, F) to use as slides."}
          </p>
          <div className="AIDeck__formats">
            {FORMATS.map((format) => (
              <button
                key={format.value}
                type="button"
                className={`AIDeck__format${
                  format.value === "present" ? " AIDeck__format--primary" : ""
                }`}
                disabled={!frameCount || !!progress}
                onClick={() => runExport(format.value)}
              >
                <strong>{format.label}</strong>
                <span>{format.hint}</span>
              </button>
            ))}
          </div>
          {error && <div className="AIDeck__error">{error}</div>}
          {progress && (
            <div className="AIDeck__hint AIDeck__progress">{progress}</div>
          )}
        </>
      )}
    </Dialog>
  );
};

/** Full-screen slideshow of rendered slides. */
const Presenter = ({
  slides,
  onClose,
}: {
  slides: SlideImage[];
  onClose: () => void;
}) => {
  const [index, setIndex] = useState(0);
  const [notes, setNotes] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.requestFullscreen?.().catch(() => {});
    const onKey = (event: KeyboardEvent) => {
      if (
        ["ArrowRight", "ArrowDown", " ", "PageDown", "Enter"].includes(
          event.key,
        )
      ) {
        setIndex((i) => Math.min(slides.length - 1, i + 1));
      } else if (
        ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(event.key)
      ) {
        setIndex((i) => Math.max(0, i - 1));
      } else if (event.key === "Home") {
        setIndex(0);
      } else if (event.key === "End") {
        setIndex(slides.length - 1);
      } else if (event.key.toLowerCase() === "n") {
        setNotes((v) => !v);
      } else if (event.key === "Escape") {
        onClose();
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const onFullscreenExit = () => {
      if (!document.fullscreenElement) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("fullscreenchange", onFullscreenExit);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("fullscreenchange", onFullscreenExit);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [slides.length, onClose]);

  const slide = slides[index];
  return (
    <div
      ref={rootRef}
      className="AIDeckPresenter"
      onClick={(event) =>
        setIndex((i) =>
          event.clientX < window.innerWidth / 3
            ? Math.max(0, i - 1)
            : Math.min(slides.length - 1, i + 1),
        )
      }
    >
      <img src={slide.dataURL} alt={slide.title} />
      {notes && slide.meta?.notes && (
        <div className="AIDeckPresenter__notes">{slide.meta.notes}</div>
      )}
      <div className="AIDeckPresenter__bar">
        {index + 1} / {slides.length} · arrows to move · N notes · Esc to exit
      </div>
    </div>
  );
};

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import "./FlowAnimation.scss";

/** seconds between one hop of the flow and the next */
const STEP = 0.7;
/** seconds a dot takes to travel one arrow */
const TRAVEL = 1.2;
/** pause before the flow starts again */
const PAUSE = 0.8;
/** unbound arrows count as consecutive when one ends this close to where the next starts */
const CHAIN_DISTANCE = 220;

type FlowPath = { id: string; d: string; rank: number; color: string };
type View = Pick<
  AppState,
  "scrollX" | "scrollY" | "offsetLeft" | "offsetTop" | "width" | "height"
> & { zoom: number };

const isArrow = (el: ExcalidrawElement): el is ExcalidrawArrowElement =>
  el.type === "arrow" && !el.isDeleted;

const absolutePoints = (arrow: ExcalidrawArrowElement) =>
  arrow.points.map(([x, y]) => ({ x: arrow.x + x, y: arrow.y + y }));

/**
 * Orders arrows by how far down the flow they are: arrows leaving a shape
 * that another arrow points into come later. Bindings decide the order;
 * unbound arrows use endpoint proximity.
 */
export const flowRanks = (arrows: readonly ExcalidrawArrowElement[]) => {
  const ends = arrows.map((arrow) => {
    const points = absolutePoints(arrow);
    return { start: points[0], end: points[points.length - 1] };
  });
  const follows = (a: number, b: number) => {
    const first = arrows[a];
    const next = arrows[b];
    if (first.endBinding && next.startBinding) {
      return first.endBinding.elementId === next.startBinding.elementId;
    }
    return (
      Math.hypot(
        ends[a].end.x - ends[b].start.x,
        ends[a].end.y - ends[b].start.y,
      ) < CHAIN_DISTANCE
    );
  };
  const rank = arrows.map(() => 0);
  // longest-path relaxation; capped so cycles cannot loop forever
  for (let pass = 0; pass < Math.min(arrows.length, 30); pass++) {
    let changed = false;
    for (let a = 0; a < arrows.length; a++) {
      for (let b = 0; b < arrows.length; b++) {
        if (
          a !== b &&
          follows(a, b) &&
          rank[b] < rank[a] + 1 &&
          rank[a] + 1 < arrows.length
        ) {
          rank[b] = rank[a] + 1;
          changed = true;
        }
      }
    }
    if (!changed) {
      break;
    }
  }
  return rank;
};

const toPath = (arrow: ExcalidrawArrowElement) =>
  absolutePoints(arrow)
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

const PlayIcon = (
  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
  </svg>
);
const StopIcon = (
  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" />
  </svg>
);

/**
 * "Animate flow" button plus a light overlay: dashes flow along each arrow and a
 * small dot travels them in flow order. Purely visual: the drawing is not changed.
 * With arrows selected, only those animate.
 */
export const FlowAnimation = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const [playing, setPlaying] = useState(false);
  const [hasArrows, setHasArrows] = useState(false);
  const [paths, setPaths] = useState<FlowPath[]>([]);
  const [view, setView] = useState<View | null>(null);
  const frame = useRef(0);
  const signature = useRef("");

  useEffect(() => {
    const update = (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
    ) => {
      const arrows = elements.filter(isArrow);
      setHasArrows(arrows.length > 0);
      setView({
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom.value,
        offsetLeft: appState.offsetLeft,
        offsetTop: appState.offsetTop,
        width: appState.width,
        height: appState.height,
      });
      if (!playing) {
        return;
      }
      const selected = arrows.filter((a) => appState.selectedElementIds[a.id]);
      const active = selected.length ? selected : arrows;
      // recompute paths only when the arrows themselves changed
      const next = active.map((a) => `${a.id}:${a.version}`).join("|");
      if (next === signature.current) {
        return;
      }
      signature.current = next;
      const ranks = flowRanks(active);
      setPaths(
        active.map((arrow, i) => ({
          id: arrow.id,
          d: toPath(arrow),
          rank: ranks[i],
          color: arrow.strokeColor,
        })),
      );
    };
    const schedule = (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
    ) => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => update(elements, appState));
    };
    schedule(excalidrawAPI.getSceneElements(), excalidrawAPI.getAppState());
    const unsubscribe = excalidrawAPI.onChange((elements, appState) =>
      schedule(elements, appState),
    );
    return () => {
      cancelAnimationFrame(frame.current);
      unsubscribe();
    };
  }, [excalidrawAPI, playing]);

  useEffect(() => {
    if (!playing) {
      signature.current = "";
      setPaths([]);
    }
  }, [playing]);

  const cycle = useMemo(
    () => Math.max(0, ...paths.map((p) => p.rank)) * STEP + TRAVEL + PAUSE,
    [paths],
  );

  if (!hasArrows && !playing) {
    return null;
  }

  return (
    <>
      {playing && view && paths.length > 0 && (
        <svg
          className="FlowAnimation__overlay"
          style={{
            left: view.offsetLeft,
            top: view.offsetTop,
            width: view.width,
            height: view.height,
          }}
          aria-hidden="true"
        >
          <g
            transform={`scale(${view.zoom}) translate(${view.scrollX} ${view.scrollY})`}
          >
            {paths.map(({ id, d, rank, color }) => {
              const start = (rank * STEP) / cycle;
              const end = (rank * STEP + TRAVEL) / cycle;
              const fade = Math.min(end + 0.04, 1);
              return (
                <g key={id}>
                  <path
                    className="FlowAnimation__trail"
                    d={d}
                    stroke={color}
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    className="FlowAnimation__dot"
                    r={3.5 / view.zoom}
                    fill={color}
                    opacity="0"
                  >
                    <animateMotion
                      path={d}
                      dur={`${cycle}s`}
                      repeatCount="indefinite"
                      calcMode="linear"
                      keyPoints="0;0;1;1"
                      keyTimes={`0;${start};${end};1`}
                    />
                    <animate
                      attributeName="opacity"
                      values="0;0;1;1;0;0"
                      keyTimes={`0;${start};${start};${end};${fade};1`}
                      dur={`${cycle}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                </g>
              );
            })}
          </g>
        </svg>
      )}
      <button
        type="button"
        className={`FlowAnimation__button${
          playing ? " FlowAnimation__button--playing" : ""
        }`}
        onClick={() => setPlaying((value) => !value)}
        title={
          playing
            ? "Stop the flow animation"
            : "Animate the flow along the arrows (selected arrows only, if any are selected)"
        }
      >
        {playing ? StopIcon : PlayIcon}
        <span>{playing ? "Stop flow" : "Animate flow"}</span>
      </button>
    </>
  );
};

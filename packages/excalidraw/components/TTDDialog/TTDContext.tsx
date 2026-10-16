import { randomId } from "@excalidraw/common";

import { atom } from "../../editor-jotai";

import { DEFAULT_FRAME_RATIO } from "./frame";

import type { FrameRatio } from "./frame";
import type { RateLimits, TChat } from "./types";

export const rateLimitsAtom = atom<RateLimits | null>(null);

export const showPreviewAtom = atom<boolean>(false);

export const errorAtom = atom<Error | null>(null);

/** Flowchart layout chosen in the preview: as generated, left to right, or top to bottom. */
export type DiagramDirection = "auto" | "LR" | "TB";
export const diagramDirectionAtom = atom<DiagramDirection>("auto");

/** Output shape for generated diagrams; square by default for social posts. */
export const frameRatioAtom = atom<FrameRatio>(DEFAULT_FRAME_RATIO);

export const chatHistoryAtom = atom<TChat.ChatHistory>({
  id: randomId(),
  messages: [],
  currentPrompt: "",
});

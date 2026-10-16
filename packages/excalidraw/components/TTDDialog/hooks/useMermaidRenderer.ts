import { useCallback, useEffect, useMemo, useRef } from "react";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { useAtom, useAtomValue } from "../../../editor-jotai";

import {
  chatHistoryAtom,
  diagramDirectionAtom,
  errorAtom,
  frameRatioAtom,
  showPreviewAtom,
} from "../TTDContext";
import { convertMermaidToExcalidraw, cleanMermaidMessage } from "../common";
import { isValidMermaidSyntax } from "../utils/mermaidValidation";

import { getLastAssistantMessage } from "../utils/chat";

import { useUIAppState } from "../../../context/ui-appState";

import type { BinaryFiles } from "../../../types";
import type { MermaidToExcalidrawLibProps } from "../types";

const FAST_THROTTLE_DELAY = 300;
const SLOW_THROTTLE_DELAY = 3000;
const RENDER_SPEED_THRESHOLD = 100;
const PARSE_FAIL_DELAY = 100;

interface UseMermaidRendererProps {
  mermaidToExcalidrawLib: MermaidToExcalidrawLibProps;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}

export const useMermaidRenderer = ({
  mermaidToExcalidrawLib,
  canvasRef,
}: UseMermaidRendererProps) => {
  const [chatHistory] = useAtom(chatHistoryAtom);
  const [, setError] = useAtom(errorAtom);
  const direction = useAtomValue(diagramDirectionAtom);
  const frameRatio = useAtomValue(frameRatioAtom);

  const [showPreview, setShowPreview] = useAtom(showPreviewAtom);
  const isRenderingRef = useRef(false);

  const lastAssistantMessage = useMemo(
    () => getLastAssistantMessage(chatHistory),
    [chatHistory],
  );

  // Keeping lastAssistantMesssage in ref, so I can access it in useEffect hooks
  const lastAssistantMessageRef = useRef(lastAssistantMessage);
  // names the diagram's frame when the AI gave no title
  const lastUserPromptRef = useRef<string | undefined>(undefined);
  lastUserPromptRef.current = [...chatHistory.messages]
    .reverse()
    .find((msg) => msg.type === "user" && typeof msg.content === "string")
    ?.content as string | undefined;
  useEffect(() => {
    lastAssistantMessageRef.current = lastAssistantMessage;
  }, [lastAssistantMessage]);

  const data = useRef<{
    elements: readonly NonDeletedExcalidrawElement[];
    files: BinaryFiles | null;
  }>({
    elements: [],
    files: null,
  });

  const lastRenderTimeRef = useRef(0);
  const pendingContentRef = useRef<string | null>(null);
  const hasErrorOffsetRef = useRef(false);
  const currentThrottleDelayRef = useRef(FAST_THROTTLE_DELAY);

  const { theme } = useUIAppState();

  // Latest layout choice, read when a render starts, so a render queued while
  // another one runs uses the newest Layout and Frame settings.
  const layoutRef = useRef({ direction, frameRatio });
  layoutRef.current = { direction, frameRatio };
  const queuedDefinitionRef = useRef<string | null>(null);

  const renderMermaid = useCallback(
    async (mermaidDefinition: string): Promise<boolean> => {
      if (!mermaidDefinition.trim() || !mermaidToExcalidrawLib.loaded) {
        return false;
      }

      if (isRenderingRef.current) {
        // run again once the current render finishes instead of dropping it
        queuedDefinitionRef.current = mermaidDefinition;
        return false;
      }

      isRenderingRef.current = true;
      let next: string | null = mermaidDefinition;
      let success = false;

      while (next) {
        queuedDefinitionRef.current = null;
        const renderStartTime = performance.now();

        const result = await convertMermaidToExcalidraw({
          canvasRef,
          data,
          mermaidToExcalidrawLib,
          setError,
          mermaidDefinition: next,
          theme,
          ...layoutRef.current,
          prompt: lastUserPromptRef.current,
          // while the AI is still writing, skip the arrangement search so the
          // preview keeps up; the finished diagram gets the full search
          fitArrangement: !lastAssistantMessageRef.current?.isGenerating,
        });

        const renderDuration = performance.now() - renderStartTime;

        if (renderDuration < RENDER_SPEED_THRESHOLD) {
          currentThrottleDelayRef.current = FAST_THROTTLE_DELAY;
        } else {
          currentThrottleDelayRef.current = SLOW_THROTTLE_DELAY;
        }
        success = result.success;
        next = queuedDefinitionRef.current;
      }

      isRenderingRef.current = false;
      return success;
    },
    [canvasRef, mermaidToExcalidrawLib, setError, theme],
  );

  const throttledRenderMermaid = useMemo(() => {
    const fn = async (content: string) => {
      const now = Date.now();
      const timeSinceLastRender = now - lastRenderTimeRef.current;
      const throttleDelay = currentThrottleDelayRef.current;

      if (!isValidMermaidSyntax(content)) {
        if (!hasErrorOffsetRef.current) {
          lastRenderTimeRef.current = Math.max(
            lastRenderTimeRef.current,
            now - throttleDelay + PARSE_FAIL_DELAY,
          );
          hasErrorOffsetRef.current = true;
        }
        pendingContentRef.current = content;
        return;
      }

      hasErrorOffsetRef.current = false;

      if (timeSinceLastRender < throttleDelay) {
        pendingContentRef.current = content;
        return;
      }

      pendingContentRef.current = null;
      const success = await renderMermaid(content);
      lastRenderTimeRef.current = Date.now();

      if (!success) {
        lastRenderTimeRef.current =
          lastRenderTimeRef.current - throttleDelay + PARSE_FAIL_DELAY;
        hasErrorOffsetRef.current = true;
      }
    };

    fn.flush = async () => {
      if (pendingContentRef.current) {
        const content = pendingContentRef.current;
        pendingContentRef.current = null;
        await renderMermaid(content);
        lastRenderTimeRef.current = Date.now();
      }
    };

    fn.cancel = () => {
      pendingContentRef.current = null;
    };

    return fn;
  }, [renderMermaid]);

  const resetThrottleState = useCallback(() => {
    lastRenderTimeRef.current = 0;
    pendingContentRef.current = null;
    hasErrorOffsetRef.current = false;
    currentThrottleDelayRef.current = FAST_THROTTLE_DELAY;
  }, []);

  // this hook is responsible for keep rendering during streaming
  useEffect(() => {
    if (lastAssistantMessage?.content && lastAssistantMessage?.isGenerating) {
      const cleaned = cleanMermaidMessage(lastAssistantMessage.content);
      throttledRenderMermaid(cleaned || lastAssistantMessage.content);
    } else if (!lastAssistantMessage?.isGenerating) {
      throttledRenderMermaid.flush();
      resetThrottleState();
      if (lastAssistantMessage?.content) {
        const cleaned = cleanMermaidMessage(lastAssistantMessage.content);
        throttledRenderMermaid(cleaned || lastAssistantMessage.content);
      }
    }
  }, [
    resetThrottleState,
    throttledRenderMermaid,
    lastAssistantMessage?.isGenerating,
    lastAssistantMessage?.content,
  ]);

  // re-render the finished diagram when the layout direction changes
  useEffect(() => {
    const msg = lastAssistantMessageRef.current;
    if (!msg?.content || msg.error || msg.isGenerating) {
      return;
    }
    renderMermaid(cleanMermaidMessage(msg.content) || msg.content);
  }, [direction, frameRatio, renderMermaid]);

  // render the last message if the user navigates between the existing chats
  useEffect(() => {
    const msg = lastAssistantMessageRef.current;
    if (!msg?.content || msg.error) {
      return;
    }

    if (!showPreview) {
      return;
    }

    const cleaned = cleanMermaidMessage(msg.content);
    renderMermaid(cleaned || msg.content);
  }, [chatHistory?.id, renderMermaid, showPreview]);

  useEffect(() => {
    if (
      !chatHistory.messages?.filter((msg) => msg.type === "assistant").length
    ) {
      const canvasNode = canvasRef.current;
      if (canvasNode) {
        const parent = canvasNode.parentElement;
        if (parent) {
          parent.style.background = "";
          canvasNode.replaceChildren();
        }
      }
      setShowPreview(false);
    } else if (!showPreview) {
      setShowPreview(true);
    }
  }, [chatHistory.messages, setShowPreview, canvasRef, showPreview]);

  return {
    data,
  };
};

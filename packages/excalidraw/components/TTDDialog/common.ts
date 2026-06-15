import {
  DEFAULT_EXPORT_PADDING,
  EDITOR_LS_KEYS,
  THEME,
} from "@excalidraw/common";

import { convertToExcalidrawElements } from "@excalidraw/element";

import { exportToCanvas } from "@excalidraw/utils";

import type {
  NonDeletedExcalidrawElement,
  Theme,
} from "@excalidraw/element/types";

import { EditorLocalStorage } from "../../data/EditorLocalStorage";

import type { MermaidToExcalidrawLibProps } from "./types";

import type { AppClassProperties, BinaryFiles } from "../../types";

export const resetPreview = ({
  canvasRef,
  setError,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  setError: (error: Error | null) => void;
}) => {
  const canvasNode = canvasRef.current;

  if (!canvasNode) {
    return;
  }
  const parent = canvasNode.parentElement;
  if (!parent) {
    return;
  }
  parent.style.background = "";
  setError(null);
  canvasNode.replaceChildren();
};

export const convertMermaidToExcalidraw = async ({
  canvasRef,
  mermaidToExcalidrawLib,
  mermaidDefinition,
  setError,
  data,
  theme,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  mermaidToExcalidrawLib: MermaidToExcalidrawLibProps;
  mermaidDefinition: string;
  setError: (error: Error | null) => void;
  data: React.MutableRefObject<{
    elements: readonly NonDeletedExcalidrawElement[];
    files: BinaryFiles | null;
  }>;
  theme: Theme;
}): Promise<{ success: true } | { success: false; error?: Error }> => {
  const canvasNode = canvasRef.current;
  const parent = canvasNode?.parentElement;

  if (!canvasNode || !parent) {
    return { success: false };
  }

  if (!mermaidDefinition) {
    resetPreview({ canvasRef, setError });
    return { success: false };
  }

  let ret;
  try {
    const api = await mermaidToExcalidrawLib.api;

    try {
      ret = await api.parseMermaidToExcalidraw(mermaidDefinition);
    } catch (err: unknown) {
      const originalParseError = err as Error;

      if (!mermaidDefinition.includes('"')) {
        return { success: false, error: originalParseError };
      }

      try {
        ret = await api.parseMermaidToExcalidraw(
          mermaidDefinition.replace(/"/g, "'"),
        );
      } catch {
        // Keep the original error so line/column references stay aligned with
        // the user's unmodified input.
        return { success: false, error: originalParseError };
      }
    }

    const { elements, files = {} } = ret;
    setError(null);

    data.current = {
      elements: convertToExcalidrawElements(elements, {
        regenerateIds: true,
      }),
      files,
    };

    const canvas = await exportToCanvas({
      elements: data.current.elements,
      files: data.current.files,
      exportPadding: DEFAULT_EXPORT_PADDING,
      maxWidthOrHeight:
        Math.max(parent.offsetWidth, parent.offsetHeight) *
        window.devicePixelRatio,
      appState: {
        exportWithDarkMode: theme === THEME.DARK,
      },
    });

    parent.style.background = "var(--default-bg-color)";
    canvasNode.replaceChildren(canvas);
    return { success: true };
  } catch (err: any) {
    parent.style.background = "var(--default-bg-color)";
    if (mermaidDefinition) {
      setError(err);
    }

    // Return error so caller can display meaningful error message
    return { success: false, error: err };
  }
};
export const saveMermaidDataToStorage = (mermaidDefinition: string) => {
  EditorLocalStorage.set(
    EDITOR_LS_KEYS.MERMAID_TO_EXCALIDRAW,
    mermaidDefinition,
  );
};

export const insertToEditor = ({
  app,
  data,
  text,
  shouldSaveMermaidDataToStorage,
}: {
  app: AppClassProperties;
  data: React.MutableRefObject<{
    elements: readonly NonDeletedExcalidrawElement[];
    files: BinaryFiles | null;
  }>;
  text?: string;
  shouldSaveMermaidDataToStorage?: boolean;
}) => {
  const { elements: newElements, files } = data.current;

  if (!newElements.length) {
    return;
  }

  app.addElementsFromPasteOrLibrary({
    elements: newElements,
    files,
    position: "center",
    fitToContent: true,
  });
  app.setOpenDialog(null);

  if (shouldSaveMermaidDataToStorage && text) {
    saveMermaidDataToStorage(text);
  }
};

export const autoQuoteMermaidLabels = (mermaidCode: string): string => {
  if (!mermaidCode) {
    return "";
  }

  let lines = mermaidCode.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Skip lines that are comments or don't look like they contain node declarations
    if (line.trim().startsWith("%%")) {
      continue;
    }

    // Prefix pattern that can precede a valid node ID:
    // Start of line, whitespace, or any standard Mermaid arrow/connector
    const prefix = /(^|\s+|-->|---|-\.-?\.>|==>)\s*/.source;

    // 1. Match square brackets: ID[label] -> ID["label"]
    const squareRegex = new RegExp(`${prefix}([a-zA-Z0-9_-]+)\\s*(\\[)\\s*([^"\\s][^\\]]*?)(\\s*\\])`, "g");
    line = line.replace(squareRegex, (match, prefixMatch, id, openBrack, label, closeBrack) => {
      const cleanedLabel = label.replace(/"/g, "'").trim();
      return `${prefixMatch}${id}["${cleanedLabel}"]`;
    });

    // 2. Match round brackets: ID(label) -> ID("label")
    const roundRegex = new RegExp(`${prefix}([a-zA-Z0-9_-]+)\\s*(\\()\\s*([^"\\s][^\\)]*?)(\\s*\\))`, "g");
    line = line.replace(roundRegex, (match, prefixMatch, id, openBrack, label, closeBrack) => {
      const cleanedLabel = label.replace(/"/g, "'").trim();
      return `${prefixMatch}${id}("${cleanedLabel}")`;
    });

    // 3. Match curly brackets: ID{label} -> ID{"label"}
    const curlyRegex = new RegExp(`${prefix}([a-zA-Z0-9_-]+)\\s*(\\{)\\s*([^"\\s][^\\}]*?)(\\s*\\})`, "g");
    line = line.replace(curlyRegex, (match, prefixMatch, id, openBrack, label, closeBrack) => {
      const cleanedLabel = label.replace(/"/g, "'").trim();
      return `${prefixMatch}${id}{"${cleanedLabel}"}`;
    });

    lines[i] = line;
  }

  return lines.join("\n");
};

export const cleanMermaidMessage = (content: string): string => {
  if (!content) {
    return "";
  }

  let cleaned = "";

  // 1. Check for closed ```mermaid block
  let match = content.match(/```mermaid\s*([\s\S]*?)\s*```/);
  if (match) {
    cleaned = match[1].trim();
  } else {
    // 2. Check for unclosed ```mermaid block (e.g. streaming)
    match = content.match(/```mermaid\s*([\s\S]*)/);
    if (match) {
      cleaned = match[1].trim();
    } else {
      // 3. Check for closed generic ``` block
      match = content.match(/```\s*([\s\S]*?)\s*```/);
      if (match) {
        cleaned = match[1].trim();
      } else {
        // 4. Check for unclosed generic ``` block (e.g. streaming)
        match = content.match(/```\s*([\s\S]*)/);
        if (match) {
          cleaned = match[1].trim();
        } else {
          // 5. If there are any leftover markdown fences, strip them
          cleaned = content.replace(/```mermaid/g, "").replace(/```/g, "").trim();
        }
      }
    }
  }

  // Auto-quote unquoted labels to prevent syntax errors
  return autoQuoteMermaidLabels(cleaned);
};

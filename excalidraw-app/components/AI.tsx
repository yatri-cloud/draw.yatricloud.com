import {
  DiagramToCodePlugin,
  exportToBlob,
  getTextFromElements,
  MIME_TYPES,
  TTDDialog,
  TTDStreamFetch,
} from "@excalidraw/excalidraw";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";
import { safelyParseJSON } from "@excalidraw/common";
import { RequestError } from "@excalidraw/excalidraw/errors";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { TTDIndexedDBAdapter } from "../data/TTDStorage";

/**
 * Sends a streaming chat request to a local Ollama instance.
 * Ollama's /api/chat endpoint returns NDJSON with one JSON object per line.
 * Each line has: { done: boolean, message: { role, content } }
 */
async function ollamaStreamFetch({
  url,
  model,
  messages,
  onChunk,
  onStreamCreated,
  signal,
}: {
  url: string;
  model: string;
  messages: readonly { role: "user" | "assistant"; content: string }[];
  onChunk?: (chunk: string) => void;
  onStreamCreated?: () => void;
  signal?: AbortSignal;
}) {
  const SYSTEM_PROMPT = `You are a Mermaid.js diagram expert. Your sole job is to convert the user's natural-language description into a valid Mermaid diagram definition.

CRITICAL OUTPUT RULES:
- Output ONLY the raw Mermaid syntax — absolutely no markdown code fences (\`\`\`), no explanation, no comments, no preamble.
- Start your response directly with the diagram type keyword (e.g. "flowchart LR", "sequenceDiagram", "erDiagram", etc.).
- Ensure the syntax is valid and parseable by Mermaid.js v10+.

MERMAID SYNTAX RULES — follow these exactly to avoid parse errors:
1. Node labels with special characters MUST use double quotes: write A["Label (with parens)"] NOT A[Label (with parens)]
2. Parentheses () inside ANY bracket style [, (, {, > MUST be quoted: A["Cache (Redis)"] ✓ — A[Cache (Redis)] ✗
3. Subgraph IDs must be simple alphanumeric strings, no spaces: use "subgraph FrontendLayer" not "subgraph Frontend Layer"
4. Subgraph display labels go in quotes after the ID: subgraph FE["Frontend Layer"]
5. Never use curly braces {} or special chars in node IDs — only in labels (quoted)
6. Arrow labels with spaces must be quoted: A -->|"my label"| B
7. For flowcharts prefer "flowchart TD" or "flowchart LR"
8. Keep node IDs short and alphanumeric: use "AuthSvc" not "Authentication Service"
9. Never use parentheses () in node IDs
10. Semicolons at end of lines are optional — omit them

EXAMPLE of correct syntax:
flowchart TD
    subgraph FE["Frontend"]
        U["User Browser"]
    end
    subgraph BE["Backend"]
        API["API Gateway"]
        Auth["Auth Service"]
        Cache["Cache (Redis)"]
    end
    U --> API
    API --> Auth
    API --> Cache`;

  try {
    const response = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new RequestError({
        message: errorText || `Ollama returned status ${response.status}`,
        status: response.status,
      });
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new RequestError({
        message: "Could not read Ollama response body",
        status: 500,
      });
    }

    onStreamCreated?.();

    const decoder = new TextDecoder();
    let buffer = "";
    let fullResponse = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Ollama streams NDJSON: one JSON object per line
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          try {
            const parsed = JSON.parse(trimmed);
            const delta: string = parsed?.message?.content ?? "";
            if (delta) {
              fullResponse += delta;
              onChunk?.(delta);
            }
          } catch {
            // ignore malformed lines
          }
        }
      }
    } catch (streamErr: any) {
      reader.releaseLock();
      if (streamErr.name === "AbortError") {
        return {
          error: new RequestError({ message: "Request aborted", status: 499 }),
        };
      }
      throw streamErr;
    }

    reader.releaseLock();

    if (!fullResponse) {
      return {
        error: new RequestError({
          message:
            "Ollama returned an empty response. Make sure the model is loaded.",
          status: 500,
        }),
      };
    }

    return {
      generatedResponse: fullResponse,
      error: null,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return {
        error: new RequestError({ message: "Request aborted", status: 499 }),
      };
    }
    if (err instanceof RequestError) {
      return { error: err };
    }
    return {
      error: new RequestError({
        message:
          err.message ||
          'Could not connect to Ollama. Is it running? Try: OLLAMA_ORIGINS="*" ollama serve',
        status: 500,
      }),
    };
  }
}

export const AIComponents = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  return (
    <>
      <DiagramToCodePlugin
        generate={async ({ frame, children }) => {
          const appState = excalidrawAPI.getAppState();

          const blob = await exportToBlob({
            elements: children,
            appState: {
              ...appState,
              exportBackground: true,
              viewBackgroundColor: appState.viewBackgroundColor,
            },
            exportingFrame: frame,
            files: excalidrawAPI.getFiles(),
            mimeType: MIME_TYPES.jpg,
          });

          const dataURL = await getDataURL(blob);

          const textFromFrameChildren = getTextFromElements(children);

          const response = await fetch(
            `${
              import.meta.env.VITE_APP_AI_BACKEND
            }/v1/ai/diagram-to-code/generate`,
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                texts: textFromFrameChildren,
                image: dataURL,
                theme: appState.theme,
              }),
            },
          );

          if (!response.ok) {
            const text = await response.text();
            const errorJSON = safelyParseJSON(text);

            if (!errorJSON) {
              throw new Error(text);
            }

            if (errorJSON.statusCode === 429) {
              return {
                html: `<html>
                <body style="margin: 0; text-align: center">
                <div style="display: flex; align-items: center; justify-content: center; flex-direction: column; height: 100vh; padding: 0 60px">
                  <div style="color:red">Too many requests today,</br>please try again tomorrow!</div>
                  </br>
                  </br>
                  <div>You can also try <a href="${
                    import.meta.env.VITE_APP_PLUS_LP
                  }/plus?utm_source=excalidraw&utm_medium=app&utm_content=d2c" target="_blank" rel="noopener">Excalidraw+</a> to get more requests.</div>
                </div>
                </body>
                </html>`,
              };
            }

            throw new Error(errorJSON.message || text);
          }

          try {
            const { html } = await response.json();

            if (!html) {
              throw new Error("Generation failed (invalid response)");
            }
            return {
              html,
            };
          } catch (error: any) {
            throw new Error("Generation failed (invalid response)");
          }
        }}
      />

      <TTDDialog
        onTextSubmit={async (props) => {
          const {
            onChunk,
            onStreamCreated,
            signal,
            messages,
            provider,
            ollamaUrl,
            ollamaModel,
          } = props;

          // --- Local Ollama provider ---
          if (provider === "ollama") {
            return ollamaStreamFetch({
              url: ollamaUrl || "http://localhost:11434",
              model: ollamaModel || "",
              messages,
              onChunk,
              onStreamCreated,
              signal,
            });
          }

          // --- Default cloud provider ---
          const result = await TTDStreamFetch({
            url: `${
              import.meta.env.VITE_APP_AI_BACKEND
            }/v1/ai/text-to-diagram/chat-streaming`,
            messages,
            onChunk,
            onStreamCreated,
            extractRateLimits: true,
            signal,
          });

          return result;
        }}
        persistenceAdapter={TTDIndexedDBAdapter}
      />
    </>
  );
};

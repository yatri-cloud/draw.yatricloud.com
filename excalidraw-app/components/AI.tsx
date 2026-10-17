import {
  DiagramToCodePlugin,
  exportToBlob,
  getNonDeletedElements,
  getTextFromElements,
  MIME_TYPES,
  parseSSEStream,
  TTDDialog,
} from "@excalidraw/excalidraw";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";
import { safelyParseJSON } from "@excalidraw/common";
import { RequestError } from "@excalidraw/excalidraw/errors";

import type { StreamChunk } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { TTDIndexedDBAdapter } from "../data/TTDStorage";

import { AISketchDialog, AISketchTrigger } from "./AISketch/AISketch";
import { describeWireframe } from "./wireframeLayout";

// ─── Mermaid system prompt shared by all providers ───────────────────────────
const MERMAID_SYSTEM_PROMPT = `You are a Mermaid.js diagram expert. Your sole job is to convert the user's natural-language description into a valid Mermaid diagram definition.

CRITICAL OUTPUT RULES:
- Output ONLY the raw Mermaid syntax — absolutely no markdown code fences (\`\`\`), no explanation, no comments, no preamble.
- Start your response directly with the diagram type keyword (e.g. "flowchart TD", "sequenceDiagram", "erDiagram", etc.).
- Ensure the syntax is valid and parseable by Mermaid.js v10+.

MERMAID SYNTAX RULES — follow ALL of these exactly to avoid parse errors:
1. Node labels with special characters MUST use double quotes: A["Label (with parens)"] NOT A[Label (with parens)]
2. Parentheses () inside ANY bracket style [, (, {, > MUST be quoted: A["Cache (Redis)"] ✓ — A[Cache (Redis)] ✗
3. Subgraph IDs must be simple alphanumeric with no spaces: "subgraph StorageLayer" not "subgraph Storage Layer"
4. Subgraph display labels go in quotes after the ID: subgraph SL["Storage Layer"]
5. CRITICAL — Node IDs must NEVER match subgraph IDs. If you have a subgraph called "CDN", any node representing CDN must use a different ID like "CDNNode" or "CdnSvc". Using the same ID for both a node and a subgraph causes a cycle error.
6. CRITICAL — Every node must be declared ONCE. If a node appears inside a subgraph, never redeclare it outside. Only reference it by ID in arrows outside.
7. CRITICAL — Never draw arrows directly TO or FROM a subgraph name/ID. Only connect individual nodes inside subgraphs.
8. Never use curly braces {} or special chars in node IDs — only in labels (quoted)
9. Arrow labels with spaces must be quoted: A -->|"my label"| B
10. For flowcharts prefer "flowchart TD" or "flowchart LR"
11. Keep node IDs short and alphanumeric: use "AuthSvc" not "Authentication Service"
12. Never use parentheses () in node IDs

EXAMPLE of correct syntax (note CDN is a node inside a subgraph, not a subgraph itself):
flowchart TD
    subgraph FE["Frontend"]
        User["User Browser"]
    end
    subgraph BE["Backend Services"]
        API["API Gateway"]
        Auth["Auth Service"]
        Feed["Feed Service"]
    end
    subgraph Store["Storage & CDN"]
        S3["S3 Storage"]
        CdnNode["CDN"]
        RedisCache["Cache (Redis)"]
    end
    User --> API
    API --> Auth
    API --> Feed
    Feed --> RedisCache
    Feed --> S3
    S3 --> CdnNode`;

// ─── Yatri AI default provider ───────────────────────────────────────────────
// Calls /api/ai/chat (Vercel Edge proxy → Yatri AI server).
// API key is injected server-side — never exposed to the browser.
// Expects SSE format: "data: {token: ...}\n" or "data: [DONE]\n"
async function yatriAIStreamFetch({
  messages,
  onChunk,
  onStreamCreated,
  signal,
}: {
  messages: readonly { role: "user" | "assistant"; content: string }[];
  onChunk?: (chunk: string) => void;
  onStreamCreated?: () => void;
  signal?: AbortSignal;
}) {
  try {
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new RequestError({
        message: errorText || `Yatri AI returned status ${response.status}`,
        status: response.status,
      });
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new RequestError({
        message: "Could not read response body",
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
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          // SSE format: "data: ..." lines
          if (trimmed.startsWith("data: ")) {
            const raw = trimmed.slice(6);
            if (raw === "[DONE]") {
              continue;
            }
            try {
              const parsed = JSON.parse(raw);
              // Yatri AI SSE: { token: "..." } or { error: "..." }
              if (parsed.token) {
                fullResponse += parsed.token;
                onChunk?.(parsed.token);
              }
              if (parsed.error) {
                throw new RequestError({
                  message: parsed.error,
                  status: 500,
                });
              }
              // Also handle the Excalidraw StreamChunk format as fallback
              if (parsed.type === "content" && parsed.delta) {
                fullResponse += parsed.delta;
                onChunk?.(parsed.delta);
              }
            } catch (e: any) {
              if (e instanceof RequestError) {
                throw e;
              }
              // Non-JSON SSE data — treat as raw text token
              if (raw) {
                fullResponse += raw;
                onChunk?.(raw);
              }
            }
          } else {
            // NDJSON fallback (Ollama-like format from proxy)
            try {
              const parsed = JSON.parse(trimmed);
              const delta: string =
                parsed?.message?.content ?? parsed?.token ?? "";
              if (delta) {
                fullResponse += delta;
                onChunk?.(delta);
              }
            } catch {
              // ignore
            }
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
          message: "AI returned an empty response. Please try again.",
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
        message: err.message || "Could not connect to Yatri AI.",
        status: 500,
      }),
    };
  }
}

// ─── Local Ollama provider ───────────────────────────────────────────────────
// Ollama /api/chat returns NDJSON: one JSON object per line.
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
  try {
    const response = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: MERMAID_SYSTEM_PROMPT },
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

// ─── Exported component ──────────────────────────────────────────────────────
export const AIComponents = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  return (
    <>
      <DiagramToCodePlugin
        generate={async ({ frame, children, onPartial }) => {
          const appState = excalidrawAPI.getAppState();

          // SAFETY: This should never happen, but log it just in case
          if (children.some((el) => el.isDeleted)) {
            console.error(
              "[NONDELETED][INVARIANT] Generated children elements should not be `isDeleted: true`",
            );
          }

          const blob = await exportToBlob({
            elements: getNonDeletedElements(children),
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

          const backendUrl = import.meta.env.VITE_APP_AI_BACKEND || "";
          const isProxy = backendUrl.includes("/api/ai");
          const fetchUrl = isProxy
            ? `${backendUrl}/diagram-to-code`
            : `${backendUrl}/v1/ai/diagram-to-code/generate-streaming`;

          const response = await fetch(fetchUrl, {
            method: "POST",
            headers: {
              Accept: "text/event-stream, application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              texts: textFromFrameChildren,
              image: dataURL,
              theme: appState.theme,
              // the shapes as an outline, for models that read text only
              layout: describeWireframe(frame, getNonDeletedElements(children)),
            }),
          });

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
                </div>
                </body>
                </html>`,
              };
            }

            throw new Error(errorJSON.message || text);
          }

          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const json = await response.json();
            if (!json?.html) {
              throw new Error("Generation failed (invalid response)");
            }
            return { html: json.html };
          }

          const reader = response.body?.getReader();

          if (!reader) {
            throw new Error("Generation failed (invalid response)");
          }

          let html = "";
          let streamError: Error | null = null;

          for await (const data of parseSSEStream(reader)) {
            if (data === "[DONE]") {
              break;
            }

            const chunk = safelyParseJSON(data) as StreamChunk | null;

            if (!chunk) {
              continue;
            }

            switch (chunk.type) {
              case "content": {
                if (chunk.delta) {
                  html += chunk.delta;
                  onPartial?.(html);
                }
                break;
              }
              case "error": {
                streamError = new Error(
                  chunk.error.message || "Generation failed",
                );
                break;
              }
              case "done": {
                break;
              }
            }
          }

          if (streamError) {
            throw streamError;
          }

          if (!html.trim()) {
            throw new Error("Generation failed (invalid response)");
          }

          return {
            html,
          };
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

          // --- Default provider: Yatri AI (server-side proxy) ---
          return yatriAIStreamFetch({
            messages,
            onChunk,
            onStreamCreated,
            signal,
          });
        }}
        persistenceAdapter={TTDIndexedDBAdapter}
      />

      <AISketchTrigger />
      <AISketchDialog />
    </>
  );
};

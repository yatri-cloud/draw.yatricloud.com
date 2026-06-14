import React, { useRef, useEffect, useLayoutEffect, useState } from "react";
import { KEYS } from "@excalidraw/common";

import { ArrowRightIcon, stop as StopIcon } from "../../icons";
import { InlineIcon } from "../../InlineIcon";

import { t } from "../../../i18n";

import { TTDWelcomeMessage } from "../TTDWelcomeMessage";

import { ChatMessage } from "./ChatMessage";

import type { TChat, TTTDDialog } from "../types";

import type { FormEventHandler } from "react";

export const ChatInterface = ({
  chatId,
  messages,
  currentPrompt,
  onPromptChange,
  onGenerate,
  isGenerating,
  rateLimits,
  onAbort,
  onMermaidTabClick,
  onAiRepairClick,
  onDeleteMessage,
  onInsertMessage,
  onRetry,
  renderWelcomeScreen,
  renderWarning,
}: {
  chatId: string;
  messages: TChat.ChatMessage[];
  currentPrompt: string;
  onPromptChange: (prompt: string) => void;
  onGenerate: TTTDDialog.OnGenerate;
  isGenerating: boolean;
  rateLimits?: {
    rateLimit: number;
    rateLimitRemaining: number;
  } | null;
  onViewAsMermaid?: () => void;
  generatedResponse?: string | null;
  onAbort?: () => void;
  onMermaidTabClick?: (message: TChat.ChatMessage) => void;
  onAiRepairClick?: (message: TChat.ChatMessage) => void;
  onDeleteMessage?: (messageId: string) => void;
  onInsertMessage?: (message: TChat.ChatMessage) => void;
  onRetry?: (message: TChat.ChatMessage) => void;
  renderWelcomeScreen?: TTTDDialog.renderWelcomeScreen;
  renderWarning?: TTTDDialog.renderWarning;
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [provider, setProvider] = useState<"default" | "ollama">(() => {
    return (localStorage.getItem("yatri-draw-ttd-provider") as "default" | "ollama") || "default";
  });
  const [ollamaUrl, setOllamaUrl] = useState(() => {
    return localStorage.getItem("yatri-draw-ttd-ollama-url") || "http://localhost:11434";
  });
  const [ollamaModel, setOllamaModel] = useState(() => {
    return localStorage.getItem("yatri-draw-ttd-ollama-model") || "";
  });
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [ollamaError, setOllamaError] = useState<string | null>(null);

  const fetchModels = async (url: string) => {
    setOllamaStatus("loading");
    setOllamaError(null);
    try {
      const res = await fetch(`${url}/api/tags`);
      if (!res.ok) {
        throw new Error(`Ollama returned status ${res.status}`);
      }
      const data = await res.json();
      const models = (data.models || []).map((m: any) => m.name);
      setOllamaModels(models);
      setOllamaStatus("success");
      if (models.length > 0) {
        if (!models.includes(ollamaModel)) {
          setOllamaModel(models[0]);
          localStorage.setItem("yatri-draw-ttd-ollama-model", models[0]);
        }
      } else {
        setOllamaModel("");
        localStorage.removeItem("yatri-draw-ttd-ollama-model");
      }
    } catch (err: any) {
      console.error("Failed to fetch Ollama models:", err);
      setOllamaModels([]);
      setOllamaStatus("error");
      setOllamaError(
        err.message || "Could not connect to Ollama. Make sure it is running and CORS is enabled."
      );
    }
  };

  useEffect(() => {
    if (provider === "ollama") {
      fetchModels(ollamaUrl);
    }
  }, [provider, ollamaUrl]);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextProvider = e.target.value as "default" | "ollama";
    setProvider(nextProvider);
    localStorage.setItem("yatri-draw-ttd-provider", nextProvider);
  };

  const handleOllamaUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextUrl = e.target.value;
    setOllamaUrl(nextUrl);
    localStorage.setItem("yatri-draw-ttd-ollama-url", nextUrl);
  };

  const handleOllamaModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextModel = e.target.value;
    setOllamaModel(nextModel);
    localStorage.setItem("yatri-draw-ttd-ollama-model", nextModel);
  };

  useLayoutEffect(() => {
    messagesEndRef.current?.scrollIntoView();
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [chatId]);

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    onPromptChange(value);
  };

  const handleSubmit = () => {
    if (isGenerating && onAbort) {
      onAbort();
      return;
    }

    const trimmedPrompt = currentPrompt.trim();
    if (!trimmedPrompt) {
      return;
    }

    onGenerate({ prompt: trimmedPrompt });
    onPromptChange("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === KEYS.ENTER && !event.shiftKey) {
      event.preventDefault();
      if (!isGenerating) {
        handleSubmit();
      }
    }
  };

  const canSend =
    currentPrompt.trim().length > 3 &&
    !isGenerating &&
    (rateLimits?.rateLimitRemaining ?? 1) > 0;

  const canStop = isGenerating && !!onAbort;

  const onInput: FormEventHandler<HTMLTextAreaElement> = (ev) => {
    const target = ev.target as HTMLTextAreaElement;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
  };

  return (
    <div className="chat-interface">
      <div className="chat-interface__config">
        <div className="chat-interface__config-row">
          <div className="chat-interface__config-field">
            <label className="chat-interface__config-label">AI Provider</label>
            <select
              className="chat-interface__config-select"
              value={provider}
              onChange={handleProviderChange}
            >
              <option value="default">Default AI</option>
              <option value="ollama">Local Ollama</option>
            </select>
          </div>

          {provider === "ollama" && (
            <>
              <div className="chat-interface__config-field chat-interface__config-field--url">
                <label className="chat-interface__config-label">Ollama URL</label>
                <input
                  type="text"
                  className="chat-interface__config-input"
                  value={ollamaUrl}
                  onChange={handleOllamaUrlChange}
                  placeholder="http://localhost:11434"
                />
              </div>

              <div className="chat-interface__config-field">
                <label className="chat-interface__config-label">Model</label>
                <div className="chat-interface__config-select-wrapper">
                  <select
                    className="chat-interface__config-select"
                    value={ollamaModel}
                    onChange={handleOllamaModelChange}
                    disabled={ollamaModels.length === 0}
                  >
                    {ollamaModels.length === 0 ? (
                      <option value="">No models found</option>
                    ) : (
                      ollamaModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    className="chat-interface__config-refresh-btn"
                    onClick={() => fetchModels(ollamaUrl)}
                    title="Refresh models"
                  >
                    🔄
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {provider === "ollama" && ollamaStatus === "error" && (
          <div className="chat-interface__config-warning">
            <strong>Connection Error:</strong> {ollamaError}
            <br />
            <span className="chat-interface__config-troubleshooting">
              To allow connections, make sure Ollama is serving with CORS enabled:
              <code className="chat-interface__config-code">OLLAMA_ORIGINS="*" ollama serve</code>
            </span>
          </div>
        )}
      </div>

      <div className="chat-interface__messages">
        {messages.length === 0 ? (
          <div className="chat-interface__welcome-screen">
            {renderWelcomeScreen ? (
              renderWelcomeScreen({ rateLimits: rateLimits ?? null })
            ) : (
              <TTDWelcomeMessage />
            )}
          </div>
        ) : (
          messages.map((message, index) => (
            <ChatMessage
              key={message.id}
              message={message}
              onMermaidTabClick={onMermaidTabClick}
              onAiRepairClick={onAiRepairClick}
              onDeleteMessage={onDeleteMessage}
              onInsertMessage={onInsertMessage}
              onRetry={onRetry}
              rateLimitRemaining={rateLimits?.rateLimitRemaining}
              isLastMessage={index === messages.length - 1}
              renderWarning={renderWarning}
              // so we don't allow to repair parse errors which aren't the last message
              allowFixingParseError={
                message.errorType === "parse" && index === messages.length - 1
              }
            />
          ))
        )}
        <div ref={messagesEndRef} id="messages-end" />
      </div>

      <div className="chat-interface__input-container">
        <div className="chat-interface__input-outer">
          <div
            className="chat-interface__input-wrapper"
            style={{
              borderColor: isGenerating
                ? "var(--dialog-border-color)"
                : undefined,
            }}
          >
            <textarea
              ref={textareaRef}
              autoFocus
              className="chat-interface__input"
              value={currentPrompt}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isGenerating
                  ? t("chat.generating")
                  : rateLimits?.rateLimitRemaining === 0
                  ? t("chat.rateLimit.messageLimitInputPlaceholder")
                  : messages.length > 0
                  ? t("chat.inputPlaceholderWithMessages")
                  : t("chat.inputPlaceholder", { shortcut: "Shift + Enter" })
              }
              disabled={rateLimits?.rateLimitRemaining === 0}
              rows={1}
              cols={30}
              onInput={onInput}
            />
            <button
              className="chat-interface__send-button"
              onClick={handleSubmit}
              disabled={!canSend && !canStop}
              type="button"
            >
              <InlineIcon
                size="1.5em"
                icon={isGenerating ? StopIcon : ArrowRightIcon}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

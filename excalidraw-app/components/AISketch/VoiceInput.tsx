import { useEffect, useRef, useState } from "react";

import "./VoiceInput.scss";

/** languages the Zia Speech to Text model understands */
const LANGUAGES = [
  ["en", "English"],
  ["hi", "Hindi"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["nl", "Dutch"],
  ["ru", "Russian"],
  ["zh", "Mandarin"],
] as const;
const MAX_SECONDS = 60;
const SAMPLE_RATE = 16000;

/** Encodes mono 16-bit PCM as a WAV file. */
const toWav = (samples: Float32Array, rate: number) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) =>
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true),
  );
  return new Blob([buffer], { type: "audio/wav" });
};

/** Turns any recording the browser can decode into a 16 kHz mono WAV. */
const recordingToWav = async (blob: Blob) => {
  const decoded = await new AudioContext().decodeAudioData(
    await blob.arrayBuffer(),
  );
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * SAMPLE_RATE),
    SAMPLE_RATE,
  );
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return toWav(rendered.getChannelData(0), SAMPLE_RATE);
};

/**
 * Microphone button: records a spoken prompt and hands back the text
 * (Zia Speech to Text through /api/ai/transcribe).
 */
export const VoiceInput = ({ onText }: { onText: (text: string) => void }) => {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState<string>(() => {
    try {
      return localStorage.getItem("yatri-voice-language") || "en";
    } catch {
      return "en";
    }
  });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number>(0);

  useEffect(
    () => () => {
      window.clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const stop = () => recorderRef.current?.stop();

  const start = async () => {
    setError("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was blocked.");
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = async () => {
      window.clearInterval(timerRef.current);
      stream.getTracks().forEach((t) => t.stop());
      setState("working");
      try {
        const wav = await recordingToWav(
          new Blob(chunks, { type: recorder.mimeType }),
        );
        const form = new FormData();
        form.append("file", wav, "voice.wav");
        form.append("language", language);
        const response = await fetch("/api/ai/transcribe", {
          method: "POST",
          body: form,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Could not understand the recording.");
        }
        if (data.text?.trim()) {
          onText(data.text.trim());
        } else {
          setError("Nothing was heard. Try again, a little closer.");
        }
      } catch (err: any) {
        setError(err?.message || "Could not understand the recording.");
      }
      setState("idle");
    };
    recorderRef.current = recorder;
    recorder.start();
    setSeconds(0);
    setState("recording");
    timerRef.current = window.setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) {
          stop();
        }
        return s + 1;
      });
    }, 1000);
  };

  return (
    <div className="VoiceInput">
      <button
        type="button"
        className={`VoiceInput__mic VoiceInput__mic--${state}`}
        onClick={state === "recording" ? stop : start}
        disabled={state === "working"}
        title={
          state === "recording" ? "Stop and transcribe" : "Speak your prompt"
        }
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          {state === "recording" ? (
            <rect
              x="6"
              y="6"
              width="12"
              height="12"
              rx="2"
              fill="currentColor"
            />
          ) : (
            <path
              fill="currentColor"
              d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"
            />
          )}
        </svg>
        <span>
          {state === "recording"
            ? `Stop (${seconds}s)`
            : state === "working"
            ? "Listening..."
            : "Speak"}
        </span>
      </button>
      <select
        className="VoiceInput__language"
        aria-label="Spoken language"
        value={language}
        disabled={state !== "idle"}
        onChange={(event) => {
          setLanguage(event.target.value);
          try {
            localStorage.setItem("yatri-voice-language", event.target.value);
          } catch {}
        }}
      >
        {LANGUAGES.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
      {error && <span className="VoiceInput__error">{error}</span>}
    </div>
  );
};

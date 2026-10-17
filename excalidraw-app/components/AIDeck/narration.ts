/**
 * Narration for decks: speaker notes read aloud, optionally translated.
 *
 * Voices come from Zia Text to Speech (/api/ai/speech) when it works, so the
 * audio can also go into videos. Otherwise the browser's own voices read the
 * notes live; those cannot be recorded, so videos fall back to captions.
 */

export type NarrationLanguage = {
  code: string;
  label: string;
  /** Zia Text to Speech language */
  tts: string;
  /** browser speech language */
  bcp: string;
};

export const NARRATION_LANGUAGES: NarrationLanguage[] = [
  { code: "en", label: "English", tts: "en-us", bcp: "en-US" },
  { code: "hi", label: "Hindi", tts: "hi", bcp: "hi-IN" },
  { code: "es", label: "Spanish", tts: "es", bcp: "es-ES" },
  { code: "fr", label: "French", tts: "fr", bcp: "fr-FR" },
  { code: "de", label: "German", tts: "de", bcp: "de-DE" },
  { code: "it", label: "Italian", tts: "it", bcp: "it-IT" },
  { code: "pt", label: "Portuguese", tts: "pt-br", bcp: "pt-BR" },
  { code: "nl", label: "Dutch", tts: "nl", bcp: "nl-NL" },
  { code: "ja", label: "Japanese", tts: "ja", bcp: "ja-JP" },
];

/** "off", "same" (the slides' own language) or a NARRATION_LANGUAGES code */
export type NarrationChoice = string;

/** Hindi when the text is mostly Devanagari, else English. */
export const detectLanguage = (texts: string[]) => {
  const all = texts.join(" ");
  const devanagari = (all.match(/[ऀ-ॿ]/g) ?? []).length;
  return devanagari > all.length * 0.2 ? "hi" : "en";
};

export const languageOf = (code: string) =>
  NARRATION_LANGUAGES.find((l) => l.code === code) ?? NARRATION_LANGUAGES[0];

/** The notes in the chosen language; translated by Zia when it differs from the slides. */
export const narrationTexts = async (
  notes: string[],
  choice: NarrationChoice,
  signal?: AbortSignal,
): Promise<{ texts: string[]; language: NarrationLanguage }> => {
  const source = detectLanguage(notes);
  const target = choice === "same" ? source : choice;
  const language = languageOf(target);
  if (target === source) {
    return { texts: notes, language };
  }
  const indexes = notes
    .map((n, i) => (n.trim() ? i : -1))
    .filter((i) => i >= 0);
  const response = await fetch("/api/ai/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: indexes.map((i) => notes[i]),
      source,
      target,
    }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Could not translate the narration.");
  }
  const texts = [...notes];
  indexes.forEach((i, j) => {
    texts[i] = data.translations?.[j] || notes[i];
  });
  return { texts, language };
};

/** Zia voices, if Text to Speech is working; checked once per page. */
let ziaCheck: Promise<boolean> | null = null;
export const ziaVoiceAvailable = () =>
  (ziaCheck ??= fetch("/api/ai/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "Hi", language: "en-us" }),
  })
    .then(
      (r) => r.ok && (r.headers.get("content-type") || "").startsWith("audio"),
    )
    .catch(() => false));

/** Audio for one text from Zia Text to Speech. */
export const ziaSpeech = async (
  text: string,
  language: NarrationLanguage,
  voice = "f_heart",
  signal?: AbortSignal,
): Promise<ArrayBuffer> => {
  const response = await fetch("/api/ai/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: text,
      language: language.tts,
      voice,
      response_format: "mp3",
    }),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Text to speech failed.");
  }
  return response.arrayBuffer();
};

const browserVoice = (bcp: string) => {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const lang = bcp.toLowerCase();
  return (
    voices.find(
      (v) =>
        v.lang.toLowerCase() === lang &&
        /natural|premium|enhanced/i.test(v.name),
    ) ??
    voices.find((v) => v.lang.toLowerCase() === lang) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)))
  );
};

/** Reads texts aloud one at a time; `speak` resolves when the text has been read. */
export const createNarrator = async (language: NarrationLanguage) => {
  const zia = await ziaVoiceAvailable();
  let audio: HTMLAudioElement | null = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    audio?.pause();
    audio = null;
    window.speechSynthesis?.cancel();
  };
  const speak = async (text: string) => {
    stop();
    stopped = false;
    if (!text.trim()) {
      return;
    }
    if (zia) {
      const bytes = await ziaSpeech(text, language);
      if (stopped) {
        return;
      }
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "audio/mpeg" }),
      );
      audio = new Audio(url);
      await new Promise<void>((resolve) => {
        audio!.onended = () => resolve();
        audio!.onerror = () => resolve();
        audio!.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
      return;
    }
    if (!window.speechSynthesis) {
      return;
    }
    // long texts are read sentence by sentence; some browsers stop long utterances early
    const sentences = text.match(/[^.!?।]+[.!?।]*/g) ?? [text];
    for (const sentence of sentences) {
      if (stopped) {
        return;
      }
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(sentence.trim());
        utterance.lang = language.bcp;
        const voice = browserVoice(language.bcp);
        if (voice) {
          utterance.voice = voice;
        }
        utterance.rate = 1;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });
    }
  };
  return { kind: zia ? ("zia" as const) : ("browser" as const), speak, stop };
};

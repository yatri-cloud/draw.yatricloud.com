import { exportToCanvas } from "@excalidraw/excalidraw";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { ziaSpeech } from "./narration";

import type { NarrationLanguage } from "./narration";
import type { SceneSource } from "./exportDeck";

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
/** how many steps a slide is drawn in */
const MAX_STAGES = 8;
const FADE = 0.3;
const TRANSITION = 0.45;

export type VideoSlide = {
  frame: ExcalidrawFrameLikeElement;
  notes: string;
};

type Stage = HTMLCanvasElement;

/**
 * Splits a slide into drawing steps in reading order: the page and title
 * first, then the rest top to bottom, keeping grouped icons and labelled
 * shapes together.
 */
const drawingOrder = (
  frame: ExcalidrawFrameLikeElement,
  elements: readonly ExcalidrawElement[],
) => {
  const children = elements.filter(
    (el) => el.frameId === frame.id && !el.isDeleted,
  );
  const unitOf = (el: ExcalidrawElement) =>
    el.groupIds.at(-1) || (el.type === "text" && el.containerId) || el.id;
  const units = new Map<string, ExcalidrawElement[]>();
  for (const el of children) {
    const key = el.locked ? "__page" : unitOf(el);
    units.set(key, [...(units.get(key) ?? []), el]);
  }
  const page = units.get("__page") ?? [];
  units.delete("__page");
  const top = (els: ExcalidrawElement[]) => Math.min(...els.map((e) => e.y));
  const left = (els: ExcalidrawElement[]) => Math.min(...els.map((e) => e.x));
  const ordered = [...units.values()].sort((a, b) =>
    Math.abs(top(a) - top(b)) > 40 ? top(a) - top(b) : left(a) - left(b),
  );
  const stages = Math.max(1, Math.min(MAX_STAGES, ordered.length));
  const per = Math.ceil(ordered.length / stages);
  const steps: ExcalidrawElement[][] = [];
  for (let i = 0; i < ordered.length; i += per) {
    steps.push(ordered.slice(i, i + per).flat());
  }
  return { page, steps };
};

const renderStage = async (
  frame: ExcalidrawFrameLikeElement,
  elements: ExcalidrawElement[],
  scene: SceneSource,
): Promise<Stage> =>
  exportToCanvas({
    elements: [...elements, frame].filter(
      (el): el is NonDeletedExcalidrawElement => !el.isDeleted,
    ),
    appState: {
      exportBackground: true,
      viewBackgroundColor: "#ffffff",
      exportWithDarkMode: false,
      frameRendering: {
        enabled: true,
        name: false,
        outline: false,
        clip: true,
      },
    } as any,
    files: scene.files,
    exportingFrame: frame as NonDeleted<ExcalidrawFrameLikeElement>,
    exportPadding: 0,
    getDimensions: (width: number, height: number) => {
      const scale = WIDTH / width;
      return { width: width * scale, height: height * scale, scale };
    },
  });

/** Splits narration into caption lines with their share of the slide's time. */
const captionsFor = (text: string) => {
  const sentences = (text.match(/[^.!?।]+[.!?।]*/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const total = sentences.reduce((n, s) => n + s.length, 0) || 1;
  let acc = 0;
  return sentences.map((s) => {
    const start = acc / total;
    acc += s.length;
    return { text: s, start, end: acc / total };
  });
};

const drawCaption = (ctx: CanvasRenderingContext2D, text: string) => {
  ctx.font = "500 40px system-ui, -apple-system, 'Segoe UI', sans-serif";
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > WIDTH - 360 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) {
    lines.push(line);
  }
  const shown = lines.slice(-3);
  const boxH = shown.length * 54 + 36;
  const y = HEIGHT - boxH - 48;
  ctx.fillStyle = "rgba(17, 17, 17, 0.78)";
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(140, y, WIDTH - 280, boxH, 18);
  } else {
    ctx.rect(140, y, WIDTH - 280, boxH);
  }
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  shown.forEach((l, i) => ctx.fillText(l, WIDTH / 2, y + 20 + i * 54));
};

const pickMimeType = (withAudio: boolean) =>
  (withAudio
    ? [
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
      ]
    : [
        "video/mp4;codecs=avc1.42E01E",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
      ]
  ).find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";

/**
 * Records the slides as a video: each slide draws itself in, step by step,
 * while its narration plays (Zia voices) or its captions show.
 * Plays in real time, so the tab must stay visible while it records.
 */
export const recordDeckVideo = async (opts: {
  slides: VideoSlide[];
  scene: SceneSource;
  language: NarrationLanguage | null;
  /** narration audio from Zia; without it the video is silent with captions */
  withVoice: boolean;
  captions: boolean;
  signal: AbortSignal;
  onProgress: (message: string) => void;
}): Promise<{ blob: Blob; extension: "mp4" | "webm" }> => {
  const { slides, scene, signal, onProgress } = opts;

  // 1. drawing steps for every slide
  const staged: { stages: Stage[] }[] = [];
  for (const [i, slide] of slides.entries()) {
    onProgress(`Preparing slide ${i + 1} of ${slides.length}...`);
    const { page, steps } = drawingOrder(slide.frame, scene.elements);
    const stages: Stage[] = [await renderStage(slide.frame, page, scene)];
    let shown = [...page];
    for (const step of steps) {
      shown = [...shown, ...step];
      stages.push(await renderStage(slide.frame, shown, scene));
    }
    staged.push({ stages });
    if (signal.aborted) {
      throw new DOMException("cancelled", "AbortError");
    }
  }

  // 2. narration audio and timing
  const audioCtx = new AudioContext();
  const buffers: (AudioBuffer | null)[] = [];
  for (const [i, slide] of slides.entries()) {
    if (opts.withVoice && opts.language && slide.notes.trim()) {
      onProgress(
        `Recording the voice for slide ${i + 1} of ${slides.length}...`,
      );
      const bytes = await ziaSpeech(
        slide.notes,
        opts.language,
        undefined,
        signal,
      );
      buffers.push(await audioCtx.decodeAudioData(bytes));
    } else {
      buffers.push(null);
    }
  }
  const durations = slides.map((slide, i) => {
    const audio = buffers[i]?.duration;
    if (audio) {
      return audio + 1.2;
    }
    const words = slide.notes.split(/\s+/).filter(Boolean).length;
    return Math.min(30, Math.max(5, words / 2.6 + 2));
  });
  const starts = durations.map((_, i) =>
    durations.slice(0, i).reduce((a, b) => a + b, 0),
  );
  const total = starts.at(-1)! + durations.at(-1)!;

  // 3. play it all into a canvas and record. The audio clock drives the video
  // when narration plays; browsers keep audio paused without a recent click.
  const hasAudio = buffers.some(Boolean);
  if (hasAudio) {
    // resume() never settles while the browser blocks audio, so do not wait for long
    await Promise.race([
      audioCtx.resume().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    if (audioCtx.state !== "running") {
      throw new Error(
        "The browser blocked the narration audio. Click Video again to start the recording.",
      );
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  // frames are pushed explicitly after each draw; an off-screen canvas is not
  // repainted on its own, so automatic capture would miss frames
  const stream = canvas.captureStream(0);
  const videoTrack = stream.getVideoTracks()[0] as MediaStreamTrack & {
    requestFrame?: () => void;
  };
  const destination = audioCtx.createMediaStreamDestination();
  // a silent or paused audio track stalls the recorder, so add it only with narration
  if (hasAudio) {
    destination.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }
  const mimeType = pickMimeType(hasAudio);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 6_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) =>
    event.data.size && chunks.push(event.data);
  const finished = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const t0 = audioCtx.currentTime + 0.3;
  const perfStart = performance.now() + 300;
  const now = () =>
    hasAudio
      ? audioCtx.currentTime - t0
      : (performance.now() - perfStart) / 1000;
  buffers.forEach((buffer, i) => {
    if (buffer) {
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      source.start(t0 + starts[i] + 0.4);
    }
  });
  const captions = slides.map((s) => captionsFor(s.notes));
  const format = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const draw = (time: number) => {
    const i = Math.max(
      0,
      starts.findIndex(
        (start, j) => time >= start && time < start + durations[j],
      ),
    );
    const local = time - starts[i];
    const { stages } = staged[i];
    // the slide draws itself in over the first part of its time
    const reveal = Math.min(durations[i] * 0.55, (stages.length - 1) * 0.7);
    const step =
      reveal > 0 ? (local / reveal) * (stages.length - 1) : stages.length - 1;
    const current = Math.min(stages.length - 1, Math.floor(step));
    ctx.globalAlpha = 1;
    ctx.drawImage(stages[current], 0, 0, WIDTH, HEIGHT);
    if (current < stages.length - 1) {
      ctx.globalAlpha = Math.min(
        1,
        ((step - current) * reveal) / (stages.length - 1) / FADE,
      );
      ctx.drawImage(stages[current + 1], 0, 0, WIDTH, HEIGHT);
    }
    // crossfade from the previous slide
    if (i > 0 && local < TRANSITION) {
      const previous = staged[i - 1].stages;
      ctx.globalAlpha = 1 - local / TRANSITION;
      ctx.drawImage(previous[previous.length - 1], 0, 0, WIDTH, HEIGHT);
    }
    ctx.globalAlpha = 1;
    if (opts.captions) {
      const share = local / durations[i];
      const line = captions[i].find((c) => share >= c.start && share < c.end);
      if (line) {
        drawCaption(ctx, line.text);
      }
    }
    return i;
  };

  draw(0);
  recorder.start(1000);
  videoTrack.requestFrame?.();
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (signal.aborted) {
        reject(new DOMException("cancelled", "AbortError"));
        return;
      }
      const time = Math.max(0, now());
      if (time >= total) {
        draw(total - 0.001);
        resolve();
        return;
      }
      const i = draw(time);
      videoTrack.requestFrame?.();
      onProgress(
        `Recording slide ${i + 1} of ${slides.length} (${format(
          time,
        )} / ${format(total)}). Keep this tab open.`,
      );
      // timers keep running when the tab is hidden; animation frames do not
      setTimeout(tick, 1000 / FPS);
    };
    tick();
  }).finally(async () => {
    recorder.state !== "inactive" && recorder.stop();
    await finished;
    stream.getTracks().forEach((t) => t.stop());
    audioCtx.close();
  });

  return {
    blob: new Blob(chunks, { type: mimeType.split(";")[0] }),
    extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm",
  };
};

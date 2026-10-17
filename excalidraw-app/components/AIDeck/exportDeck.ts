import { exportToCanvas } from "@excalidraw/excalidraw";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

/** What a slide frame remembers about the AI deck it came from. */
export type DeckMeta = {
  id: string;
  index: number;
  title: string;
  layout: string;
  subtitle?: string;
  points?: string[];
  left?: { heading: string; points: string[] };
  right?: { heading: string; points: string[] };
  stat?: { value: string; label: string };
  quote?: { text: string; by?: string };
  notes?: string;
  /** the slide's text as plain lines (decks made after the layout update) */
  lines?: string[];
};

export type SlideImage = {
  frame: ExcalidrawFrameLikeElement;
  title: string;
  meta?: DeckMeta;
  /** PNG as a data URL */
  dataURL: string;
  png: Uint8Array;
};

export type SceneSource = {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  appState: Pick<AppState, "selectedElementIds">;
};

const EXPORT_WIDTH = 1920;

const metaOf = (el: ExcalidrawElement) =>
  (el.customData?.deck as DeckMeta | undefined) ?? undefined;

const leadingNumber = (name: string | null) => {
  const m = name?.match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
};

/**
 * The frames to export, in slide order: the selected frames, or else the
 * frames of the most recent AI deck, or else every frame on the canvas.
 */
export const collectSlideFrames = (scene: SceneSource) => {
  const frames = scene.elements.filter(
    (el): el is ExcalidrawFrameLikeElement =>
      (el.type === "frame" || el.type === "magicframe") && !el.isDeleted,
  );
  const selected = frames.filter(
    (f) => scene.appState.selectedElementIds[f.id],
  );
  let chosen: ExcalidrawFrameLikeElement[] = selected;
  if (!chosen.length) {
    const decks = frames.filter((f) => metaOf(f));
    const latest = decks.reduce<ExcalidrawFrameLikeElement | undefined>(
      (a, b) => (!a || b.updated > a.updated ? b : a),
      undefined,
    );
    chosen = latest
      ? decks.filter((f) => metaOf(f)!.id === metaOf(latest)!.id)
      : frames;
  }
  return [...chosen].sort((a, b) => {
    const ma = metaOf(a);
    const mb = metaOf(b);
    if (ma && mb && ma.id === mb.id) {
      return ma.index - mb.index;
    }
    const na = leadingNumber(a.name);
    const nb = leadingNumber(b.name);
    if (na !== null && nb !== null && na !== nb) {
      return na - nb;
    }
    // reading order: rows top to bottom, then left to right
    return Math.abs(a.y - b.y) > a.height / 2 ? a.y - b.y : a.x - b.x;
  });
};

const dataURLToBytes = (dataURL: string) => {
  const binary = atob(dataURL.slice(dataURL.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/** Renders each frame to a 1920 px wide PNG. */
export const renderSlideImages = async (
  scene: SceneSource,
  frames: readonly ExcalidrawFrameLikeElement[],
  onProgress?: (done: number, total: number) => void,
): Promise<SlideImage[]> => {
  const images: SlideImage[] = [];
  for (const frame of frames) {
    const canvas = await exportToCanvas({
      elements: scene.elements.filter(
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
        const scale = EXPORT_WIDTH / width;
        return { width: width * scale, height: height * scale, scale };
      },
    });
    const dataURL = canvas.toDataURL("image/png");
    const meta = metaOf(frame);
    images.push({
      frame,
      title:
        meta?.title ||
        frame.name?.replace(/^\s*\d+[.)]?\s*/, "") ||
        `Slide ${images.length + 1}`,
      meta,
      dataURL,
      png: dataURLToBytes(dataURL),
    });
    onProgress?.(images.length, frames.length);
  }
  return images;
};

export const fileSafe = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "deck";

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/** Plain-text lines that describe a slide, for notes, guides and Markdown. */
const slideText = (slide: SlideImage) => {
  const m = slide.meta;
  const lines: string[] = [];
  if (!m) {
    return lines;
  }
  if (Array.isArray(m.lines)) {
    return m.lines;
  }
  if (m.subtitle) {
    lines.push(m.subtitle);
  }
  for (const p of m.points ?? []) {
    lines.push(`- ${p}`);
  }
  if (m.left && m.right) {
    lines.push(`${m.left.heading}:`, ...m.left.points.map((p) => `- ${p}`));
    lines.push(`${m.right.heading}:`, ...m.right.points.map((p) => `- ${p}`));
  }
  if (m.stat) {
    lines.push(`${m.stat.value}: ${m.stat.label}`);
  }
  if (m.quote) {
    lines.push(`"${m.quote.text}"${m.quote.by ? ` (${m.quote.by})` : ""}`);
  }
  return lines;
};

// ─── Formats ─────────────────────────────────────────────────────────────────

export const exportPPTX = async (slides: SlideImage[], deckTitle: string) => {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = deckTitle;
  pptx.company = "Yatri Cloud";
  for (const slide of slides) {
    const s = pptx.addSlide();
    s.addImage({
      data: slide.dataURL,
      x: 0,
      y: 0,
      w: 10,
      h: 5.625,
      altText: slide.title,
    });
    const notes = [
      slide.title,
      ...slideText(slide),
      "",
      slide.meta?.notes ?? "",
    ]
      .join("\n")
      .trim();
    if (notes) {
      s.addNotes(notes);
    }
  }
  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  downloadBlob(blob, `${fileSafe(deckTitle)}.pptx`);
};

export const exportSlidesPDF = async (
  slides: SlideImage[],
  deckTitle: string,
) => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "px",
    format: [1920, 1080],
    hotfixes: ["px_scaling"],
    compress: true,
  });
  doc.setProperties({ title: deckTitle });
  slides.forEach((slide, i) => {
    if (i) {
      doc.addPage([1920, 1080], "landscape");
    }
    doc.addImage(slide.png, "PNG", 0, 0, 1920, 1080, undefined, "FAST");
  });
  downloadBlob(doc.output("blob"), `${fileSafe(deckTitle)}-slides.pdf`);
};

/** A4 handout: each slide with its key points and the speaker notes as prose. */
export const exportGuidePDF = async (
  slides: SlideImage[],
  deckTitle: string,
) => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  doc.setProperties({ title: deckTitle });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const width = pageW - margin * 2;
  const imageH = (width * 9) / 16;

  // cover
  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  const titleLines = doc.splitTextToSize(deckTitle, width);
  doc.text(titleLines, margin, pageH / 3);
  const subtitle = slides[0]?.meta?.subtitle;
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(15);
    doc.setTextColor(100);
    doc.text(
      doc.splitTextToSize(subtitle, width),
      margin,
      pageH / 3 + titleLines.length * 34 + 10,
    );
  }
  doc.setTextColor(0);
  if (slides[0]) {
    doc.addImage(
      slides[0].png,
      "PNG",
      margin,
      pageH / 2,
      width,
      imageH,
      undefined,
      "FAST",
    );
  }

  // contents
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Contents", margin, margin + 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  let y = margin + 52;
  slides.forEach((slide, i) => {
    if (y > pageH - margin) {
      doc.addPage();
      y = margin + 20;
    }
    doc.text(`${i + 1}.  ${slide.title}`, margin, y);
    y += 20;
  });

  // one section per slide; a new page when the next one does not fit
  doc.addPage();
  y = margin;
  slides.forEach((slide, i) => {
    doc.setFontSize(11);
    const points = slideText(slide).flatMap((l) =>
      doc.splitTextToSize(l, width),
    );
    const notes = slide.meta?.notes
      ? doc.splitTextToSize(slide.meta.notes, width)
      : [];
    const needed =
      30 + imageH + 16 + points.length * 15 + 10 + notes.length * 15 + 28;
    if (
      y + Math.min(needed, pageH - margin * 2) > pageH - margin &&
      y > margin
    ) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`${i + 1}. ${slide.title}`, margin, y + 16);
    y += 30;
    doc.addImage(slide.png, "PNG", margin, y, width, imageH, undefined, "FAST");
    doc.setDrawColor(220);
    doc.rect(margin, y, width, imageH);
    y += imageH + 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    for (const line of [...points, ...(notes.length ? [""] : []), ...notes]) {
      if (y > pageH - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y + 11);
      y += 15;
    }
    y += 28;
  });
  downloadBlob(doc.output("blob"), `${fileSafe(deckTitle)}-guide.pdf`);
};

export const deckMarkdown = (
  slides: SlideImage[],
  deckTitle: string,
  imageDir?: string,
) => {
  const out = [`# ${deckTitle}`, ""];
  if (slides[0]?.meta?.subtitle) {
    out.push(`_${slides[0].meta.subtitle}_`, "");
  }
  slides.forEach((slide, i) => {
    out.push(`## ${i + 1}. ${slide.title}`, "");
    if (imageDir) {
      out.push(
        `![${slide.title}](${imageDir}/${String(i + 1).padStart(2, "0")}.png)`,
        "",
      );
    }
    const text = slideText(slide);
    if (text.length) {
      out.push(...text, "");
    }
    if (slide.meta?.notes) {
      out.push(slide.meta.notes, "");
    }
  });
  return out.join("\n");
};

/** Slide PNGs plus a Markdown guide that links them, in one ZIP. */
export const exportImagesZip = async (
  slides: SlideImage[],
  deckTitle: string,
) => {
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {
    "guide.md": strToU8(deckMarkdown(slides, deckTitle, "slides")),
  };
  slides.forEach((slide, i) => {
    files[`slides/${String(i + 1).padStart(2, "0")}.png`] = slide.png;
  });
  const zip = zipSync(files, { level: 0 });
  downloadBlob(
    new Blob([zip], { type: "application/zip" }),
    `${fileSafe(deckTitle)}.zip`,
  );
};

export const exportMarkdown = (slides: SlideImage[], deckTitle: string) =>
  downloadBlob(
    new Blob([deckMarkdown(slides, deckTitle)], { type: "text/markdown" }),
    `${fileSafe(deckTitle)}.md`,
  );

const escapeHTML = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!),
  );

/**
 * One self-contained web page that presents the deck: arrows, space, F for
 * full screen, N for notes, and "Play narration", which reads each slide
 * aloud with the browser's voice and moves on by itself.
 */
export const exportHTML = (
  slides: SlideImage[],
  deckTitle: string,
  narration?: { texts: string[]; language: { bcp: string } },
) => {
  const notes = slides.map(
    (s, i) => narration?.texts[i] ?? s.meta?.notes ?? "",
  );
  const sections = slides
    .map(
      (slide, i) =>
        `<section${i ? "" : ' class="on"'}><img src="${
          slide.dataURL
        }" alt="${escapeHTML(slide.title)}"><aside>${escapeHTML(
          notes[i],
        )}</aside></section>`,
    )
    .join("\n");
  const html = `<!DOCTYPE html>
<html lang="${escapeHTML(
    narration?.language.bcp ?? "en",
  )}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(deckTitle)}</title>
<style>
html,body{margin:0;height:100%;background:#111;color:#eee;font:15px/1.5 system-ui,sans-serif;overflow:hidden}
section{display:none;position:absolute;inset:0;align-items:center;justify-content:center;flex-direction:column}
section.on{display:flex}
img{max-width:100vw;max-height:100vh;object-fit:contain;background:#fff;box-shadow:0 10px 40px rgba(0,0,0,.5)}
aside{display:none;position:fixed;left:0;right:0;bottom:0;padding:16px 24px;background:rgba(0,0,0,.82);max-height:30vh;overflow:auto}
body.notes aside{display:block}
nav{position:fixed;right:16px;bottom:12px;font-size:13px;opacity:.75;display:flex;gap:12px;align-items:center}
nav button{font:inherit;color:#111;background:#fff;border:0;border-radius:999px;padding:4px 12px;cursor:pointer}
</style></head><body>
${sections}
<nav><button id="play" type="button">Play narration</button><span><span id="n">1</span> / ${
    slides.length
  } &middot; arrows to move, N notes, F full screen</span></nav>
<script>
var s=document.querySelectorAll("section"),i=0,playing=false,lang=${JSON.stringify(
    narration?.language.bcp ?? "en-US",
  )};
function voice(){var v=speechSynthesis.getVoices(),l=lang.toLowerCase();return v.find(function(x){return x.lang.toLowerCase()===l})||v.find(function(x){return x.lang.toLowerCase().slice(0,2)===l.slice(0,2)})}
function speak(){speechSynthesis.cancel();if(!playing)return;var t=s[i].querySelector("aside").textContent.trim();var parts=t.match(/[^.!?\u0964]+[.!?\u0964]*/g)||[];var at=i;
(function next(k){if(!playing||at!==i)return;if(k>=parts.length){setTimeout(function(){if(playing&&at===i&&i<s.length-1){go(1)}else if(i===s.length-1){stop()}},800);return}var u=new SpeechSynthesisUtterance(parts[k].trim());u.lang=lang;var v=voice();if(v)u.voice=v;u.onend=function(){next(k+1)};u.onerror=function(){next(k+1)};speechSynthesis.speak(u)})(0)}
function stop(){playing=false;speechSynthesis.cancel();document.getElementById("play").textContent="Play narration"}
function go(d){s[i].classList.remove("on");i=Math.max(0,Math.min(s.length-1,i+d));s[i].classList.add("on");document.getElementById("n").textContent=i+1;speak()}
document.getElementById("play").addEventListener("click",function(e){e.stopPropagation();if(playing){stop()}else{playing=true;this.textContent="Stop narration";speak()}});
if(!window.speechSynthesis)document.getElementById("play").style.display="none";
addEventListener("keydown",function(e){if(["ArrowRight","ArrowDown"," ","PageDown"].includes(e.key))go(1);else if(["ArrowLeft","ArrowUp","PageUp"].includes(e.key))go(-1);else if(e.key==="n")document.body.classList.toggle("notes");else if(e.key==="f")document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();});
addEventListener("click",function(e){go(e.clientX<innerWidth/3?-1:1);});
</script></body></html>`;
  downloadBlob(
    new Blob([html], { type: "text/html" }),
    `${fileSafe(deckTitle)}.html`,
  );
};

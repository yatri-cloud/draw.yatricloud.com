import { useRef } from "react";

import "./ImageAttach.scss";

/** the vision model takes at most three images */
export const MAX_IMAGES = 3;
const MAX_SIDE = 1600;

/** Reads an image file and shrinks it to a JPEG data URL no larger than 1600 px. */
export const imageFileToDataURL = async (file: Blob): Promise<string> => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  // white behind transparent PNGs, so dark lines stay readable
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
};

/** Image files on the clipboard of a paste event. */
export const pastedImages = (event: React.ClipboardEvent) =>
  [...event.clipboardData.items]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);

/**
 * "Add image" button with thumbnails. Images can also be pasted into the
 * dialog's text box (see `pastedImages`).
 */
export const ImageAttach = ({
  images,
  onChange,
  label = "Add image",
  hint,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  label?: string;
  hint?: string;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const add = async (files: FileList | File[]) => {
    const room = MAX_IMAGES - images.length;
    const picked = [...files]
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, room);
    const urls = await Promise.all(picked.map(imageFileToDataURL));
    onChange([...images, ...urls]);
  };

  return (
    <div className="ImageAttach">
      {images.map((url, i) => (
        <div key={i} className="ImageAttach__thumb">
          <img src={url} alt={`Attachment ${i + 1}`} />
          <button
            type="button"
            aria-label="Remove image"
            onClick={() => onChange(images.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      {images.length < MAX_IMAGES && (
        <button
          type="button"
          className="ImageAttach__add"
          onClick={() => inputRef.current?.click()}
        >
          + {label}
        </button>
      )}
      {hint && <span className="ImageAttach__hint">{hint}</span>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) {
            add(event.target.files);
          }
          event.target.value = "";
        }}
      />
    </div>
  );
};

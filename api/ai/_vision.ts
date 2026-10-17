/**
 * Shared helper for the Yatri AI routes (not a route itself: files starting
 * with "_" are not deployed as functions).
 *
 * Asks the gateway's vision model to describe images in text, so the text
 * model behind the other routes can work from them. The gateway sends any
 * request that contains images to its vision model.
 */

/** the vision model takes at most three images per request */
export const MAX_IMAGES = 3;
/** a 1600 px JPEG is well under this; it keeps requests inside Vercel's body limit */
const MAX_IMAGE_LENGTH = 3_000_000;

/** Keeps only data: URLs of images, at most three. */
export const imageList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value])
    .filter(
      (v): v is string =>
        typeof v === "string" &&
        /^data:image\/(png|jpe?g|webp|gif);base64,/.test(v) &&
        v.length <= MAX_IMAGE_LENGTH,
    )
    .slice(0, MAX_IMAGES);

/**
 * Returns the vision model's answer about the images, or throws with a
 * readable message. `instruction` says what to describe.
 */
export const describeImages = async (
  images: string[],
  instruction: string,
  signal?: AbortSignal,
): Promise<string> => {
  const base = process.env.YATRI_AI_BASE;
  const key = process.env.YATRI_AI_API_KEY;
  if (!base || !key) {
    throw new Error("Yatri AI not configured on server");
  }
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instruction },
            ...images.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        },
      ],
    }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `status ${response.status}`;
    throw new Error(
      /no vision model/.test(message)
        ? "Image input needs the vision model on the AI gateway, which is not set up there yet."
        : `The AI could not read the image: ${message}`,
    );
  }
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw new Error("The AI could not read the image.");
  }
  return text.trim();
};

/** What to look for when an image shows a diagram, whiteboard or sketch. */
export const DIAGRAM_INSTRUCTION = `Describe the diagram, whiteboard or sketch in this image so it can be redrawn exactly. Plain text, no markdown fences.
- TITLE: the heading, if any.
- ITEMS: every box, shape, icon, person or product, one per line, with its exact label as written (keep the original spelling and language). Name real products or cloud services when you recognise their logo or name.
- GROUPS: containers or areas (for example a cloud, region, VPC, column or lane) and which items are inside each.
- LINKS: every arrow or line as "A -> B: label" (label only if one is written). Note dashed lines.
- NOTES: any other text or numbers, and charts with their values.
Do not invent anything that is not in the image.`;

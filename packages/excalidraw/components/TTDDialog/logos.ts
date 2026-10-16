import { randomId } from "@excalidraw/common";
import { convertToExcalidrawElements } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  FileId,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { BinaryFiles, DataURL } from "../../types";

// Brand logos are bundled (logos.json, Simple Icons). Official AWS, Azure and
// Google Cloud icons are static files under /cloud-icons, built from the vendor
// packages by scripts/build-cloud-icons.mjs. Sources and terms: LOGOS-ATTRIBUTION.md
// and public/cloud-icons/manifest.json.

export type LogoEntry = {
  title: string;
  aliases: string[];
  category: string;
  provider?: string;
  /** inline SVG (brand logos) */
  svg?: string;
  /** URL of the SVG (cloud icons, loaded when used) */
  url?: string;
  /** whether the title itself is a match name (false when aliases already hold the vetted names) */
  matchTitle?: boolean;
  /** brand named with an everyday word ("Elastic", "Express"): match only a label that is exactly the name */
  strict?: boolean;
};
export type LogoBundle = Record<string, LogoEntry>;

export type CloudIcon = {
  id: string;
  /** title */
  t: string;
  /** provider: aws | azure | gcp */
  p: string;
  /** category */
  c: string;
  /** kind: service | resource | group | category */
  k: string;
  /** search aliases (Icons panel) */
  a: string[];
  /** names the AI matches against diagram labels (stricter than aliases) */
  m?: string[];
};
export type CloudIconManifest = {
  sources: Record<string, { title: string; url: string; terms: string }>;
  icons: CloudIcon[];
};

export const CLOUD_ICONS_BASE = "/cloud-icons";
export const cloudIconUrl = (icon: Pick<CloudIcon, "id" | "p">) =>
  `${CLOUD_ICONS_BASE}/${icon.p}/${icon.id}.svg`;

let manifestPromise: Promise<CloudIconManifest> | null = null;
export const loadCloudIconManifest = () =>
  (manifestPromise ??= fetch(`${CLOUD_ICONS_BASE}/manifest.json`).then(
    (res) => {
      if (!res.ok) {
        throw new Error(`cloud icon manifest: HTTP ${res.status}`);
      }
      return res.json() as Promise<CloudIconManifest>;
    },
  )).catch((err) => {
    manifestPromise = null;
    throw err;
  });

/** Brand logos plus every cloud service icon (resources and groups stay in the Icons panel only). */
export const buildLogoBundle = (
  brands: LogoBundle,
  manifest?: CloudIconManifest | null,
): LogoBundle => {
  const bundle: LogoBundle = { ...brands };
  for (const icon of manifest?.icons ?? []) {
    // services, plus resources and groups that have curated names ("Elastic IP")
    if (icon.k === "service" || icon.m?.length) {
      bundle[icon.id] = {
        title: icon.t,
        aliases: icon.m ?? icon.a,
        matchTitle: false,
        category: icon.c,
        provider: icon.p,
        url: cloudIconUrl(icon),
      };
    }
  }
  return bundle;
};

let logosPromise: Promise<LogoBundle> | null = null;
export const loadLogos = () =>
  (logosPromise ??= Promise.all([
    import("./logos.json").then(
      (mod) => ((mod as any).default ?? mod).logos as LogoBundle,
    ),
    loadCloudIconManifest().catch(() => null),
  ]).then(([brands, manifest]) => buildLogoBundle(brands, manifest)));

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9.+#]+/g, " ")
    .trim();

type Matcher = { names: { name: string; id: string; strict: boolean }[] };
const matchers = new WeakMap<LogoBundle, Matcher>();

const getMatcher = (logos: LogoBundle) => {
  let matcher = matchers.get(logos);
  if (!matcher) {
    const names: Matcher["names"] = [];
    for (const [id, logo] of Object.entries(logos)) {
      for (const name of new Set([
        ...(logo.matchTitle === false ? [] : [logo.title]),
        ...logo.aliases,
      ])) {
        const normalized = normalize(name);
        if (normalized.length >= 2) {
          // brand short names ("go", "r") and everyday-word brands only match a
          // whole label; cloud short names (EC2, S3, AKS) match inside labels
          const strict =
            !logo.provider && (normalized.length <= 3 || !!logo.strict);
          names.push({ name: normalized, id, strict });
        }
      }
    }
    // longest names first so "aws lambda" wins over "aws"
    names.sort((a, b) => b.name.length - a.name.length);
    matcher = { names };
    matchers.set(logos, matcher);
  }
  return matcher;
};

/**
 * Finds the logo whose name or alias appears as whole words in the label.
 * Brand short names and everyday-word brands only match the whole label, so
 * "Go to checkout" and "Elastic IP" do not get the Go or Elastic logos, while
 * cloud names such as "EC2 Instance" or "S3 bucket" do get their icons.
 */
export const matchLogo = (label: string, logos: LogoBundle) => {
  const whole = normalize(label);
  if (whole.length < 2) {
    return undefined;
  }
  const text = ` ${whole} `;
  return getMatcher(logos).names.find(({ name, strict }) =>
    strict ? whole === name : text.includes(` ${name} `),
  )?.id;
};

export const svgToDataURL = (svg: string) =>
  `data:image/svg+xml;base64,${btoa(
    unescape(encodeURIComponent(svg)),
  )}` as DataURL;

const svgCache = new Map<string, Promise<string>>();
const fetchSvg = (url: string) => {
  let pending = svgCache.get(url);
  if (!pending) {
    pending = fetch(url).then((res) => {
      if (!res.ok) {
        throw new Error(`icon ${url}: HTTP ${res.status}`);
      }
      return res.text();
    });
    pending.catch(() => svgCache.delete(url));
    svgCache.set(url, pending);
  }
  return pending;
};

export const logoFileId = (id: string) => `logo-${id}` as FileId;

/** Image files for the given logos; logos that fail to load are skipped. */
export const logoFiles = async (
  ids: Iterable<string>,
  logos: LogoBundle,
): Promise<BinaryFiles> => {
  const files: BinaryFiles = {};
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const logo = logos[id];
      const svg =
        logo?.svg ??
        (logo?.url ? await fetchSvg(logo.url).catch(() => null) : null);
      if (svg) {
        files[logoFileId(id)] = {
          id: logoFileId(id),
          dataURL: svgToDataURL(svg),
          mimeType: "image/svg+xml",
          created: Date.now(),
        };
      }
    }),
  );
  return files;
};

/** An image element showing a logo; pair it with `logoFiles`. */
export const logoImage = (
  id: string,
  x: number,
  y: number,
  size: number,
  groupIds: string[] = [],
) =>
  convertToExcalidrawElements([
    {
      type: "image",
      fileId: logoFileId(id),
      x,
      y,
      width: size,
      height: size,
      groupIds,
    },
  ])[0];

const LOGO_SIZE = 40;

/**
 * Adds an official logo on the corner of every node whose label names a known
 * product or cloud service ("AWS Lambda", "PostgreSQL", "Kubernetes").
 * Returns the logo ids used; load their images with `logoFiles`.
 */
export const addLogosToDiagram = (
  elements: readonly NonDeletedExcalidrawElement[],
  logos: LogoBundle,
): { elements: NonDeletedExcalidrawElement[]; logoIds: string[] } => {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const shapes = elements.filter(
    (el) =>
      el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond",
  );
  // group frames (Mermaid subgraphs) contain other shapes; logos go on nodes only
  const isGroupFrame = (frame: NonDeletedExcalidrawElement) =>
    shapes.some(
      (other) =>
        other !== frame &&
        frame.x <= other.x &&
        frame.y <= other.y &&
        frame.x + frame.width >= other.x + other.width &&
        frame.y + frame.height >= other.y + other.height,
    );
  const logoIds: string[] = [];
  const added: NonDeletedExcalidrawElement[] = [];
  const grouped = new Map<string, string>(); // shape id -> new group id

  for (const text of elements) {
    if (text.type !== "text" || !text.containerId) {
      continue;
    }
    const shape = byId.get(text.containerId);
    if (
      !shape ||
      (shape.type !== "rectangle" &&
        shape.type !== "ellipse" &&
        shape.type !== "diamond") ||
      isGroupFrame(shape)
    ) {
      continue;
    }
    const id = matchLogo(text.text, logos);
    if (!id) {
      continue;
    }
    const groupId = randomId();
    grouped.set(shape.id, groupId);
    logoIds.push(id);
    added.push(
      logoImage(
        id,
        shape.x + shape.width - LOGO_SIZE * 0.7,
        shape.y + shape.height - LOGO_SIZE * 0.7,
        LOGO_SIZE,
        [groupId],
      ) as NonDeletedExcalidrawElement,
    );
  }

  if (!added.length) {
    return { elements: [...elements], logoIds };
  }
  const withGroups = elements.map((el) => {
    const groupId =
      grouped.get(el.id) ??
      (el.type === "text" && el.containerId
        ? grouped.get(el.containerId)
        : undefined);
    return groupId
      ? ({
          ...el,
          groupIds: [...el.groupIds, groupId],
        } as ExcalidrawElement as NonDeletedExcalidrawElement)
      : el;
  });
  return { elements: [...withGroups, ...added], logoIds };
};

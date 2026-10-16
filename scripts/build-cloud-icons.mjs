#!/usr/bin/env node
/**
 * Builds the cloud icon catalogue from the official vendor icon packages.
 *
 *   node scripts/build-cloud-icons.mjs
 *
 * Input (download from the vendors, keep the zips in icons/):
 *   icons/aws/Icon-package_*.zip          https://aws.amazon.com/architecture/icons/
 *   icons/azure/Azure_Public_Service_Icons_*.zip
 *                                         https://learn.microsoft.com/en-us/azure/architecture/icons/
 *   icons/gcp/core-products-icons.zip, category-icons.zip, google-cloud-legacy-icons.zip
 *                                         https://cloud.google.com/icons
 *
 * Output:
 *   public/cloud-icons/<provider>/<id>.svg   one sanitised SVG per icon
 *   public/cloud-icons/manifest.json         searchable index used by the Icons panel and the AI
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ALIASES } from "./cloud-icon-aliases.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "icons");
const OUT = path.join(ROOT, "public", "cloud-icons");
const MAX_SVG_BYTES = 60 * 1024;

const SOURCES = {
  aws: {
    title: "AWS Architecture Icons",
    url: "https://aws.amazon.com/architecture/icons/",
    terms:
      "AWS allows customers and partners to use these assets to create architecture diagrams.",
  },
  azure: {
    title: "Azure Architecture Icons",
    url: "https://learn.microsoft.com/en-us/azure/architecture/icons/",
    terms:
      "Microsoft permits use in architectural diagrams, training materials and documentation. Do not crop, flip, rotate or distort the icons; label them with the service name.",
  },
  gcp: {
    title: "Google Cloud icons",
    url: "https://cloud.google.com/icons",
    terms: "Official Google Cloud product icons for architecture diagrams.",
  },
};

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const words = (text) =>
  text.replace(/[_]+/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();

const titleCase = (text) =>
  text.replace(/\b([a-z])/g, (char) => char.toUpperCase());

/** Removes anything that is not plain vector drawing; returns null when unsafe. */
const sanitizeSvg = (raw) => {
  if (
    /<script|<foreignObject|\son[a-z]+\s*=|<iframe|<embed|<object/i.test(raw) ||
    /(?:xlink:)?href\s*=\s*["'](?!#)/i.test(raw) ||
    /url\(\s*["']?(?!#)/i.test(raw)
  ) {
    return null;
  }
  const svg = raw
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(title|desc|metadata)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!svg.startsWith("<svg") || !/viewBox=/i.test(svg)) {
    return null;
  }
  return Buffer.byteLength(svg) <= MAX_SVG_BYTES ? svg : null;
};

const extract = (zip) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-icons-"));
  execFileSync("unzip", ["-qq", "-o", zip, "-x", "__MACOSX/*", "-d", dir]);
  return dir;
};

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const findZips = (provider, pattern) => {
  const dir = path.join(SRC, provider);
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => pattern.test(name))
        .map((name) => path.join(dir, name))
    : [];
};

const icons = new Map();
const rejected = [];

const add = ({ id, title, provider, category, kind, file }) => {
  if (icons.has(id)) {
    return;
  }
  const svg = sanitizeSvg(fs.readFileSync(file, "utf8"));
  if (!svg) {
    rejected.push(path.basename(file));
    return;
  }
  const short = title.replace(
    /^(Amazon|AWS|Azure|Microsoft|Google Cloud|Google)\s+/i,
    "",
  );
  const aliases = new Set(
    [
      title,
      short.length > 3 ? short : null,
      provider === "azure" ? `azure ${short}` : null,
      provider === "gcp" ? `google cloud ${short}` : null,
      provider === "gcp" ? `gcp ${short}` : null,
      ...(ALIASES[id] ?? []),
    ]
      .filter(Boolean)
      .map((alias) => alias.toLowerCase()),
  );
  // Names the AI may match against diagram labels. Azure and Google Cloud use
  // plain words for many services ("Cache", "Monitor", "Cloud Storage"), so
  // only vendor-qualified names and curated short names count for them.
  const vendor = /\b(amazon|aws|azure|microsoft|google|gcp)\b/i;
  const curated = (ALIASES[id] ?? []).map((alias) => alias.toLowerCase());
  // resources and groups only take part in AI matching through curated aliases
  const match =
    kind !== "service"
      ? new Set(curated)
      : new Set([
          ...(vendor.test(title) || provider === "aws"
            ? [title.toLowerCase()]
            : []),
          // plain one-word short names ("Connect", "Glue", "Shield") are everyday
          // words; only distinctive ones (several words, CamelCase) match alone
          ...(provider === "aws" &&
          vendor.test(title) &&
          short.length > 3 &&
          (/\s/.test(short) || /[a-z][A-Z]|[A-Z]{2}/.test(short))
            ? [short.toLowerCase()]
            : []),
          ...(provider === "azure" ? [`azure ${short}`.toLowerCase()] : []),
          ...(provider === "gcp"
            ? [
                `google cloud ${short}`.toLowerCase(),
                `gcp ${short}`.toLowerCase(),
              ]
            : []),
          ...curated,
        ]);
  icons.set(id, {
    id,
    t: title,
    p: provider,
    c: category,
    k: kind,
    a: [...aliases].filter((alias) => alias !== title.toLowerCase()),
    m: [...match],
    svg,
  });
};

// ─── AWS ─────────────────────────────────────────────────────────────────────
for (const zip of findZips("aws", /^Icon-package.*\.zip$/)) {
  const dir = extract(zip);
  for (const file of walk(dir)) {
    const name = path.basename(file);
    let match;
    if ((match = /\/Arch_([^/]+)\/48\/Arch_(.+)_48\.svg$/.exec(file))) {
      const title = words(match[2]);
      add({
        id: `aws-${slug(match[2])}`,
        title,
        provider: "aws",
        category: words(match[1]),
        kind: "service",
        file,
      });
    } else if (
      (match =
        /\/Res_General-Icons\/Res_48_Light\/Res_(.+)_48_Light\.svg$/.exec(file))
    ) {
      // general icons (client, server, user, ...) sit one level deeper, in Light/Dark sets
      const title = words(match[1]);
      add({
        id: `aws-res-general-${slug(match[1])}`,
        title,
        provider: "aws",
        category: "General",
        kind: "resource",
        file,
      });
    } else if (
      (match = /\/Res_([^/]+)\/Res_(.+?)_48(?:_Light)?\.svg$/.exec(file)) &&
      !/_Dark\.svg$/.test(name) &&
      !/\/Res_48_(?:Light|Dark)\//.test(file)
    ) {
      // "Amazon-DynamoDB_Table" -> "Amazon DynamoDB: Table"
      const [service, ...parts] = match[2].split("_");
      const title = parts.length
        ? `${words(service)}: ${words(parts.join(" "))}`
        : words(service);
      add({
        id: `aws-res-${slug(match[2])}`,
        title,
        provider: "aws",
        category: words(match[1]),
        kind: "resource",
        file,
      });
    } else if (
      (match = /Architecture-Group-Icons[^/]*\/(.+)_32\.svg$/.exec(file)) &&
      !/_Dark/.test(name)
    ) {
      const title = words(match[1]);
      add({
        id: `aws-group-${slug(match[1])}`,
        title,
        provider: "aws",
        category: "Groups",
        kind: "group",
        file,
      });
    }
  }
}

// ─── Azure ───────────────────────────────────────────────────────────────────
for (const zip of findZips("azure", /^Azure_Public_Service_Icons.*\.zip$/)) {
  const dir = extract(zip);
  for (const file of walk(dir)) {
    const match = /\/Icons\/([^/]+)\/\d+-icon-service-(.+)\.svg$/.exec(file);
    if (match) {
      const title = words(match[2]);
      add({
        id: `azure-${slug(match[2])}`,
        title,
        provider: "azure",
        category: titleCase(match[1]),
        kind: "service",
        file,
      });
    }
  }
}

// ─── Google Cloud ────────────────────────────────────────────────────────────
// core products first so the current icon style wins over the legacy one
for (const [pattern, kind] of [
  [/^core-products-icons\.zip$/, "service"],
  [/^google-cloud-legacy-icons\.zip$/, "service"],
  [/^category-icons\.zip$/, "category"],
]) {
  for (const zip of findZips("gcp", pattern)) {
    const dir = extract(zip);
    for (const file of walk(dir)) {
      let match;
      if ((match = /\/Unique Icons\/([^/]+)\/SVG\/[^/]+\.svg$/.exec(file))) {
        add({
          id: `gcp-${slug(match[1])}`,
          title: match[1],
          provider: "gcp",
          category: "Products",
          kind,
          file,
        });
      } else if (
        (match = /\/Category Icons\/([^/]+)\/SVG\/[^/]+\.svg$/.exec(file))
      ) {
        const title = match[1].replace(/ _ /g, " & ");
        add({
          id: `gcp-category-${slug(title)}`,
          title,
          provider: "gcp",
          category: "Categories",
          kind,
          file,
        });
      } else if (
        kind === "service" &&
        (match = /\/([a-z0-9_]+)\/\1\.svg$/.exec(file))
      ) {
        const title = titleCase(words(match[1]))
          .replace(/\bApi\b/g, "API")
          .replace(/\bSql\b/g, "SQL")
          .replace(/\bCdn\b/g, "CDN")
          .replace(/\bIam\b/g, "IAM")
          .replace(/\bVpc\b/g, "VPC")
          .replace(/\bAi\b/g, "AI")
          .replace(/\bDns\b/g, "DNS")
          .replace(/\bGke\b/g, "GKE");
        add({
          id: `gcp-${slug(match[1])}`,
          title,
          provider: "gcp",
          category: "Products",
          kind,
          file,
        });
      }
    }
  }
}

// ─── Write ───────────────────────────────────────────────────────────────────
fs.rmSync(OUT, { recursive: true, force: true });
const counts = {};
for (const icon of icons.values()) {
  fs.mkdirSync(path.join(OUT, icon.p), { recursive: true });
  fs.writeFileSync(path.join(OUT, icon.p, `${icon.id}.svg`), icon.svg);
  counts[icon.p] = (counts[icon.p] ?? 0) + 1;
}
const manifest = {
  generated: "scripts/build-cloud-icons.mjs",
  sources: SOURCES,
  icons: [...icons.values()]
    .map(({ svg, ...rest }) => rest)
    .sort(
      (a, b) =>
        a.p.localeCompare(b.p) ||
        a.c.localeCompare(b.c) ||
        a.t.localeCompare(b.t),
    ),
};
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest));
console.log("icons per provider:", counts);
console.log(
  "rejected (unsafe or too large):",
  rejected.length,
  rejected.slice(0, 20),
);

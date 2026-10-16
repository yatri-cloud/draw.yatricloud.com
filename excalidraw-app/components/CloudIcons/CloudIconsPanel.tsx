import {
  convertToExcalidrawElements,
  FONT_FAMILY,
} from "@excalidraw/excalidraw";
import {
  useApp,
  useExcalidrawSetAppState,
} from "@excalidraw/excalidraw/components/App";
import {
  cloudIconUrl,
  loadCloudIconManifest,
  logoFiles,
  logoImage,
  svgToDataURL,
} from "@excalidraw/excalidraw/components/TTDDialog/logos";
import { randomId, viewportCoordsToSceneCoords } from "@excalidraw/common";
import { useEffect, useMemo, useState } from "react";

import type {
  CloudIcon,
  CloudIconManifest,
  LogoBundle,
} from "@excalidraw/excalidraw/components/TTDDialog/logos";

import "./CloudIconsPanel.scss";

export const CLOUD_ICONS_TAB = "cloud-icons";

type Provider = "aws" | "azure" | "gcp" | "brands";

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "aws", label: "AWS" },
  { id: "azure", label: "Azure" },
  { id: "gcp", label: "Google" },
  { id: "brands", label: "Brands" },
];

const KIND_LABEL: Record<string, string> = {
  service: "",
  resource: "Resources: ",
  group: "",
  category: "",
};

type Item = {
  id: string;
  title: string;
  section: string;
  search: string;
  /** lowercased title and aliases, for ranking search results */
  names: string[];
  /** 0 for main services, higher for resources, groups and categories */
  rank: number;
  src: string;
  /** inline SVG for brand logos; cloud icons are fetched from `src` */
  svg?: string;
};

const ICON_SIZE = 64;

/** Wraps long service names onto lines of at most `width` characters. */
const wrap = (text: string, width: number) => {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= width) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines.join("\n");
};

const SLOT = ICON_SIZE + 72;

/**
 * Viewport point for the next icon: the centre of the screen, then the next
 * free slot to the right, wrapping onto a new row before the sidebar, so
 * repeated inserts form a grid instead of a stack.
 */
const freeSpotNearCenter = (app: ReturnType<typeof useApp>) => {
  const { width, height, offsetLeft, offsetTop, zoom, scrollX, scrollY } =
    app.state;
  const center = viewportCoordsToSceneCoords(
    { clientX: width / 2 + offsetLeft, clientY: height / 2 + offsetTop },
    app.state,
  );
  // keep clear of the open sidebar on the right
  const rightEdge = viewportCoordsToSceneCoords(
    { clientX: width - 420 + offsetLeft, clientY: 0 },
    app.state,
  ).x;
  const elements = app.scene.getNonDeletedElements();
  const occupied = (x: number, y: number) =>
    elements.some(
      (el) =>
        el.x < x + SLOT / 2 &&
        el.x + el.width > x - SLOT / 2 &&
        el.y < y + SLOT / 2 &&
        el.y + el.height > y - SLOT / 2,
    );
  let x = center.x;
  let y = center.y;
  for (let step = 0; step < 200 && occupied(x, y); step++) {
    x += SLOT;
    if (x > rightEdge) {
      x = center.x;
      y += SLOT;
    }
  }
  return {
    clientX: (x + scrollX) * zoom.value + offsetLeft,
    clientY: (y + scrollY) * zoom.value + offsetTop,
  };
};

const cloudItem = (icon: CloudIcon): Item => ({
  id: icon.id,
  title: icon.t,
  section: `${KIND_LABEL[icon.k] ?? ""}${icon.c}`,
  search: [icon.t, icon.c, ...icon.a].join(" ").toLowerCase(),
  names: [icon.t, ...icon.a].map((name) => name.toLowerCase()),
  rank: icon.k === "service" ? 0 : 1,
  src: cloudIconUrl(icon),
});

/** Lower is better: exact name, then names starting with the query, then anything containing it. */
const score = (item: Item, query: string) => {
  const best = Math.min(
    ...item.names.map((name) =>
      name === query
        ? 0
        : name.startsWith(query) || name.endsWith(` ${query}`)
        ? 1
        : name.includes(query)
        ? 2
        : 3,
    ),
  );
  return best * 2 + item.rank;
};

export const CloudIconsPanel = () => {
  const app = useApp();
  const setAppState = useExcalidrawSetAppState();
  const [provider, setProvider] = useState<Provider>("aws");
  const [query, setQuery] = useState("");
  const [manifest, setManifest] = useState<CloudIconManifest | null>(null);
  const [brands, setBrands] = useState<LogoBundle | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCloudIconManifest()
      .then(setManifest)
      .catch(() => setError("Could not load the icon catalogue."));
    import("@excalidraw/excalidraw/components/TTDDialog/logos.json")
      .then((mod) => setBrands(((mod as any).default ?? mod).logos))
      .catch(() => setError("Could not load brand logos."));
  }, []);

  const items = useMemo<Item[]>(() => {
    if (provider === "brands") {
      return Object.entries(brands ?? {})
        .filter(([, logo]) => logo.svg)
        .map(([id, logo]) => ({
          id,
          title: logo.title,
          section: logo.category.replace(/^./, (c) => c.toUpperCase()),
          search: [logo.title, logo.category, ...logo.aliases]
            .join(" ")
            .toLowerCase(),
          names: [logo.title, ...logo.aliases].map((name) =>
            name.toLowerCase(),
          ),
          rank: 0,
          src: svgToDataURL(logo.svg!),
          svg: logo.svg,
        }))
        .sort(
          (a, b) =>
            a.section.localeCompare(b.section) ||
            a.title.localeCompare(b.title),
        );
    }
    const order = { service: 0, category: 1, resource: 2, group: 3 } as Record<
      string,
      number
    >;
    return (manifest?.icons ?? [])
      .filter((icon) => icon.p === provider)
      .sort(
        (a, b) =>
          (order[a.k] ?? 9) - (order[b.k] ?? 9) ||
          a.c.localeCompare(b.c) ||
          a.t.localeCompare(b.t),
      )
      .map(cloudItem);
  }, [provider, manifest, brands]);

  const sections = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = items.filter((item) =>
      words.every((word) => item.search.includes(word)),
    );
    const grouped = new Map<string, Item[]>();
    if (words.length) {
      // searching: one list, best matches first
      const phrase = words.join(" ");
      grouped.set(
        "Best matches",
        matches.sort(
          (a, b) =>
            score(a, phrase) - score(b, phrase) ||
            a.title.length - b.title.length,
        ),
      );
    } else {
      for (const item of matches) {
        grouped.set(item.section, [...(grouped.get(item.section) ?? []), item]);
      }
    }
    return { grouped, count: matches.length };
  }, [items, query]);

  const insert = async (item: Item) => {
    const bundle: LogoBundle = {
      [item.id]: item.svg
        ? { title: item.title, aliases: [], category: "", svg: item.svg }
        : { title: item.title, aliases: [], category: "", url: item.src },
    };
    const files = await logoFiles([item.id], bundle);
    if (!Object.keys(files).length) {
      setError(`Could not load the ${item.title} icon.`);
      return;
    }
    const groupId = randomId();
    const image = logoImage(item.id, 0, 0, ICON_SIZE, [groupId]);
    // the service name is shown under the icon (Azure's terms require the label)
    const [label] = convertToExcalidrawElements([
      {
        type: "text",
        x: 0,
        y: ICON_SIZE + 8,
        text: wrap(item.title, 24),
        fontSize: 16,
        fontFamily: FONT_FAMILY.Excalifont,
        textAlign: "center",
        groupIds: [groupId],
      },
    ]);
    app.addElementsFromPasteOrLibrary({
      elements: [image, { ...label, x: ICON_SIZE / 2 - label.width / 2 }],
      files,
      position: freeSpotNearCenter(app),
    });
    // inserting closes an undocked sidebar; keep the panel open for the next icon
    setAppState({ openSidebar: { name: "default", tab: CLOUD_ICONS_TAB } });
  };

  return (
    <div className="CloudIcons">
      <div className="CloudIcons__providers" role="tablist">
        {PROVIDERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={provider === id}
            className={`CloudIcons__provider${
              provider === id ? " CloudIcons__provider--active" : ""
            }`}
            onClick={() => setProvider(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        className="CloudIcons__search"
        type="search"
        placeholder="Search icons, e.g. S3, Lambda, AKS, BigQuery"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && <div className="CloudIcons__error">{error}</div>}
      <div className="CloudIcons__count">{sections.count} icons</div>
      <div className="CloudIcons__list">
        {[...sections.grouped].map(([section, sectionItems]) => (
          <section key={section} className="CloudIcons__section">
            <h4 className="CloudIcons__section-title">{section}</h4>
            <div className="CloudIcons__grid">
              {sectionItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="CloudIcons__item"
                  title={`Insert ${item.title}`}
                  onClick={() => insert(item)}
                >
                  <img src={item.src} alt="" loading="lazy" draggable={false} />
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {manifest && provider !== "brands" && (
        <a
          className="CloudIcons__source"
          href={manifest.sources[provider]?.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Official {manifest.sources[provider]?.title}
        </a>
      )}
    </div>
  );
};

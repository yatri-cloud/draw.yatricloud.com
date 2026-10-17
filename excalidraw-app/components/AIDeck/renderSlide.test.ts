import icons from "../AISketch/icons.json";

import {
  normalizePlan,
  normalizeSlide,
  renderSlide,
  SLIDE_H,
  SLIDE_W,
} from "./renderSlide";

import type { IconBundle } from "../AISketch/renderSketch";

const bundle = (icons as any).icons as IconBundle;

describe("AI deck", () => {
  it("plans a varied deck that opens with a title and ends with a summary", () => {
    const plan = normalizePlan(
      {
        title: "UPI",
        slides: [
          { layout: "points", title: "Intro" },
          { layout: "steps", title: "A" },
          { layout: "steps", title: "B" },
          { layout: "steps", title: "C" },
          { layout: "steps", title: "D" },
          { layout: "bogus", title: "E" },
          { layout: "stat", title: "End" },
        ],
      },
      10,
    );
    const layouts = plan.slides.map((s) => s.layout);
    expect(layouts[0]).toBe("title");
    expect(layouts.at(-1)).toBe("summary");
    // unknown layouts become points; no layout three times in a row
    expect(layouts[5]).not.toBe("bogus");
    for (let i = 2; i < layouts.length; i++) {
      expect(
        layouts[i] === layouts[i - 1] && layouts[i] === layouts[i - 2],
      ).toBe(false);
    }
  });

  it("falls back to points when a layout's own fields are missing", () => {
    const slide = normalizeSlide(
      { title: "Big number", notes: "It grew fast. Very fast." },
      { layout: "stat", title: "Big number" },
    );
    expect(slide.layout).toBe("points");
    expect(slide.points.map((p) => p.text)).toEqual([
      "It grew fast.",
      "Very fast.",
    ]);
  });

  it("draws a slide as a 16:9 frame holding all its elements, with notes", () => {
    const slide = normalizeSlide(
      {
        title: "Four laws of change",
        highlight: "Four laws",
        points: [
          { text: "Make it obvious", icon: "bell" },
          { text: "Make it easy", icon: "check" },
        ],
        notes: "Say this.",
      },
      { layout: "steps", title: "Four laws of change" },
    );
    const elements = renderSlide(slide, {
      index: 2,
      deckTitle: "Habits",
      deckId: "deck-1",
      icons: bundle,
      originX: 1000,
      originY: 500,
    });
    const frame = elements.find((el) => el.type === "frame")!;
    expect(frame).toMatchObject({
      x: 1000,
      y: 500,
      width: SLIDE_W,
      height: SLIDE_H,
      name: "03. Four laws of change",
    });
    expect(frame.customData?.deck).toMatchObject({
      id: "deck-1",
      index: 2,
      notes: "Say this.",
    });
    const children = elements.filter((el) => el !== frame);
    expect(children.length).toBeGreaterThan(10);
    for (const el of children) {
      expect(el.frameId).toBe(frame.id);
      expect(el.x).toBeGreaterThanOrEqual(1000 - 1);
      expect(el.x + el.width).toBeLessThanOrEqual(1000 + SLIDE_W + 1);
      expect(el.y).toBeGreaterThanOrEqual(500 - 1);
      expect(el.y + el.height).toBeLessThanOrEqual(500 + SLIDE_H + 1);
    }
  });
});

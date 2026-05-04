import { describe, expect, it } from "vitest";
import { PreviewGenerator } from "../src/domain/PreviewGenerator.js";

describe("PreviewGenerator", () => {
  it("produces a compact headline", () => {
    const generator = new PreviewGenerator();
    const summary = generator.buildSummary({
      threadID: "thread",
      changedFilesCount: 2,
      changedFileNames: ["A.swift"],
      testsPassed: 3,
      testsFailed: 0,
      screenshotURLs: [],
      summary:
        "This is a deliberately long summary that should be trimmed so the mobile home card stays clean and readable for quick supervision.",
      needsDesktopReview: false,
    });

    expect(summary.headline.endsWith("...")).toBe(true);
  });

  it("flags large or risky previews for desktop review", () => {
    const generator = new PreviewGenerator();
    expect(
      generator.needsDesktopReview({
        threadID: "thread",
        changedFilesCount: 14,
        changedFileNames: ["AppDelegate.swift"],
        testsPassed: 8,
        testsFailed: 0,
        screenshotURLs: [],
        summary: "Large diff",
        needsDesktopReview: false,
      }),
    ).toBe(true);
  });
});


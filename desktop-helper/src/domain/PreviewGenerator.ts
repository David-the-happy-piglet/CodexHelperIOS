import type { ArtifactPreview, PreviewSummary } from "@codex-companion/protocol";

export class PreviewGenerator {
  buildSummary(preview: ArtifactPreview): PreviewSummary {
    return {
      headline: this.headline(preview.summary),
      changedFilesCount: preview.changedFilesCount,
      testsPassed: preview.testsPassed,
      testsFailed: preview.testsFailed,
      needsDesktopReview: this.needsDesktopReview(preview),
    };
  }

  needsDesktopReview(preview: ArtifactPreview): boolean {
    return (
      preview.needsDesktopReview ||
      preview.testsFailed > 0 ||
      preview.changedFilesCount > 12 ||
      preview.changedFileNames.some((name) => name.endsWith(".pbxproj") || name.includes("migration"))
    );
  }

  private headline(summary: string): string {
    if (summary.length <= 88) {
      return summary;
    }

    return `${summary.slice(0, 85).trimEnd()}...`;
  }
}


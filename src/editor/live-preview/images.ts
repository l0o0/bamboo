import { parseMarkdownImages } from "../../modules/markdown/images/model";
import type { MarkdownImageReference } from "../../modules/markdown/images/model";

export interface LiveImageDecorationPlan {
  kind: "replace" | "inline";
  from: number;
  to: number;
  alt: string;
  source: string;
}

export function planLiveImageDecorations(
  line: string,
  active: boolean,
  images: MarkdownImageReference[] = parseMarkdownImages(line),
): LiveImageDecorationPlan[] {
  return images.map((image) => ({
    kind: active ? "inline" : "replace",
    from: active ? line.length : image.from,
    to: active ? line.length : image.to,
    alt: image.alt,
    source: image.source,
  }));
}

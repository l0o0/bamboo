import { parseMarkdownImages } from "../../modules/markdown/images/model";
import { parseInlineL2 } from "./inline";
import { planLiveImageDecorations } from "./images";
import {
  parseAtxHeading,
  parseBlockQuotePrefix,
  parseListPrefix,
} from "./structure";
import type {
  AtxHeadingParse,
  InlineRange,
  ListPrefixParse,
  PrefixParse,
} from "./types";

export interface CachedLineParse {
  heading: AtxHeadingParse | null;
  list: ListPrefixParse | null;
  quote: PrefixParse | null;
  inlines: InlineRange[];
  imagePlans: ReturnType<typeof planLiveImageDecorations>;
}

const cache = new Map<
  string,
  { active: CachedLineParse; inactive: CachedLineParse }
>();
const CACHE_LIMIT = 2500;

function parseLine(text: string, active: boolean): CachedLineParse {
  return {
    heading: parseAtxHeading(text),
    list: parseListPrefix(text),
    quote: parseBlockQuotePrefix(text),
    inlines: parseInlineL2(text),
    imagePlans: planLiveImageDecorations(text, active),
  };
}

export function cachedLineParse(
  text: string,
  active: boolean,
): CachedLineParse {
  let entry = cache.get(text);
  if (!entry) {
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    entry = {
      active: parseLine(text, true),
      inactive: parseLine(text, false),
    };
    cache.set(text, entry);
  }
  return active ? entry.active : entry.inactive;
}

export function lineImageRanges(text: string) {
  return parseMarkdownImages(text);
}

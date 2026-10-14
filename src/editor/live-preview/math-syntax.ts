export interface MathRange {
  from: number;
  to: number;
  content: string;
  display: boolean;
  delimiterLength: number;
}

function escaped(source: string, at: number): boolean {
  let slashes = 0;
  while (at > 0 && source[--at] === "\\") slashes++;
  return slashes % 2 === 1;
}

function nextPosition(positions: readonly number[], from: number): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (positions[middle] < from) low = middle + 1;
    else high = middle;
  }
  return positions[low] ?? -1;
}

function mathIndex(source: string) {
  const blockStarts = new Set<number>();
  const lineEnds = new Set<number>();
  const blankLines: number[] = [];
  let from = 0;
  for (const line of source.split("\n")) {
    const prefix = /^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?/.exec(
      line,
    )!;
    blockStarts.add(from + prefix[0].length);
    lineEnds.add(from + line.trimEnd().length);
    if (!line.trim()) blankLines.push(from);
    from += line.length + 1;
  }
  const dollars: number[] = [];
  const displayDollars: number[] = [];
  const brackets: number[] = [];
  const displayBrackets: number[] = [];
  const backticks = new Map<number, { end: number; close: number }>();
  const nextBacktick = new Map<number, number>();
  const tickRuns: Array<{ from: number; end: number }> = [];
  let slashes = 0;
  for (let index = 0; index < source.length; index++) {
    const ch = source[index];
    if (slashes % 2 === 0) {
      if (ch === "$") {
        // Whitespace on both sides may be skipped by the dollar tokenizer.
        // Keep other invalid closers as stop barriers, just like markdown-it.
        if (
          !/\s/.test(source[index - 1] || " ") ||
          !/\s/.test(source[index + 1] || " ")
        )
          dollars.push(index);
        if (source[index + 1] === "$" && lineEnds.has(index + 2))
          displayDollars.push(index);
      } else if (ch === "\\") {
        if (source[index + 1] === ")") brackets.push(index);
        if (source[index + 1] === "]" && lineEnds.has(index + 2))
          displayBrackets.push(index);
      } else if (ch === "`") {
        let end = index + 1;
        while (source[end] === "`") end++;
        tickRuns.push({ from: index, end });
        index = end - 1;
      }
    }
    slashes = ch === "\\" ? slashes + 1 : 0;
  }
  for (let index = tickRuns.length - 1; index >= 0; index--) {
    const run = tickRuns[index];
    const length = run.end - run.from;
    backticks.set(run.from, {
      end: run.end,
      close: nextBacktick.get(length) ?? -1,
    });
    nextBacktick.set(length, run.from);
  }
  return {
    blockStarts,
    blankLines,
    dollars,
    displayDollars,
    brackets,
    displayBrackets,
    backticks,
  };
}

/** TeX ranges outside code. Offsets remain source coordinates, never HTML. */
export function parseMathRanges(
  source: string,
  excluded: readonly { from: number; to: number }[] = [],
): MathRange[] {
  if (!source.includes("$") && !/\\[([]/.test(source)) return [];
  const ranges: MathRange[] = [];
  const index = mathIndex(source);
  const omitted = [...excluded].sort((a, b) => a.from - b.from);
  let omittedIndex = 0;
  let position = 0;
  while (position < source.length) {
    while (omitted[omittedIndex]?.to <= position) omittedIndex++;
    const omit = omitted[omittedIndex];
    if (omit && position >= omit.from) {
      position = omit.to;
      continue;
    }
    const code = index.backticks.get(position);
    if (code) {
      position = code.close < 0 ? code.end : code.close + code.end - position;
      continue;
    }
    const pair = source.slice(position, position + 2);
    if (source[position] !== "$" && pair !== "\\(" && pair !== "\\[") {
      position++;
      continue;
    }
    if (escaped(source, position)) {
      position++;
      continue;
    }
    const display = pair === "$$" || pair === "\\[";
    const brackets = pair === "\\(" || pair === "\\[";
    if (
      (display && !index.blockStarts.has(position)) ||
      (!display &&
        !brackets &&
        (/[\w$]/.test(source[position - 1] || " ") ||
          /\s/.test(source[position + 1] || " ")))
    ) {
      position++;
      continue;
    }
    const delimiterLength = display || brackets ? 2 : 1;
    const closers = brackets
      ? display
        ? index.displayBrackets
        : index.brackets
      : display
        ? index.displayDollars
        : index.dollars;
    const contentFrom = position + delimiterLength;
    const close = nextPosition(closers, contentFrom);
    if (
      close <= contentFrom ||
      (omit && close >= omit.from) ||
      (!display &&
        nextPosition(index.blankLines, contentFrom) >= 0 &&
        nextPosition(index.blankLines, contentFrom) < close) ||
      (!display &&
        !brackets &&
        (/[\w$]/.test(source[close + 1] || " ") ||
          /\s/.test(source[close - 1] || " ")))
    ) {
      position += delimiterLength;
      continue;
    }
    const to = close + delimiterLength;
    ranges.push({
      from: position,
      to,
      content: source.slice(contentFrom, close),
      display,
      delimiterLength,
    });
    position = to;
  }
  return ranges;
}

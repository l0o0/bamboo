/**
 * Zotero plugin code runs in a sandbox without browser DOM globals.
 * DOM libraries and the markdown editor expect `document` / `window` /
 * `HTMLElement` on the global object. Bridge them from a real chrome window.
 *
 * Prefer ztoolkit.getGlobal when available; fall back to the given window.
 */

const INJECTED_FLAG = "__zoteroMarkdownDOMGlobalsInjected";

/**
 * Ensure sandbox globals point at a real Zotero main window's DOM.
 * Safe to call multiple times; rebinds when the window changes.
 */
export function ensureDOMGlobals(win?: Window): Window {
  const target =
    win ||
    (ztoolkit.getGlobal("window") as Window | undefined) ||
    (Zotero.getMainWindow() as Window | undefined);

  if (!target?.document) {
    throw new Error("No Zotero window available for DOM globals");
  }

  const g = globalThis as any;
  const already = g[INJECTED_FLAG];
  // Re-bind if we never injected, or window object changed
  if (already === target) {
    return target;
  }

  g.window = target;
  g.self = target;
  g.document = target.document;

  // Constructors / APIs the editor and DOM code touch
  const fromWin = [
    "HTMLElement",
    "HTMLDivElement",
    "HTMLSpanElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "Element",
    "Node",
    "Text",
    "DocumentFragment",
    "DOMParser",
    "Range",
    "Selection",
    "NodeFilter",
    "MutationObserver",
    "ResizeObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getSelection",
    "CSS",
    "CSSStyleSheet",
    "CustomEvent",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "FocusEvent",
    "InputEvent",
  ] as const;

  for (const key of fromWin) {
    const value = (target as any)[key];
    if (typeof value !== "undefined") {
      g[key] = value;
    }
  }

  // Some code paths use globalThis === window checks
  try {
    if (typeof g.navigator === "undefined" && target.navigator) {
      g.navigator = target.navigator;
    }
  } catch {
    // ignore
  }

  g[INJECTED_FLAG] = target;
  ztoolkit.log("DOM globals injected from Zotero window");
  return target;
}

/**
 * Resolve a Document for UI construction (never use bare `document`).
 */
export function getDOMDocument(win?: Window): Document {
  const w = ensureDOMGlobals(win);
  return w.document;
}

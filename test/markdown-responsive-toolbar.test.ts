import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { Window } from "happy-dom";
import * as icons from "../src/modules/markdown/icons.ts";
import { tableInsertTemplate } from "../src/modules/markdown/insert-template.ts";
import { mountMoreMenu } from "../src/modules/markdown/tab.ts";
import { injectMarkdownStyles } from "../src/modules/markdown/styles.ts";
import {
  mountResponsiveToolbar,
  toolbarLayoutForWidth,
  type ToolbarCommand,
} from "../src/modules/markdown/responsive-toolbar.ts";

const source = ts.createSourceFile(
  "tab.ts",
  readFileSync(
    new URL("../src/modules/markdown/tab.ts", import.meta.url),
    "utf8",
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
let toolbarSource = "";
function visit(node: ts.Node) {
  if (
    ts.isObjectLiteralExpression(node) &&
    node.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(source) === "classList" &&
        ts.isArrayLiteralExpression(property.initializer) &&
        property.initializer.elements.some(
          (value) =>
            ts.isStringLiteral(value) &&
            value.text === "zotero-markdown-toolbar",
        ),
    )
  )
    toolbarSource = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
interface Spec {
  tag: string;
  classList?: string[];
  properties?: Record<string, unknown>;
  attributes?: Record<string, string>;
  children?: Spec[];
}
function fixture(initialWidth = 560, withMotion = false) {
  const win = new Window();
  const doc = win.document;
  const root = doc.createElement("main");
  root.className = "zotero-markdown-root mode-live";
  const workspace = doc.createElement("div");
  root.append(workspace);
  doc.body.append(root);
  let width = initialWidth;
  let composing = false;
  let closedOther = 0;
  let observerCallback = () => {};
  let disconnected = false;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const motionMedia = new (class extends win.EventTarget {
    matches = false;
  })();
  type Motion = {
    button: HTMLButtonElement;
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    visualX: number;
    visualY: number;
    cancelled: boolean;
    finished: Promise<void>;
    onfinish: (() => void) | null;
    oncancel: (() => void) | null;
    cancel(): void;
    finish(): void;
  };
  const motions: Motion[] = [];
  const buttonPrototype = win.HTMLButtonElement.prototype;
  const originalAnimate = Object.getOwnPropertyDescriptor(
    buttonPrototype,
    "animate",
  );
  const originalRect = Object.getOwnPropertyDescriptor(
    buttonPrototype,
    "getBoundingClientRect",
  );
  if (withMotion) {
    Object.defineProperty(win, "matchMedia", { value: () => motionMedia });
    Object.defineProperty(win.HTMLButtonElement.prototype, "animate", {
      configurable: true,
      value(
        this: HTMLButtonElement,
        keyframes: Keyframe[],
        options: KeyframeAnimationOptions,
      ) {
        const motion: Motion = {
          button: this,
          keyframes,
          options,
          visualX: 0,
          visualY: 0,
          cancelled: false,
          finished: Promise.resolve(),
          onfinish: null,
          oncancel: null,
          cancel() {
            this.cancelled = true;
            this.oncancel?.();
          },
          finish() {
            this.onfinish?.();
          },
        };
        motions.push(motion);
        return motion;
      },
    });
    // Supply a few representative control positions: persistent, entering,
    // leaving, and hidden through a wrapper. happy-dom has no layout engine;
    // the separate stylesheet tests cover which real controls each tier shows.
    Object.defineProperty(
      win.HTMLButtonElement.prototype,
      "getBoundingClientRect",
      {
        configurable: true,
        value(this: HTMLButtonElement) {
          const layout = root.querySelector<HTMLElement>(
            ".zotero-markdown-toolbar",
          )!.dataset.toolbarLayout!;
          const positions: Record<string, Record<string, number>> = {
            full: { bold: 80, image: 120, table: 160 },
            grouped: { bold: 40, heading: 80, insert: 120 },
            compact: { format: 40, insert: 80 },
          };
          const x =
            positions[layout][
              this.dataset.action || this.dataset.toolbarGroup || ""
            ];
          const motion = motions.findLast(
            (motion) => !motion.cancelled && motion.button === this,
          );
          return {
            width: x === undefined ? 0 : 32,
            height: x === undefined ? 0 : 32,
            left: (width - 320) / 2 + (x ?? 0) + (motion?.visualX ?? 0),
            top: 24 + (motion?.visualY ?? 0),
          };
        },
      },
    );
  }
  Object.defineProperty(workspace, "getBoundingClientRect", {
    value: () => ({
      width,
      height: 600,
      left: 0,
      right: width,
      top: 0,
      bottom: 600,
    }),
  });
  Object.defineProperty(root, "getBoundingClientRect", {
    value: () => ({
      width,
      height: 600,
      left: 0,
      right: width,
      top: 0,
      bottom: 600,
    }),
  });
  Object.defineProperty(win, "ResizeObserver", {
    value: class {
      constructor(callback: () => void) {
        observerCallback = callback;
      }
      observe(target: unknown) {
        assert.equal(target, workspace);
      }
      disconnect() {
        disconnected = true;
      }
    },
  });
  Object.defineProperty(win, "requestAnimationFrame", {
    value: (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
  });
  Object.defineProperty(win, "cancelAnimationFrame", {
    value: (id: number) => frames.delete(id),
  });
  const render = (spec: Spec) => {
    const el = doc.createElement(spec.tag);
    if (spec.classList) el.classList.add(...spec.classList);
    Object.assign(el, spec.properties);
    for (const [key, value] of Object.entries(spec.attributes || {}))
      el.setAttribute(key, value);
    for (const child of spec.children || []) el.append(render(child));
    return el;
  };
  const spec = runInNewContext(`(${toolbarSource})`, {
    ...icons,
    getString: (key: string) => key,
  }) as Spec;
  workspace.append(render(spec));
  const oldAddon = Object.getOwnPropertyDescriptor(globalThis, "addon");
  Object.defineProperty(globalThis, "addon", {
    configurable: true,
    value: { data: { config: { addonRef: "bamboo" } } },
  });
  injectMarkdownStyles(win as unknown as globalThis.Window);
  if (oldAddon) Object.defineProperty(globalThis, "addon", oldAddon);
  else Reflect.deleteProperty(globalThis, "addon");
  const commands: { command: ToolbarCommand; anchor: HTMLButtonElement }[] = [];
  let commandHandler:
    ((command: ToolbarCommand, anchor: HTMLButtonElement) => void) | undefined;
  const controller = mountResponsiveToolbar({
    root: root as unknown as HTMLElement,
    workspace: workspace as unknown as HTMLElement,
    labels: { heading: "标题", format: "文本格式", insert: "插入" },
    isComposing: () => composing,
    onCommand: (command, anchor) => {
      commands.push({ command, anchor });
      commandHandler?.(command, anchor);
    },
    closeOtherMenus: () => closedOther++,
  });
  const toolbar = root.querySelector<HTMLElement>(".zotero-markdown-toolbar")!;
  const menu = root.querySelector<HTMLElement>(
    ".zotero-markdown-toolbar-popover",
  )!;
  const trigger = (group: string) =>
    root.querySelector<HTMLButtonElement>(`[data-toolbar-group="${group}"]`)!;
  const key = (value: string) =>
    doc.activeElement?.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  const flush = () => {
    for (const [id, callback] of frames) {
      frames.delete(id);
      callback(0);
    }
  };
  return {
    win,
    doc,
    root,
    toolbar,
    menu,
    trigger,
    key,
    controller,
    commands,
    motions,
    motionMedia,
    set commandHandler(handler: typeof commandHandler) {
      commandHandler = handler;
    },
    frames,
    flush,
    get disconnected() {
      return disconnected;
    },
    get closedOther() {
      return closedOther;
    },
    set composing(value: boolean) {
      composing = value;
    },
    resize(value: number) {
      width = value;
      observerCallback();
    },
    async destroy() {
      controller.destroy();
      if (withMotion) {
        if (originalAnimate)
          Object.defineProperty(buttonPrototype, "animate", originalAnimate);
        else Reflect.deleteProperty(buttonPrototype, "animate");
        if (originalRect)
          Object.defineProperty(
            buttonPrototype,
            "getBoundingClientRect",
            originalRect,
          );
        else Reflect.deleteProperty(buttonPrototype, "getBoundingClientRect");
      }
      await win.happyDOM.close();
    },
  };
}

describe("responsive Markdown toolbar", () => {
  it("uses editor width and small expansion hysteresis", () => {
    assert.equal(toolbarLayoutForWidth(320), "compact");
    assert.equal(toolbarLayoutForWidth(540), "grouped");
    assert.equal(toolbarLayoutForWidth(700), "full");
    assert.equal(toolbarLayoutForWidth(547, "compact"), "compact");
    assert.equal(toolbarLayoutForWidth(548, "compact"), "grouped");
    assert.equal(toolbarLayoutForWidth(707, "grouped"), "grouped");
    assert.equal(toolbarLayoutForWidth(708, "grouped"), "full");
    assert.equal(toolbarLayoutForWidth(699, "full"), "grouped");
    assert.equal(toolbarLayoutForWidth(539, "grouped"), "compact");
  });
  it("animates only regrouping, keeping focus and floating menus out of the motion", async () => {
    const f = fixture(920, true);
    try {
      assert.equal(f.motions.length, 0, "initial layout is immediate");
      const editor = f.doc.createElement("textarea");
      f.root.append(editor);
      editor.focus();
      f.composing = true;
      f.resize(650);
      f.flush();
      assert.equal(f.doc.activeElement, editor);
      const bold = f.root.querySelector<HTMLButtonElement>(
        '[data-action="bold"]',
      )!;
      const moved = f.motions.find((motion) => motion.button === bold)!;
      assert.ok(moved);
      assert.equal(moved.options.duration, 160);
      const appeared = f.motions.find(
        (motion) => motion.button === f.trigger("heading"),
      )!;
      assert.equal(appeared.options.duration, 120);
      assert.equal(appeared.keyframes[0].opacity, "0");
      assert.equal(appeared.keyframes[1].opacity, "1");
      assert.ok(
        f.motions.every((motion) =>
          motion.button.matches("button.zotero-markdown-btn"),
        ),
      );
      assert.ok(
        f.motions.every(
          (motion) =>
            !motion.button.closest(
              ".zotero-markdown-table-picker, [role='menu']",
            ),
        ),
      );
      assert.ok(
        !f.motions.some((motion) => motion.button.dataset.action === "table"),
      );
      const count = f.motions.length;
      f.resize(680);
      f.flush();
      f.resize(707);
      f.flush();
      assert.equal(
        f.motions.length,
        count,
        "same tier and hysteresis do not replay motion",
      );
      for (const motion of f.motions) motion.finish();
      assert.ok(f.motions.every((motion) => motion.cancelled));
    } finally {
      await f.destroy();
    }
  });
  it("reverses from the current visual position and releases effects on teardown", async () => {
    const f = fixture(920, true);
    try {
      const bold = f.root.querySelector<HTMLButtonElement>(
        '[data-action="bold"]',
      )!;
      bold.style.transform = "translateY(0.5px)";
      f.resize(650);
      f.flush();
      const first = f.motions.find((motion) => motion.button === bold)!;
      first.visualX = 14;
      first.visualY = 0.25;
      f.resize(920);
      // Read the intermediate visual position at the new workspace width,
      // before the observer commits the next layout and replaces the effect.
      const previous = bold.getBoundingClientRect();
      f.flush();
      const second = f.motions.findLast((motion) => motion.button === bold)!;
      const resting = bold.getBoundingClientRect();
      assert.notEqual(first, second);
      assert.equal(first.cancelled, true);
      assert.equal(
        second.keyframes[0].transform,
        `translate(${previous.left - resting.left}px, ${previous.top - resting.top}px) translateY(0.5px)`,
      );
      assert.equal(second.keyframes[1].transform, "translateY(0.5px)");
      f.controller.destroy();
      assert.ok(f.motions.every((motion) => motion.cancelled));
      assert.equal(bold.style.transform, "translateY(0.5px)");
    } finally {
      await f.destroy();
    }
  });
  it("finishes active motion immediately when reduced motion is enabled", async () => {
    const f = fixture(920, true);
    try {
      f.resize(650);
      f.flush();
      assert.ok(f.motions.length > 0);
      f.motionMedia.matches = true;
      f.motionMedia.dispatchEvent(new f.win.Event("change"));
      assert.ok(f.motions.every((motion) => motion.cancelled));
      const count = f.motions.length;
      f.resize(400);
      f.flush();
      assert.equal(f.toolbar.dataset.toolbarLayout, "compact");
      assert.equal(f.motions.length, count);
      f.motionMedia.matches = false;
      f.motionMedia.dispatchEvent(new f.win.Event("change"));
      f.resize(920);
      f.flush();
      assert.ok(f.motions.length > count);
    } finally {
      await f.destroy();
    }
  });
  it("settles controls before opening anchored menus or changing editing availability", async () => {
    const f = fixture(920, true);
    try {
      f.resize(650);
      f.flush();
      f.root.addEventListener("click", () => {
        assert.ok(f.motions.every((motion) => motion.cancelled));
      });
      f.trigger("heading").click();
      assert.equal(f.menu.hidden, false);
      assert.ok(f.motions.every((motion) => motion.cancelled));
      f.resize(920);
      f.flush();
      assert.ok(f.motions.some((motion) => !motion.cancelled));
      f.controller.updateMode(true);
      assert.ok(f.motions.every((motion) => motion.cancelled));
      f.controller.updateMode(false);
      f.resize(650);
      f.flush();
      f.trigger("heading").focus();
      f.key("ArrowDown");
      assert.equal(f.menu.hidden, false);
      assert.ok(f.motions.every((motion) => motion.cancelled));
    } finally {
      await f.destroy();
    }
  });
  it("keeps the final layout when Web Animations is unavailable or rejects a call", async () => {
    const f = fixture(920, true);
    try {
      Object.defineProperty(f.win.HTMLButtonElement.prototype, "animate", {
        configurable: true,
        value: undefined,
      });
      f.resize(650);
      f.flush();
      assert.equal(f.toolbar.dataset.toolbarLayout, "grouped");
      Object.defineProperty(f.win.HTMLButtonElement.prototype, "animate", {
        configurable: true,
        value: () => {
          throw new Error("host animation unavailable");
        },
      });
      f.resize(400);
      f.flush();
      assert.equal(f.toolbar.dataset.toolbarLayout, "compact");
      assert.equal(f.motions.length, 0);
    } finally {
      await f.destroy();
    }
  });
  it("groups heading and insert commands without duplicating the original action buttons", async () => {
    const f = fixture();
    try {
      assert.equal(f.toolbar.dataset.toolbarLayout, "grouped");
      assert.equal(
        f.win.getComputedStyle(f.trigger("heading")).display,
        "inline-flex",
      );
      assert.equal(f.win.getComputedStyle(f.trigger("format")).display, "none");
      assert.equal(f.root.querySelectorAll('[data-action="table"]').length, 1);
      f.trigger("heading").click();
      assert.deepEqual(
        [...f.menu.querySelectorAll("button")].map(
          (b) => b.dataset.toolbarCommand,
        ),
        ["h1", "h2", "h3"],
      );
      f.menu
        .querySelector<HTMLButtonElement>('[data-toolbar-command="h2"]')!
        .click();
      assert.equal(f.commands.length, 1);
      assert.equal(f.commands[0].command, "h2");
      assert.equal(f.menu.hidden, true);
      f.trigger("insert").click();
      assert.deepEqual(
        [...f.menu.querySelectorAll("button")].map(
          (b) => b.dataset.toolbarCommand,
        ),
        ["image", "table", "task", "code"],
      );
      f.menu
        .querySelector<HTMLButtonElement>('[data-toolbar-command="table"]')!
        .click();
      assert.equal(f.commands[1].anchor, f.trigger("insert"));
      assert.equal(f.menu.hidden, true);
      assert.equal(
        f.win.getComputedStyle(f.commands[1].anchor).display,
        "inline-flex",
      );
    } finally {
      await f.destroy();
    }
  });
  it("retains the left directory and trailing controls in compact layout", async () => {
    const f = fixture(320);
    try {
      assert.equal(f.toolbar.dataset.toolbarLayout, "compact");
      assert.equal(
        f.win.getComputedStyle(f.root.querySelector('[data-action="save"]')!)
          .display,
        "none",
      );
      assert.equal(
        f.win.getComputedStyle(f.root.querySelector('[data-action="redo"]')!)
          .display,
        "none",
      );
      assert.notEqual(
        f.win.getComputedStyle(f.root.querySelector('[data-action="undo"]')!)
          .display,
        "none",
      );
      assert.equal(
        f.root
          .querySelector(".zotero-markdown-toolbar-inner")
          ?.firstElementChild?.getAttribute("data-action"),
        "outline-toggle",
      );
      assert.deepEqual(
        [
          ...f.root.querySelector(".zotero-markdown-toolbar-actions")!.children,
        ].map((b) => b.className),
        [
          "zotero-markdown-btn zotero-markdown-mode-toggle",
          "zotero-markdown-btn zotero-markdown-backlinks-toggle",
          "zotero-markdown-btn zotero-markdown-more",
        ],
      );
      f.trigger("format").click();
      assert.deepEqual(
        [...f.menu.querySelectorAll("button")].map(
          (b) => b.dataset.toolbarCommand,
        ),
        ["bold", "italic", "h1", "h2", "h3", "list", "link"],
      );
    } finally {
      await f.destroy();
    }
  });
  it("supports keyboard navigation, Escape focus return, and outside closure", async () => {
    const f = fixture();
    try {
      f.trigger("heading").focus();
      f.key("ArrowDown");
      assert.equal(
        f.doc.activeElement?.getAttribute("data-toolbar-command"),
        "h1",
      );
      f.key("End");
      assert.equal(
        f.doc.activeElement?.getAttribute("data-toolbar-command"),
        "h3",
      );
      f.key("ArrowDown");
      assert.equal(
        f.doc.activeElement?.getAttribute("data-toolbar-command"),
        "h1",
      );
      f.key("Escape");
      assert.equal(f.menu.hidden, true);
      assert.equal(f.doc.activeElement, f.trigger("heading"));
      f.trigger("insert").click();
      f.doc.body.dispatchEvent(
        new f.win.PointerEvent("pointerdown", { bubbles: true }),
      );
      assert.equal(f.menu.hidden, true);
      f.trigger("heading").click();
      const closed = f.closedOther;
      f.win.dispatchEvent(new f.win.Event("blur"));
      assert.equal(f.menu.hidden, true);
      assert.equal(f.closedOther, closed + 1);
    } finally {
      await f.destroy();
    }
  });
  it("coalesces resize and never steals editor focus, including during composition", async () => {
    const f = fixture(920);
    try {
      const editor = f.doc.createElement("textarea");
      f.root.append(editor);
      editor.focus();
      f.composing = true;
      f.resize(650);
      f.resize(530);
      f.resize(400);
      assert.equal(f.frames.size, 1);
      f.flush();
      assert.equal(f.toolbar.dataset.toolbarLayout, "compact");
      assert.equal(f.doc.activeElement, editor);
      f.resize(545);
      f.flush();
      assert.equal(f.toolbar.dataset.toolbarLayout, "compact");
      f.resize(560);
      f.flush();
      assert.equal(f.toolbar.dataset.toolbarLayout, "grouped");
      assert.equal(f.doc.activeElement, editor);
      f.composing = false;
      f.trigger("heading").click();
      f.resize(400);
      f.flush();
      assert.equal(f.menu.hidden, true);
      assert.equal(f.doc.activeElement, f.trigger("format"));
    } finally {
      await f.destroy();
    }
  });
  it("disables editing in reading mode and all writes for an uneditable attachment", async () => {
    const f = fixture();
    try {
      f.trigger("heading").click();
      f.controller.updateMode(true);
      assert.equal(f.menu.hidden, true);
      assert.equal(f.trigger("insert").disabled, true);
      assert.equal(
        f.root.querySelector<HTMLButtonElement>('[data-action="bold"]')!
          .disabled,
        true,
      );
      assert.equal(
        f.root.querySelector<HTMLButtonElement>('[data-action="save"]')!
          .disabled,
        false,
      );
      f.trigger("insert").click();
      assert.equal(f.menu.hidden, true);
      assert.equal(f.commands.length, 0);
      f.controller.updateMode(true, false);
      assert.equal(
        f.root.querySelector<HTMLButtonElement>('[data-action="save"]')!
          .disabled,
        true,
      );
      f.controller.updateMode(false);
      assert.equal(f.trigger("insert").disabled, false);
      assert.equal(
        f.root.querySelector<HTMLButtonElement>('[data-action="bold"]')!
          .disabled,
        false,
      );
    } finally {
      await f.destroy();
    }
  });
  it("closes floating menus when width changes within the same layout", async () => {
    const f = fixture(500);
    try {
      f.trigger("insert").click();
      const closed = f.closedOther;
      f.resize(400);
      f.flush();
      assert.equal(f.toolbar.dataset.toolbarLayout, "compact");
      assert.equal(f.menu.hidden, true);
      assert.equal(f.doc.activeElement, f.trigger("insert"));
      assert.equal(f.closedOther, closed + 1);
    } finally {
      await f.destroy();
    }
  });
  it("disconnects observation and cancels pending frames when the editor closes", async () => {
    const f = fixture();
    f.resize(400);
    assert.equal(f.frames.size, 1);
    f.controller.destroy();
    assert.equal(f.disconnected, true);
    assert.equal(f.frames.size, 0);
    f.resize(920);
    assert.equal(f.frames.size, 0);
    assert.equal(
      f.root.querySelector(".zotero-markdown-toolbar-popover"),
      null,
    );
    const closed = f.closedOther;
    f.win.dispatchEvent(new f.win.Event("blur"));
    assert.equal(f.closedOther, closed);
    await f.win.happyDOM.close();
  });
  it("opens the actual shared table picker from Insert and inserts the selected dimensions once", async () => {
    const f = fixture(400);
    const insertions: unknown[][] = [];
    const session: any = {
      mode: "live",
      view: { root: f.root, workspaceEl: f.root },
      editor: {
        isComposing: () => false,
        insertText: (...args: unknown[]) => insertions.push(args),
      },
    };
    const names = new Set([
      "isToolbarCommand",
      "executeToolbarCommand",
      "closeToolbarMoreMenu",
      "updateTablePickerSelection",
      "bindTablePicker",
      "toggleTablePicker",
    ]);
    const declarations = source.statements
      .filter(
        (node) =>
          ts.isFunctionDeclaration(node) &&
          node.name &&
          names.has(node.name.text),
      )
      .map((node) => node.getText(source))
      .join("\n");
    let delegate = "";
    function findDelegate(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "root.addEventListener" &&
        node.arguments[0]?.getText(source) === '"click"' &&
        node.arguments[1]?.getText(source).includes("data-table-rows")
      )
        delegate = node.arguments[1].getText(source);
      ts.forEachChild(node, findDelegate);
    }
    findDelegate(source);
    assert.ok(delegate, "exercise the real editor root click handler");
    const script = ts.transpileModule(
      `${declarations}\nroot.addEventListener("click", ${delegate}); bindTablePicker(session); executeToolbarCommand;`,
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.None,
        },
      },
    ).outputText;
    const execute = runInNewContext(script, {
      root: f.root,
      session,
      responsiveToolbars: new WeakMap([[session, f.controller]]),
      tablePickerAnchors: new WeakMap(),
      readOnlySessions: new WeakSet(),
      tableInsertTemplate,
    }) as (
      session: unknown,
      command: ToolbarCommand,
      anchor: HTMLButtonElement,
    ) => void;
    f.commandHandler = (command, anchor) => execute(session, command, anchor);
    try {
      const picker = f.root.querySelector<HTMLElement>(
        ".zotero-markdown-table-picker",
      )!;
      assert.equal(
        picker.parentElement?.className,
        "zotero-markdown-toolbar-inner",
      );
      assert.equal(
        f.win.getComputedStyle(
          f.root.querySelector(".zotero-markdown-table-control")!,
        ).display,
        "none",
      );
      f.trigger("insert").click();
      f.menu
        .querySelector<HTMLButtonElement>('[data-toolbar-command="table"]')!
        .click();
      assert.equal(picker.hidden, false);
      assert.notEqual(f.win.getComputedStyle(picker).display, "none");
      assert.equal(f.trigger("insert").getAttribute("aria-expanded"), "true");
      f.key("Escape");
      assert.equal(picker.hidden, true);
      assert.equal(f.doc.activeElement, f.trigger("insert"));
      f.trigger("insert").click();
      f.menu
        .querySelector<HTMLButtonElement>('[data-toolbar-command="table"]')!
        .click();
      picker
        .querySelector<HTMLButtonElement>(
          '[data-table-rows="2"][data-table-columns="4"]',
        )!
        .click();
      const expected = tableInsertTemplate(2, 4);
      assert.deepEqual(insertions, [
        [expected.text, expected.selectionFrom, expected.selectionTo],
      ]);
      assert.equal(picker.hidden, true);
      assert.equal(f.trigger("insert").getAttribute("aria-expanded"), "false");
    } finally {
      session.unbindTablePicker?.();
      await f.destroy();
    }
  });

  it("routes compact Save and Redo through the actual more-menu command handlers", async () => {
    const f = fixture(400);
    const saves: unknown[] = [];
    const commands: string[] = [];
    let composing = false;
    const session: any = {
      mode: "live",
      surface: "tab",
      view: { root: f.root },
      editor: {
        isComposing: () => composing,
        command: (command: string) => commands.push(command),
      },
      save: {
        request: async (options: unknown) => {
          saves.push(options);
        },
      },
    };
    mountMoreMenu(session);
    const save = f.root.querySelector<HTMLButtonElement>(
      '[data-menu-action="save"]',
    )!;
    const redo = f.root.querySelector<HTMLButtonElement>(
      '[data-menu-action="redo"]',
    )!;
    try {
      const menu = f.root.querySelector<HTMLElement>(
        ".zotero-markdown-more-menu",
      )!;
      menu.hidden = false;
      assert.notEqual(f.win.getComputedStyle(save).display, "none");
      save.click();
      await Promise.resolve();
      assert.deepEqual(saves, [{ force: true }]);
      menu.hidden = false;
      redo.click();
      assert.deepEqual(commands, ["redo"]);
      session.mode = "preview";
      menu.hidden = false;
      redo.click();
      assert.deepEqual(commands, ["redo"]);
      session.mode = "live";
      composing = true;
      menu.hidden = false;
      redo.click();
      assert.deepEqual(commands, ["redo"]);
      f.resize(920);
      f.flush();
      assert.equal(f.win.getComputedStyle(save).display, "none");
      assert.equal(f.win.getComputedStyle(redo).display, "none");
    } finally {
      session.closeMoreMenu?.();
      await f.destroy();
    }
  });
});

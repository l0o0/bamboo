import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createServer } from "../packages/whiteboard/node_modules/vite/dist/node/index.js";
import type { WhiteboardRuntime } from "../packages/whiteboard/src/whiteboard/app.tsx";

test("editing persists drafts atomically and keeps undo boundaries coherent", async () => {
  const window = new Window({ url: "https://example.test" });
  window.document.write(
    "<!doctype html><html><head></head><body></body></html>",
  );
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", {
    get: () => 1200,
  });
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
    get: () => 800,
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", {
    get: () => 1200,
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    get: () => 800,
  });
  const style = window.document.createElement("style");
  style.textContent =
    readFileSync("node_modules/@xyflow/react/dist/style.css", "utf8") +
    readFileSync("packages/whiteboard/src/whiteboard/board.css", "utf8");
  window.document.head.append(style);
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window,
    self: window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    FileReader: window.FileReader,
    ResizeObserver: window.ResizeObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const server = await createServer({
    root: "packages/whiteboard",
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
  });
  const container = window.document.createElement("div");
  container.style.cssText = "width:1200px;height:800px";
  window.document.body.append(container);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  const revisions: number[] = [];
  const notifiedContents: unknown[] = [];
  let runtime: WhiteboardRuntime | undefined;
  try {
    const app = (await server.ssrLoadModule("/src/whiteboard/app.tsx")) as {
      WhiteboardApp: typeof import("../packages/whiteboard/src/whiteboard/app.tsx").WhiteboardApp;
    };
    const noop = () => {};
    await act(async () => {
      root.render(
        createElement(app.WhiteboardApp, {
          theme: "light",
          initialSnapshot: {
            version: 2,
            nodes: [
              {
                id: "note",
                kind: "note",
                content: "Original",
                position: { x: 200, y: 200 },
                width: 240,
                height: 140,
              },
            ],
            connections: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
          onReady: (next: WhiteboardRuntime) => {
            runtime = next;
          },
          onChange: (revision: number) => {
            revisions.push(revision);
            notifiedContents.push(runtime?.getSnapshot().nodes[0]?.content);
          },
          onSave: noop,
          onPickAcademicSource: noop,
          onOpenItem: noop,
          onDropAcademicSources: noop,
          onRefreshZoteroNote: noop,
          onExportFile: noop,
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    assert.ok(runtime);
    const api = runtime;
    const card = container.querySelector<HTMLElement>('[data-id="note"]');
    assert.ok(card);
    const cardContent = card.querySelector<HTMLElement>(
      ".zmd-board-card-content",
    );
    assert.ok(cardContent);
    const doubleClick = async (target: HTMLElement) => {
      await act(async () => {
        target.dispatchEvent(
          new window.MouseEvent("dblclick", {
            bubbles: true,
            detail: 2,
            button: 0,
            clientX: 220,
            clientY: 220,
          }),
        );
      });
    };
    await doubleClick(cardContent);
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(textarea);

    const setText = async (value: string, target = textarea) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(target, value);
        target.dispatchEvent(new window.Event("input", { bubbles: true }));
        target.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
    };

    await setText("First draft");
    const firstRevision = revisions.at(-1);
    assert.ok(firstRevision !== undefined);
    assert.equal(api.getSnapshot().nodes[0]?.kind, "note");
    assert.equal(api.getSnapshot().nodes[0]?.content, "First draft");
    assert.equal(
      notifiedContents.at(-1),
      "First draft",
      "the change callback must already see the corresponding draft",
    );
    assert.equal(revisions.at(-1), firstRevision);

    await act(async () => api.setSaveState("saved"));
    const savedRevision = firstRevision;
    await setText("Saved then continued");
    assert.ok((revisions.at(-1) ?? 0) > savedRevision);
    assert.equal(api.getSnapshot().nodes[0]?.content, "Saved then continued");

    const beforeCancelRevision = revisions.at(-1)!;
    await act(async () => {
      textarea.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });
    assert.equal(container.querySelector("textarea"), null);
    assert.equal(api.getSnapshot().nodes[0]?.content, "Original");
    assert.equal(notifiedContents.at(-1), "Original");
    assert.ok((revisions.at(-1) ?? 0) > beforeCancelRevision);

    const reopened = container.querySelector<HTMLElement>('[data-id="note"]');
    assert.ok(reopened);
    const reopenedContent = reopened.querySelector<HTMLElement>(
      ".zmd-board-card-content",
    );
    assert.ok(reopenedContent);
    await doubleClick(reopenedContent);
    const committed = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(committed);
    await setText("Committed", committed);
    await act(async () => {
      committed.dispatchEvent(
        new window.FocusEvent("focusout", { bubbles: true }),
      );
    });
    assert.equal(container.querySelector("textarea"), null);
    assert.equal(api.getSnapshot().nodes[0]?.content, "Committed");
    await act(async () => api.undo());
    assert.equal(api.getSnapshot().nodes[0]?.content, "Original");
    const afterUndo = revisions.at(-1);
    await act(async () => api.undo());
    assert.equal(revisions.at(-1), afterUndo, "typing adds one undo step");
    await act(async () => api.redo());
    assert.equal(api.getSnapshot().nodes[0]?.content, "Committed");

    await doubleClick(
      container.querySelector<HTMLElement>(".zmd-board-card-content")!,
    );
    const imageEditor =
      container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => api.setEditable(false));
    assert.equal(imageEditor.readOnly, true);
    const readonlyRevision = revisions.at(-1);
    await setText("Blocked input", imageEditor);
    assert.equal(revisions.at(-1), readonlyRevision);
    assert.equal(api.getSnapshot().nodes[0]?.content, "Committed");
    await act(async () => api.setEditable(true));

    const file = new window.File(["image"], "paste.png", { type: "image/png" });
    const paste = new window.Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(paste, "clipboardData", {
      value: { items: [{ type: "image/png", getAsFile: () => file }] },
    });
    imageEditor.setSelectionRange(
      imageEditor.value.length,
      imageEditor.value.length,
    );
    const beforePaste = revisions.at(-1)!;
    await act(async () => imageEditor.dispatchEvent(paste));
    const deadline = Date.now() + 5000;
    while ((revisions.at(-1) ?? 0) === beforePaste) {
      assert.ok(
        Date.now() < deadline,
        "pasted image should notify a new draft",
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
    assert.match(
      String(api.getSnapshot().nodes[0]?.content),
      /!\[paste\.png\]\(data:image\/png;base64,/,
    );
    assert.equal(notifiedContents.at(-1), api.getSnapshot().nodes[0]?.content);
    await act(async () =>
      imageEditor.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    assert.equal(api.getSnapshot().nodes[0]?.content, "Committed");
    assert.equal(notifiedContents.at(-1), "Committed");
  } finally {
    await act(async () => root.unmount());
    await server.close();
    window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

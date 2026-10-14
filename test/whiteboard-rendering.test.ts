import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  useStoreApi,
  type NodeProps,
} from "@xyflow/react";
import { WhiteboardLabelsProvider } from "../packages/whiteboard/src/chrome/labels.tsx";
import { createAcademicNode } from "../packages/whiteboard/src/model/academic.ts";
import type { WhiteboardLabels } from "../packages/whiteboard/src/model/protocol.ts";
import { canvasNodeTypes } from "../packages/whiteboard/src/nodes/registry.ts";
import type { CanvasFlowNode } from "../packages/whiteboard/src/nodes/types.ts";
import {
  FullCanvasRenderContext,
  attachCanvasHandles,
  shouldCullCanvasNodes,
  waitForCanvasPaint,
} from "../packages/whiteboard/src/whiteboard/rendering.tsx";

function installDOM(t: TestContext, beforeClose?: () => Promise<void>) {
  const win = new Window({ url: "https://example.test" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: win,
    self: win,
    document: win.document,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    ResizeObserver: win.ResizeObserver,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  t.after(async () => {
    await beforeClose?.();
    win.close();
    for (const [key, value] of previous) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return win;
}

test("a 200-card, 300-edge canvas mounts visible cards and restores all cards for export", async (t) => {
  const win = installDOM(t, async () => {
    await act(async () => root.unmount());
  });
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host);
  const nodes: CanvasFlowNode[] = Array.from({ length: 200 }, (_, i) => {
    const model = createAcademicNode(
      "note",
      { x: (i % 20) * 360, y: Math.floor(i / 20) * 240 },
      `n${i}`,
    );
    return {
      id: model.id,
      type: "note",
      data: { model },
      position: model.position,
      width: model.width,
      height: model.height,
    };
  });
  const edges = Array.from({ length: 300 }, (_, i) => ({
    id: `e${i}`,
    source: `n${i % 200}`,
    target: `n${(i + 1 + Math.floor(i / 200)) % 200}`,
  }));
  const labels = new Proxy({} as WhiteboardLabels, {
    get: (_target, key) => String(key),
  });
  async function render(fullRender: boolean, editing = false) {
    await act(async () =>
      root.render(
        createElement(
          WhiteboardLabelsProvider,
          { value: labels },
          createElement(ReactFlow, {
            width: 800,
            height: 600,
            nodes: attachCanvasHandles(nodes),
            edges,
            nodeTypes: canvasNodeTypes,
            connectionMode: ConnectionMode.Loose,
            onlyRenderVisibleElements: shouldCullCanvasNodes(
              nodes.length,
              fullRender,
              editing,
            ),
          }),
        ),
      ),
    );
  }
  await render(false);
  const visible = host.querySelectorAll(".react-flow__node").length;
  assert.ok(
    visible > 0 && visible < 200,
    `expected a visible subset, mounted ${visible}`,
  );
  await render(true);
  assert.equal(host.querySelectorAll(".react-flow__node").length, 200);
  await render(false, true);
  assert.equal(host.querySelectorAll(".react-flow__node").length, 200);
  await render(false);
  assert.equal(host.querySelectorAll(".react-flow__node").length, visible);
  t.diagnostic(
    `200 cards / 300 edges; 800x600 viewport: ${visible} card DOMs during navigation, 200 for export`,
  );
});

test("zoomed-out notes use summaries; selection and export retain full Markdown", async (t) => {
  const win = installDOM(t, async () => {
    await act(async () => root.unmount());
  });
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host);
  const model = {
    ...createAcademicNode("note", { x: 0, y: 0 }, "long-note"),
    content:
      "# Heading\n\n**Detailed content**\n\n" + "- list entry\n".repeat(200),
  };
  const labels = new Proxy({} as WhiteboardLabels, {
    get: (_target, key) => String(key),
  });
  let store: ReturnType<typeof useStoreApi> | undefined;
  function CaptureStore() {
    const current = useStoreApi();
    useEffect(() => {
      store = current;
    }, [current]);
    return null;
  }
  async function render(selected = false, fullRender = false) {
    await act(async () =>
      root.render(
        createElement(
          WhiteboardLabelsProvider,
          { value: labels },
          createElement(
            FullCanvasRenderContext.Provider,
            { value: fullRender },
            createElement(
              ReactFlowProvider,
              null,
              createElement(CaptureStore),
              createElement(canvasNodeTypes.note, {
                id: model.id,
                type: "note",
                data: { model },
                selected,
                width: model.width,
                height: model.height,
                isConnectable: true,
              } as NodeProps<CanvasFlowNode>),
            ),
          ),
        ),
      ),
    );
  }
  await render();
  assert.equal(host.querySelectorAll("li").length, 200);
  await act(async () => store!.setState({ transform: [0, 0, 0.2] }));
  assert.equal(host.querySelectorAll("li").length, 0);
  assert.ok(host.querySelector(".zmd-board-card-summary"));
  assert.ok(host.textContent.includes("Heading"));
  assert.equal(host.querySelectorAll(".react-flow__handle").length, 4);
  await render(true);
  assert.equal(host.querySelectorAll("li").length, 200);
  await render(false, true);
  assert.equal(host.querySelectorAll("li").length, 200);
  await render();
  assert.equal(host.querySelectorAll("li").length, 0);
  await act(async () => store!.setState({ transform: [0, 0, 1] }));
  assert.equal(host.querySelectorAll("li").length, 200);
});

test("PNG preparation rejects a canvas closed before paint", async (t) => {
  const win = installDOM(t);
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const paint = waitForCanvasPaint(host as unknown as HTMLElement);
  host.remove();
  await assert.rejects(paint, /closed/);
});

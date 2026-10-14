import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { WhiteboardLabelsProvider } from "../packages/whiteboard/src/chrome/labels.tsx";
import { createBasicNode } from "../packages/whiteboard/src/model/basic.ts";
import type { CanvasNode } from "../packages/whiteboard/src/model/academic.ts";
import type { WhiteboardLabels } from "../packages/whiteboard/src/model/protocol.ts";
import {
  AttachmentNode,
  PdfNode,
} from "../packages/whiteboard/src/nodes/library.tsx";
import type { CanvasFlowNode } from "../packages/whiteboard/src/nodes/types.ts";
import { FullCanvasRenderContext } from "../packages/whiteboard/src/whiteboard/rendering.tsx";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ioAAAAASUVORK5CYII=";
const GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const svgData = (source: string) =>
  `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
const SVG = svgData(
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
);
const UNSAFE_SVG = svgData(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const PDF = `data:application/pdf;base64,${Buffer.from("%PDF-1.7 synthetic preview fixture").toString("base64")}`;
const labels = new Proxy({} as WhiteboardLabels, {
  get: (_target, property) => String(property),
});

type LibraryKind = "pdf" | "attachment";
type LibraryModel = Extract<CanvasNode, { kind: LibraryKind }>;
type RenderCard = {
  model: CanvasNode;
  selected?: boolean;
  width?: number;
  height?: number;
};

function imageModel(kind: LibraryKind, id = "preview-card"): LibraryModel {
  const model = createBasicNode(kind, { x: 0, y: 0 }, id);
  return {
    ...model,
    data: {
      ...model.data,
      title: "Pixel.png",
      contentType: "image/png",
      fileData: PNG,
    },
  };
}

function setup(t: TestContext, Component: typeof AttachmentNode) {
  const window = new Window({ url: "https://example.test" });
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const decode = globalThis.atob;
  const decodedInputs: string[] = [];
  const errors: unknown[] = [];
  for (const [key, value] of Object.entries({
    window,
    self: window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    getComputedStyle: window.getComputedStyle.bind(window),
    atob: (input: string) => {
      decodedInputs.push(input);
      return decode(input);
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container, {
    onUncaughtError: (error) => errors.push(error),
  });
  t.after(async () => {
    try {
      await act(async () => root.unmount());
    } finally {
      window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
  return {
    container,
    decodedInputs,
    async render(cards: RenderCard[], fullRender = false) {
      await act(async () => {
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
                ...cards.map(
                  ({
                    model,
                    selected = false,
                    width = model.width,
                    height = model.height,
                  }) =>
                    createElement(Component, {
                      key: model.id,
                      id: model.id,
                      type: model.kind,
                      data: { model },
                      selected,
                      width,
                      height,
                      isConnectable: true,
                    } as NodeProps<CanvasFlowNode>),
                ),
              ),
            ),
          ),
        );
      });
      assert.deepEqual(
        errors,
        [],
        "the mounted component must not report React errors",
      );
    },
    imageSource() {
      return container.querySelector("img")?.getAttribute("src");
    },
  };
}

for (const [kind, Component] of [
  ["pdf", PdfNode],
  ["attachment", AttachmentNode],
] as const) {
  test(`${kind} PNG capture switches to original bytes and restores thumbnail rendering`, async (t) => {
    const ui = setup(t, Component);
    const original = imageModel(kind);
    const model = { ...original, data: { ...original.data, image: GIF } };
    await ui.render([{ model }]);
    assert.equal(ui.imageSource(), GIF);
    assert.equal(
      ui.container.querySelector("img")?.getAttribute("loading"),
      "lazy",
    );
    await ui.render([{ model }], true);
    assert.equal(ui.imageSource(), PNG);
    assert.equal(
      ui.container.querySelector("img")?.getAttribute("loading"),
      "eager",
    );
    const validations = ui.decodedInputs.length;
    await ui.render([{ model, selected: true }], true);
    assert.equal(ui.decodedInputs.length, validations);
    await ui.render([{ model }]);
    assert.equal(ui.imageSource(), GIF);
  });

  test(`${kind} broken thumbnail falls back to the safe original without an error loop`, async (t) => {
    const ui = setup(t, Component);
    const original = imageModel(kind);
    const model = { ...original, data: { ...original.data, image: GIF } };
    await ui.render([{ model }]);
    const image = ui.container.querySelector("img")!;
    await act(async () => {
      image.dispatchEvent(new Event("error"));
    });
    assert.equal(ui.imageSource(), PNG);
    await act(async () => {
      image.dispatchEvent(new Event("error"));
    });
    assert.equal(ui.imageSource(), PNG);
  });

  test(`${kind} preview survives selection, size, title, and model identity changes without decoding again`, async (t) => {
    const ui = setup(t, Component);
    const model = imageModel(kind);
    await ui.render([{ model }]);
    assert.equal(ui.imageSource(), PNG);
    assert.equal(ui.decodedInputs.length, 1);

    await ui.render([{ model, selected: true }]);
    assert.ok(ui.container.querySelector(".is-selected"));
    await ui.render([{ model, selected: true, width: 480, height: 320 }]);
    const renamed = {
      ...model,
      position: { x: 50, y: 80 },
      width: 480,
      height: 320,
      data: { ...model.data, title: "Renamed pixel.png" },
    };
    await ui.render([{ model: renamed }]);
    await ui.render([{ model: structuredClone(renamed), selected: true }]);

    assert.equal(
      ui.container.querySelector("h3")?.textContent,
      "Renamed pixel.png",
    );
    assert.equal(ui.imageSource(), PNG);
    assert.equal(
      ui.decodedInputs.length,
      1,
      "unchanged preview strings reuse the mounted card's validation",
    );
  });

  test(`${kind} preview immediately validates changed fileData and image, including unsafe image fallback`, async (t) => {
    const ui = setup(t, Component);
    let model = imageModel(kind);
    await ui.render([{ model }]);
    assert.equal(ui.decodedInputs.length, 1);

    model = { ...model, data: { ...model.data, fileData: GIF } };
    await ui.render([{ model }]);
    assert.equal(ui.imageSource(), GIF);
    assert.equal(
      ui.decodedInputs.length,
      2,
      "replacement fileData is validated immediately",
    );

    model = { ...model, data: { ...model.data, image: SVG } };
    await ui.render([{ model }]);
    assert.equal(ui.imageSource(), SVG);
    assert.equal(
      ui.decodedInputs.length,
      3,
      "image takes precedence after its safety validation",
    );

    model = { ...model, data: { ...model.data, image: UNSAFE_SVG } };
    await ui.render([{ model }]);
    assert.equal(
      ui.imageSource(),
      GIF,
      "unsafe SVG cannot replace the safe fileData preview",
    );
    assert.equal(
      ui.decodedInputs.length,
      5,
      "changed unsafe image and safe fallback both get validated",
    );

    model = { ...model, data: { ...model.data, fileData: PNG } };
    await ui.render([{ model }]);
    assert.equal(ui.imageSource(), PNG);
    assert.equal(
      ui.decodedInputs.length,
      7,
      "fileData changes invalidate even when image is unchanged",
    );
    await ui.render([{ model: structuredClone(model), selected: true }]);
    assert.equal(ui.decodedInputs.length, 7);

    model = {
      ...model,
      data: { ...model.data, image: undefined, fileData: PDF },
    };
    await ui.render([{ model }]);
    assert.equal(
      ui.imageSource(),
      undefined,
      "a non-image replacement removes the stale image immediately",
    );
    assert.equal(
      ui.decodedInputs.length,
      7,
      "PDF replacement needs no binary decode",
    );
  });

  test(`${kind} component keeps hook order stable across wrong-kind and valid-kind transitions`, async (t) => {
    const ui = setup(t, Component);
    const model = imageModel(kind);
    const wrongKind = createBasicNode("text", { x: 0, y: 0 }, model.id);
    await ui.render([{ model: wrongKind }]);
    assert.equal(ui.container.querySelector("article"), null);
    assert.equal(ui.decodedInputs.length, 0);

    await ui.render([{ model }]);
    assert.equal(ui.imageSource(), PNG);
    assert.equal(ui.decodedInputs.length, 1);
    await ui.render([{ model: wrongKind }]);
    assert.equal(ui.container.querySelector("article"), null);
    await ui.render([{ model }]);
    assert.equal(ui.imageSource(), PNG);
    assert.equal(
      ui.decodedInputs.length,
      2,
      "returning to a valid kind recomputes the changed preview dependencies",
    );
  });

  test(`${kind} PDF fileData never decodes as an image during render or selection`, async (t) => {
    const ui = setup(t, Component);
    const base = imageModel(kind);
    const model = {
      ...base,
      data: {
        ...base.data,
        title: "Paper.pdf",
        contentType: "application/pdf",
        fileData: PDF,
      },
    };
    await ui.render([{ model }]);
    await ui.render([
      { model: structuredClone(model), selected: true, width: 360 },
    ]);
    assert.equal(ui.imageSource(), undefined);
    assert.equal(ui.container.querySelector("h3")?.textContent, "Paper.pdf");
    assert.equal(ui.decodedInputs.length, 0);
  });

  test(`${kind} preview validation is local to each mounted card`, async (t) => {
    const ui = setup(t, Component);
    const first = imageModel(kind, "first");
    const second = imageModel(kind, "second");
    await ui.render([{ model: first }, { model: second }]);
    assert.equal(ui.container.querySelectorAll("img").length, 2);
    assert.equal(
      ui.decodedInputs.length,
      2,
      "each instance validates its own preview on mount",
    );
    await ui.render([
      { model: structuredClone(first), selected: true },
      {
        model: {
          ...second,
          data: { ...second.data, title: "Second renamed.png" },
        },
      },
    ]);
    assert.equal(
      ui.decodedInputs.length,
      2,
      "both instances retain independent memoized results",
    );
  });
}

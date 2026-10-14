/**
 * iframe-side whiteboard: React + @xyflow/react.
 */
/// <reference lib="dom" />

import { normalizeColorScheme, type ColorSchemeID } from "./model/colorSchemes";

import { createRoot, type Root } from "react-dom/client";
import { WhiteboardApp, type WhiteboardRuntime } from "./whiteboard/app";
import {
  WHITEBOARD_MESSAGE_SOURCE,
  WHITEBOARD_PROTOCOL_VERSION,
  dispatchWhiteboardParentMessageEvent,
  type ParentToWhiteboardMessage,
  type WhiteboardToParentBody,
  type WhiteboardAppearance,
  type WhiteboardTheme,
} from "./model/protocol";
import { emptyCanvasDocument, type CanvasDocument } from "./model/document";
import type { NoteTemplate } from "./model/note-template";
import {
  createDeferredLabels,
  forwardAcademicParentMessage,
} from "./bootstrapState";

const channel = new URL(window.location.href).searchParams.get("channel") || "";

let colorScheme: ColorSchemeID = "traditional";
let theme: WhiteboardTheme = "light";
let appearance: WhiteboardAppearance = {
  fontFamily: "system",
  backgroundColor: "",
};
let pendingSnapshot: CanvasDocument | null = null;
let pendingTemplates: NoteTemplate[] = [];
let editable = true;
const deferredLabels = createDeferredLabels();
let runtime: WhiteboardRuntime | null = null;
let reactRoot: Root | null = null;
let rev = 0;

function onWindowKeyDown(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    postToParent({ type: "save" });
    return;
  }
  // Canvas history belongs to WhiteboardApp, which knows editing/modal state.
}

function postToParent(message: WhiteboardToParentBody) {
  window.parent?.postMessage(
    {
      source: WHITEBOARD_MESSAGE_SOURCE,
      channel,
      v: WHITEBOARD_PROTOCOL_VERSION,
      ...message,
    },
    "*",
  );
}

function applyDocumentTheme(next: WhiteboardTheme) {
  theme = next;
  document.documentElement.dataset.theme = next;
  applyDocumentAppearance(appearance);
}

function applyDocumentAppearance(next: WhiteboardAppearance) {
  appearance = next;
  document.body.style.background =
    next.backgroundColor || (theme === "dark" ? "#1a1d24" : "#fbfbfc");
}

function handleParentMessage(data: ParentToWhiteboardMessage) {
  if (forwardAcademicParentMessage(runtime, data)) return;
  switch (data.type) {
    case "init":
      editable = data.payload.editable ?? true;
      runtime?.setEditable(editable);
      applyDocumentTheme(data.payload.theme);
      applyDocumentAppearance(
        data.payload.appearance ?? {
          fontFamily: "system",
          backgroundColor: "",
        },
      );
      colorScheme = normalizeColorScheme(data.payload.colorScheme);
      runtime?.setColorScheme(colorScheme);
      pendingSnapshot = data.payload.snapshot ?? null;
      pendingTemplates = data.payload.templates ?? [];
      deferredLabels.receive(data.payload.labels);
      runtime?.setTheme(data.payload.theme);
      runtime?.setAppearance(appearance);
      runtime?.setTemplates(pendingTemplates);
      if (data.payload.snapshot) runtime?.loadSnapshot(data.payload.snapshot);
      break;
    case "setColorScheme":
      colorScheme = data.payload.colorScheme;
      runtime?.setColorScheme(colorScheme);
      break;
    case "setTheme":
      applyDocumentTheme(data.payload.theme);
      runtime?.setTheme(data.payload.theme);
      break;
    case "setAppearance":
      applyDocumentAppearance(data.payload.appearance);
      runtime?.setAppearance(appearance);
      break;
    case "loadSnapshot":
      pendingSnapshot = data.payload.snapshot;
      runtime?.loadSnapshot(data.payload.snapshot);
      break;
    case "requestSnapshot":
      postToParent({
        type: "snapshot",
        payload: {
          requestId: data.payload.requestId,
          rev,
          snapshot:
            runtime?.getSnapshot() ?? pendingSnapshot ?? emptyCanvasDocument(),
        },
      });
      break;
    case "command":
      if (data.payload.command === "undo") runtime?.undo();
      if (data.payload.command === "redo") runtime?.redo();
      break;
    case "saveState":
      runtime?.setSaveState(data.payload.state);
      break;
    case "noteTemplatesChanged":
      pendingTemplates = data.payload.templates;
      runtime?.setTemplates(pendingTemplates);
      break;
    case "focus":
      window.focus();
      document.getElementById("whiteboard-root")?.focus();
      break;
    case "destroy":
      runtime = null;
      deferredLabels.detach();
      reactRoot?.unmount();
      reactRoot = null;
      window.removeEventListener("message", onWindowMessage);
      window.removeEventListener("keydown", onWindowKeyDown);
      break;
    default:
      break;
  }
}

function onWindowMessage(event: MessageEvent) {
  try {
    dispatchWhiteboardParentMessageEvent(
      event,
      window.parent,
      channel,
      handleParentMessage,
    );
  } catch (error) {
    postToParent({
      type: "error",
      payload: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function boot() {
  const host = document.getElementById("whiteboard-root");
  if (!host) {
    postToParent({
      type: "error",
      payload: { message: "Missing #whiteboard-root" },
    });
    return;
  }
  applyDocumentTheme("light");
  window.addEventListener("message", onWindowMessage);
  window.addEventListener("keydown", onWindowKeyDown);
  reactRoot = createRoot(host);
  reactRoot.render(
    <WhiteboardApp
      theme={theme}
      editable={editable}
      colorScheme={colorScheme}
      appearance={appearance}
      labels={deferredLabels.current}
      initialSnapshot={pendingSnapshot ?? emptyCanvasDocument()}
      onReady={(next) => {
        runtime = next;
        next.setEditable(editable);
        deferredLabels.attach(next);
        if (pendingSnapshot) next.loadSnapshot(pendingSnapshot);
        next.setTheme(theme);
        next.setAppearance(appearance);
        next.setColorScheme(colorScheme);
        next.setTemplates(pendingTemplates);
      }}
      onChange={(nextRev) => {
        rev = nextRev;
        postToParent({ type: "change", payload: { rev } });
      }}
      onSave={() => postToParent({ type: "save" })}
      onOpenSettings={() => postToParent({ type: "openSettings" })}
      onSwitchWindow={() => postToParent({ type: "switchWindow" })}
      onSaveNoteTemplate={(template) =>
        postToParent({ type: "saveNoteTemplate", payload: { template } })
      }
      onDeleteNoteTemplate={(templateId) =>
        postToParent({ type: "deleteNoteTemplate", payload: { templateId } })
      }
      onPickAcademicSource={(requestId, nodeId, kind) =>
        postToParent({
          type: "pickAcademicSource",
          payload: { requestId, nodeId, kind },
        })
      }
      onOpenLink={(href) =>
        postToParent({ type: "openLink", payload: { href } })
      }
      onOpenFile={(payload) => postToParent({ type: "openFile", payload })}
      onOpenItem={(payload) => postToParent({ type: "openItem", payload })}
      onDropAcademicSources={(requestId, nodeId, sources) =>
        postToParent({
          type: "dropAcademicSources",
          payload: { requestId, nodeId, sources },
        })
      }
      onResolveAcademicSources={(requestId, generation, priority, sources) =>
        postToParent({
          type: "resolveAcademicSources",
          payload: { requestId, generation, priority, sources },
        })
      }
      onOpenAcademicSource={(requestId, nodeId, source) =>
        postToParent({
          type: "openAcademicSource",
          payload: { requestId, nodeId, source },
        })
      }
      onListLiteratureAnnotations={(requestId, source) =>
        postToParent({
          type: "listLiteratureAnnotations",
          payload: { requestId, source },
        })
      }
      onRefreshZoteroNote={(requestId, nodeId, source) =>
        postToParent({
          type: "refreshZoteroNote",
          payload: { requestId, nodeId, source },
        })
      }
      onExportFile={(payload) => postToParent({ type: "exportFile", payload })}
    />,
  );
  postToParent({ type: "ready" });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

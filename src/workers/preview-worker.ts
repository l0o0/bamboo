import {
  isPreviewWorkerRequest,
  type PreviewWorkerResponse,
} from "../modules/markdown/preview-worker-protocol";
import {
  documentTitleCore,
  renderMarkdownCore,
} from "../modules/markdown/preview-render-core";

declare const self: {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: PreviewWorkerResponse): void;
};

self.addEventListener("message", (event) => {
  if (!isPreviewWorkerRequest(event.data)) return;
  const { requestID, source, title } = event.data;
  try {
    self.postMessage({
      version: 1,
      requestID,
      ok: true,
      title: title || documentTitleCore(source),
      bodyHtml: renderMarkdownCore(source),
    });
  } catch (error) {
    self.postMessage({
      version: 1,
      requestID,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

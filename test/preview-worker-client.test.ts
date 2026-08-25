import assert from "node:assert/strict";
import test from "node:test";
import type { PreviewWorkerResponse } from "../src/modules/markdown/preview-worker-protocol.ts";
import { PreviewWorkerClient } from "../src/modules/markdown/preview-worker-client.ts";

type Listener = (event: { data?: unknown; error?: unknown }) => void;

class FakeWorker {
  terminated = false;
  private readonly listeners = new Map<string, Set<Listener>>();
  readonly messages: unknown[] = [];

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: PreviewWorkerResponse): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data: response });
    }
  }

  fail(error = new Error("worker failed")): void {
    for (const listener of this.listeners.get("error") ?? []) {
      listener({ error });
    }
  }
}

test("resolves concurrent requests by request ID", async () => {
  const worker = new FakeWorker();
  const client = new PreviewWorkerClient(() => worker, { timeoutMs: 100 });
  const first = client.render("# First");
  const second = client.render("# Second");
  worker.respond({
    version: 1,
    requestID: 2,
    ok: true,
    title: "Second",
    bodyHtml: "<h1>Second</h1>",
  });
  worker.respond({
    version: 1,
    requestID: 1,
    ok: true,
    title: "First",
    bodyHtml: "<h1>First</h1>",
  });
  assert.equal((await first).title, "First");
  assert.equal((await second).title, "Second");
});

test("times out pending work and recreates the worker", async () => {
  const workers = [new FakeWorker(), new FakeWorker()];
  const first = workers[0];
  const client = new PreviewWorkerClient(() => workers.shift()!, {
    timeoutMs: 5,
  });
  await assert.rejects(client.render("slow"), {
    code: "WORKER_RENDER_TIMEOUT",
  });
  assert.equal(first.terminated, true);
  const retry = client.render("retry");
  assert.equal(workers.length, 0);
  await assert.rejects(retry, { code: "WORKER_RENDER_TIMEOUT" });
});

test("dispose rejects every pending request", async () => {
  const worker = new FakeWorker();
  const client = new PreviewWorkerClient(() => worker, { timeoutMs: 100 });
  const pending = client.render("# Pending");
  client.dispose();
  await assert.rejects(pending, { code: "WORKER_DISPOSED" });
  assert.equal(worker.terminated, true);
});

test("worker errors reject pending work and ignore malformed responses", async () => {
  const worker = new FakeWorker();
  const client = new PreviewWorkerClient(() => worker, { timeoutMs: 100 });
  const pending = client.render("# Pending");
  worker.respond({
    version: 999,
    requestID: 1,
    ok: true,
    title: "",
    bodyHtml: "",
  } as never);
  worker.fail();
  await assert.rejects(pending, { code: "WORKER_RENDER_FAILED" });
  assert.equal(worker.terminated, true);
});

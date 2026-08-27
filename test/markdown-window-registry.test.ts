import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownWindowRegistry } from "../src/modules/markdown/window-registry";

type FakeWindow = { closed: boolean; focusCount: number; focus(): void };

function window(): FakeWindow {
  return {
    closed: false,
    focusCount: 0,
    focus() {
      this.focusCount++;
    },
  };
}

test("coalesces concurrent opens for one item", async () => {
  const registry = new MarkdownWindowRegistry<FakeWindow, { id: number }>();
  let creates = 0;
  let release!: () => void;
  const opening = new Promise<void>((resolve) => (release = resolve));
  const factory = async () => {
    creates++;
    await opening;
    return { window: window(), session: { id: 1 } };
  };

  const first = registry.open(1, factory);
  const second = registry.open(1, factory);
  release();
  assert.equal(await first, await second);
  assert.equal(creates, 1);
});

test("focuses an existing live window and permits different items", async () => {
  const registry = new MarkdownWindowRegistry<FakeWindow, { id: number }>();
  const first = await registry.open(1, async () => ({
    window: window(),
    session: { id: 1 },
  }));
  const second = await registry.open(2, async () => ({
    window: window(),
    session: { id: 2 },
  }));
  const repeated = await registry.open(1, async () => {
    throw new Error("must not recreate");
  });

  assert.equal(first, repeated);
  assert.equal(first.focusCount, 1);
  assert.notEqual(first, second);
  assert.equal(registry.size, 2);
});

test("releases an entry only after its asynchronous close completes", async () => {
  const registry = new MarkdownWindowRegistry<FakeWindow, { id: number }>();
  await registry.open(1, async () => ({
    window: window(),
    session: { id: 1 },
  }));
  let closed = false;
  const closing = registry.close(1, async () => {
    await Promise.resolve();
    closed = true;
  });
  assert.equal(registry.size, 1);
  await closing;
  assert.equal(closed, true);
  assert.equal(registry.size, 0);
});

test("keeps the live entry when closing fails", async () => {
  const registry = new MarkdownWindowRegistry<FakeWindow, { id: number }>();
  const value = await registry.open(1, async () => ({
    window: window(),
    session: { id: 1 },
  }));

  await assert.rejects(
    registry.close(1, async () => {
      throw new Error("save failed");
    }),
    /save failed/,
  );
  assert.equal(registry.size, 1);
  assert.equal(
    await registry.open(1, async () => {
      throw new Error("must not recreate");
    }),
    value,
  );
});

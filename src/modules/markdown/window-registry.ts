export interface WindowRegistryValue<TWindow, TSession> {
  window: TWindow;
  session: TSession;
}

interface WindowRegistryEntry<TWindow, TSession> {
  opening?: Promise<WindowRegistryValue<TWindow, TSession>>;
  value?: WindowRegistryValue<TWindow, TSession>;
  closing?: Promise<void>;
}

export class MarkdownWindowRegistry<
  TWindow extends { closed?: boolean; focus?: () => void },
  TSession,
> {
  private readonly entries = new Map<
    number,
    WindowRegistryEntry<TWindow, TSession>
  >();

  get size(): number {
    return this.entries.size;
  }

  get(itemID: number): WindowRegistryValue<TWindow, TSession> | undefined {
    const value = this.entries.get(itemID)?.value;
    if (value?.window.closed) {
      this.entries.delete(itemID);
      return undefined;
    }
    return value;
  }

  async open(
    itemID: number,
    factory: () => Promise<WindowRegistryValue<TWindow, TSession>>,
  ): Promise<TWindow> {
    const existing = this.entries.get(itemID);
    if (existing?.closing) await existing.closing;
    if (existing?.opening) return (await existing.opening).window;
    if (existing?.value && !existing.value.window.closed) {
      existing.value.window.focus?.();
      return existing.value.window;
    }

    const entry: WindowRegistryEntry<TWindow, TSession> = {};
    const opening = factory().then((value) => {
      entry.value = value;
      entry.opening = undefined;
      return value;
    });
    entry.opening = opening;
    this.entries.set(itemID, entry);
    try {
      return (await opening).window;
    } catch (error) {
      if (this.entries.get(itemID) === entry) this.entries.delete(itemID);
      throw error;
    }
  }

  async close(
    itemID: number,
    closer: (value: WindowRegistryValue<TWindow, TSession>) => Promise<void>,
  ): Promise<boolean> {
    const entry = this.entries.get(itemID);
    if (!entry) return false;
    if (entry.closing) {
      await entry.closing;
      return true;
    }
    if (entry.opening) entry.value = await entry.opening;
    if (!entry.value) {
      this.entries.delete(itemID);
      return false;
    }
    const closing = closer(entry.value).then(
      () => {
        if (this.entries.get(itemID) === entry) this.entries.delete(itemID);
      },
      (error) => {
        if (this.entries.get(itemID) === entry) entry.closing = undefined;
        throw error;
      },
    );
    entry.closing = closing;
    await closing;
    return true;
  }

  async closeAll(
    closer: (value: WindowRegistryValue<TWindow, TSession>) => Promise<void>,
  ): Promise<void> {
    await Promise.all(
      [...this.entries.keys()].map((id) => this.close(id, closer)),
    );
  }
}

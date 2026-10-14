/** Width belongs to the editor workspace, after both sidebars have taken space. */
export type ToolbarLayout = "full" | "grouped" | "compact";
export type ToolbarGroup = "heading" | "format" | "insert";
export type ToolbarCommand =
  | "save"
  | "undo"
  | "redo"
  | "bold"
  | "italic"
  | "h1"
  | "h2"
  | "h3"
  | "list"
  | "link"
  | "image"
  | "table"
  | "task"
  | "code";

const GROUP_COMMANDS: Record<ToolbarGroup, readonly ToolbarCommand[]> = {
  heading: ["h1", "h2", "h3"],
  format: ["bold", "italic", "h1", "h2", "h3", "list", "link"],
  insert: ["image", "table", "task", "code"],
};

/** Small hysteresis prevents repeated regrouping at fractional resize boundaries. */
export function toolbarLayoutForWidth(
  width: number,
  previous?: ToolbarLayout,
): ToolbarLayout {
  if (width < 540) return "compact";
  if (previous === "compact" && width < 548) return "compact";
  if (width < 700) return "grouped";
  if (previous && previous !== "full" && width < 708) return "grouped";
  return "full";
}

export interface ResponsiveToolbar {
  close(restoreFocus?: boolean): void;
  updateMode(readOnly: boolean, canSave?: boolean): void;
  destroy(): void;
}

export function mountResponsiveToolbar(options: {
  root: HTMLElement;
  workspace: HTMLElement;
  labels: Record<ToolbarGroup, string>;
  isComposing: () => boolean;
  onCommand: (command: ToolbarCommand, anchor: HTMLButtonElement) => void;
  closeOtherMenus: () => void;
}): ResponsiveToolbar {
  const { root, workspace, labels } = options;
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const toolbar = root.querySelector<HTMLElement>(".zotero-markdown-toolbar")!;
  const inner = toolbar.querySelector<HTMLElement>(
    ".zotero-markdown-toolbar-inner",
  )!;
  const format = inner.querySelector<HTMLElement>(".zotero-markdown-fmt")!;
  const originals = new Map<ToolbarCommand, HTMLButtonElement>();
  for (const button of inner.querySelectorAll<HTMLButtonElement>(
    "button[data-action]",
  )) {
    originals.set(button.dataset.action as ToolbarCommand, button);
  }
  const triggers = new Map<ToolbarGroup, HTMLButtonElement>();
  for (const group of ["format", "heading", "insert"] as const) {
    const trigger = doc.createElement("button");
    trigger.type = "button";
    trigger.className = "zotero-markdown-btn zotero-markdown-group-trigger";
    trigger.dataset.toolbarGroup = group;
    trigger.setAttribute("aria-label", labels[group]);
    trigger.title = labels[group];
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    const symbol = doc.createElement("span");
    symbol.className = "zotero-markdown-group-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent =
      group === "format" ? "Aa" : group === "heading" ? "H" : "+";
    trigger.append(symbol);
    const chevron = doc.createElement("span");
    chevron.className = "zotero-markdown-group-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "⌄";
    trigger.append(chevron);
    format.insertBefore(
      trigger,
      group === "format"
        ? format.firstChild
        : originals.get(group === "heading" ? "h1" : "image")!,
    );
    triggers.set(group, trigger);
  }
  // One reusable panel; the original editor buttons and their selection state stay put.
  const panel = doc.createElement("div");
  panel.className = "zotero-markdown-toolbar-popover";
  panel.setAttribute("role", "menu");
  panel.hidden = true;
  inner.append(panel);
  let activeTrigger: HTMLButtonElement | null = null;
  let layout: ToolbarLayout | undefined;
  let previousWidth: number | undefined;
  let readOnly = false;
  let frame: number | null = null;
  let destroyed = false;
  // Animate leaf controls only. Moving a format/actions wrapper as well would
  // double its children's displacement and could move a floating menu.
  const controls = [
    ...inner.querySelectorAll<HTMLButtonElement>("button.zotero-markdown-btn"),
  ];
  const animations = new Map<HTMLButtonElement, Animation>();
  const motionPreference = win.matchMedia?.("(prefers-reduced-motion: reduce)");
  const stopMotion = () => {
    for (const animation of animations.values()) {
      animation.onfinish = null;
      animation.oncancel = null;
      animation.cancel();
    }
    animations.clear();
  };
  const onMotionPreferenceChange = () => {
    if (motionPreference?.matches) stopMotion();
  };
  const captureControls = () => {
    const positions = new Map<
      HTMLButtonElement,
      { left: number; top: number; transform: string; opacity: string }
    >();
    for (const button of controls) {
      const rect = button.getBoundingClientRect();
      // Rectangles also account for hidden ancestors (e.g. the table control).
      if (!rect.width || !rect.height) continue;
      const style = win.getComputedStyle(button);
      positions.set(button, {
        left: rect.left,
        top: rect.top,
        transform: style?.transform || "none",
        opacity: style?.opacity || "1",
      });
    }
    return positions;
  };
  const animateControls = (before: ReturnType<typeof captureControls>) => {
    // Complete every geometry read before starting compositor-only animations.
    const after = captureControls();
    for (const [button, resting] of after) {
      if (typeof button.animate !== "function") continue;
      const previous = before.get(button);
      const x = previous ? previous.left - resting.left : 0;
      const y = previous ? previous.top - resting.top : 3;
      const opacity = previous?.opacity ?? "0";
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && opacity === resting.opacity)
        continue;
      try {
        const animation = button.animate(
          [
            {
              transform: `translate(${x}px, ${y}px)${resting.transform === "none" ? "" : ` ${resting.transform}`}`,
              opacity,
            },
            { transform: resting.transform, opacity: resting.opacity },
          ],
          {
            duration: previous ? 160 : 120,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
            fill: "both",
          },
        );
        void animation.finished.catch(() => {});
        animations.set(button, animation);
        const complete = () => {
          if (animations.get(button) !== animation) return;
          animations.delete(button);
          animation.onfinish = null;
          animation.oncancel = null;
          animation.cancel();
        };
        animation.onfinish = complete;
        animation.oncancel = complete;
      } catch {
        // A host without usable Web Animations still receives the final layout.
      }
    }
  };

  const close = (restoreFocus = false) => {
    const trigger = activeTrigger;
    panel.hidden = true;
    activeTrigger = null;
    trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus && trigger?.isConnected && !options.isComposing())
      trigger.focus();
  };
  const open = (group: ToolbarGroup) => {
    const trigger = triggers.get(group)!;
    if (readOnly || trigger.disabled) return;
    if (activeTrigger === trigger) return close(true);
    close();
    options.closeOtherMenus();
    activeTrigger = trigger;
    panel.replaceChildren();
    panel.setAttribute("aria-label", labels[group]);
    for (const command of GROUP_COMMANDS[group]) {
      const source = originals.get(command)!;
      const entry = doc.createElement("button");
      entry.type = "button";
      entry.className = "zotero-markdown-more-menu-item";
      entry.dataset.toolbarCommand = command;
      entry.setAttribute("role", "menuitem");
      const icon = doc.createElement("span");
      icon.innerHTML = source.innerHTML;
      icon.setAttribute("aria-hidden", "true");
      entry.append(icon, source.getAttribute("aria-label") || source.title);
      panel.append(entry);
    }
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    const anchor = trigger.getBoundingClientRect();
    const bounds = root.getBoundingClientRect();
    panel.style.maxHeight = `${Math.max(32, bounds.bottom - anchor.bottom - 16)}px`;
    panel.style.maxWidth = `${Math.max(32, bounds.width - 16)}px`;
    const width = panel.getBoundingClientRect().width;
    panel.style.left = `${Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - width - 8))}px`;
    panel.style.top = `${anchor.bottom + 8}px`;
    panel.querySelector<HTMLButtonElement>("button")?.focus();
  };
  const onClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const trigger = target?.closest<HTMLButtonElement>("[data-toolbar-group]");
    if (trigger && toolbar.contains(trigger)) {
      open(trigger.dataset.toolbarGroup as ToolbarGroup);
      return;
    }
    const entry = target?.closest<HTMLButtonElement>("[data-toolbar-command]");
    if (!entry || !panel.contains(entry) || readOnly || !activeTrigger) return;
    const anchor = activeTrigger;
    const command = entry.dataset.toolbarCommand as ToolbarCommand;
    close();
    // Table picker anchors to the persistent Insert control, never a hidden menu row.
    options.onCommand(command, anchor);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (panel.hidden || !event.target) return;
    const target = event.target as Node;
    if (!panel.contains(target) && !activeTrigger?.contains(target)) close();
  };
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as Node | null;
    if (
      !panel.hidden &&
      target &&
      !panel.contains(target) &&
      !activeTrigger?.contains(target)
    )
      close();
  };
  // Pointer events inside the editor iframe do not bubble to this document.
  // Losing window focus covers returning to that iframe without touching its selection.
  const onWindowBlur = () => {
    close();
    options.closeOtherMenus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (panel.hidden) {
      const trigger = (
        event.target as Element | null
      )?.closest<HTMLButtonElement>("[data-toolbar-group]");
      if (
        trigger &&
        toolbar.contains(trigger) &&
        ["ArrowDown", "ArrowUp"].includes(event.key)
      ) {
        event.preventDefault();
        open(trigger.dataset.toolbarGroup as ToolbarGroup);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (
      ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) &&
      panel.contains(doc.activeElement)
    ) {
      event.preventDefault();
      const entries = [...panel.querySelectorAll<HTMLButtonElement>("button")];
      const current = entries.indexOf(doc.activeElement as HTMLButtonElement);
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? entries.length - 1
            : (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                entries.length) %
              entries.length;
      entries[index]?.focus();
    } else if (event.key === "Tab") close();
  };
  const measure = () => {
    frame = null;
    if (destroyed) return;
    const width =
      workspace.getBoundingClientRect().width || workspace.clientWidth;
    if (!width) return;
    const next = toolbarLayoutForWidth(width, layout);
    if (width === previousWidth && next === layout) return;
    previousWidth = width;
    const previousTrigger = activeTrigger;
    const changedLayout = next !== layout;
    const shouldAnimate =
      changedLayout &&
      layout !== undefined &&
      !motionPreference?.matches &&
      controls.some((button) => typeof button.animate === "function");
    // Capture before cancelling so rapid reversals continue from the visual
    // position, including a partially faded-in grouping button.
    const before = shouldAnimate ? captureControls() : undefined;
    if (changedLayout || motionPreference?.matches) stopMotion();
    // Do not move focus from the iframe during resize or IME composition.
    const active = doc.activeElement as HTMLElement | null;
    const ownedFocus =
      !!active &&
      (panel.contains(active) ||
        triggers.has(active.dataset.toolbarGroup as ToolbarGroup));
    close();
    options.closeOtherMenus();
    layout = next;
    toolbar.dataset.toolbarLayout = next;
    toolbar.toggleAttribute("data-toolbar-tight", width < 320);
    if (before) animateControls(before);
    if (ownedFocus && !options.isComposing()) {
      const fallback =
        !changedLayout && previousTrigger
          ? previousTrigger
          : next === "compact"
            ? triggers.get("format")
            : next === "grouped"
              ? triggers.get("heading")
              : originals.get("bold");
      fallback?.focus();
    }
  };
  const schedule = () => {
    if (frame === null && !destroyed)
      frame = win.requestAnimationFrame(measure);
  };
  const observer = new win.ResizeObserver(schedule);
  observer.observe(workspace);
  win.addEventListener("resize", schedule);
  win.addEventListener("blur", onWindowBlur);
  doc.addEventListener("focusin", onFocusIn);
  toolbar.addEventListener("click", onClick);
  // Settle anchors before any toolbar command opens a positioned picker. Wait
  // until click (not pointerdown), so a moving button keeps its click target.
  toolbar.addEventListener("click", stopMotion, true);
  toolbar.addEventListener("keydown", stopMotion, true);
  doc.addEventListener("pointerdown", onPointerDown);
  doc.addEventListener("keydown", onKeyDown);
  motionPreference?.addEventListener?.("change", onMotionPreferenceChange);
  measure();
  return {
    close,
    updateMode(next, canSave = true) {
      if (readOnly !== next || originals.get("save")?.disabled !== !canSave)
        stopMotion();
      readOnly = next;
      if (readOnly) close();
      for (const trigger of triggers.values()) trigger.disabled = readOnly;
      for (const [command, button] of originals) {
        if (command === "save") button.disabled = !canSave;
        if (
          command !== "save" &&
          GROUP_COMMANDS.format
            .concat(GROUP_COMMANDS.insert, ["undo", "redo"])
            .includes(command)
        )
          button.disabled = readOnly;
      }
    },
    destroy() {
      destroyed = true;
      close();
      stopMotion();
      motionPreference?.removeEventListener?.(
        "change",
        onMotionPreferenceChange,
      );
      observer.disconnect();
      win.removeEventListener("resize", schedule);
      win.removeEventListener("blur", onWindowBlur);
      doc.removeEventListener("focusin", onFocusIn);
      if (frame !== null) win.cancelAnimationFrame(frame);
      toolbar.removeEventListener("click", onClick);
      toolbar.removeEventListener("click", stopMotion, true);
      toolbar.removeEventListener("keydown", stopMotion, true);
      doc.removeEventListener("pointerdown", onPointerDown);
      doc.removeEventListener("keydown", onKeyDown);
      panel.remove();
      for (const trigger of triggers.values()) trigger.remove();
    },
  };
}

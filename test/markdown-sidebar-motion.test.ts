import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { createSidebarMotion } from "../src/modules/markdown/sidebar-motion.ts";

interface MockAnimation {
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  cancelled: number;
  finished: Promise<void>;
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
  cancel(): void;
}

function fixture(t: TestContext, edge: "left" | "right" = "left") {
  const win = new Window();
  win.document.body.innerHTML =
    '<button id="toggle"><span class="zmd-btn-inner"><span class="zmd-icon"></span></span></button><main style="position:relative"><aside style="color: red; transform: scale(0.98); opacity: 0.9; margin-left: 3px !important; inline-size: 220px"><button>Item</button></aside></main>';
  const sidebar = win.document.querySelector("aside")!;
  const toggle = win.document.querySelector("#toggle")!;
  const icon = toggle.querySelector<HTMLElement>(".zmd-icon")!;
  const child = sidebar.querySelector("button")!;
  for (const [name, value] of Object.entries({
    offsetLeft: 42,
    offsetTop: 12,
    offsetWidth: 220,
    offsetHeight: 500,
  }))
    Object.defineProperty(sidebar, name, { configurable: true, value });
  let reduced = false;
  const motionListeners = new Set<() => void>();
  Object.defineProperty(win, "matchMedia", {
    value: () => ({
      get matches() {
        return reduced;
      },
      addEventListener: (_: string, listener: () => void) =>
        motionListeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        motionListeners.delete(listener),
    }),
  });
  let currentVisual: { transform: string; opacity: string } | undefined;
  let iconVisual: { transform: string } | undefined;
  const getComputedStyle = win.getComputedStyle.bind(win);
  Object.defineProperty(win, "getComputedStyle", {
    value: (element: unknown) =>
      element === sidebar && currentVisual
        ? currentVisual
        : element === icon && iconVisual
          ? iconVisual
          : getComputedStyle(element as any),
  });
  const animations: MockAnimation[] = [];
  const iconAnimations: MockAnimation[] = [];
  Object.defineProperty(icon, "animate", {
    configurable: true,
    writable: true,
    value: (frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation: MockAnimation = {
        frames,
        options,
        cancelled: 0,
        finished: Promise.resolve(),
        onfinish: null,
        oncancel: null,
        cancel() {
          this.cancelled++;
          iconVisual = undefined;
          this.oncancel?.();
        },
      };
      iconAnimations.push(animation);
      return animation;
    },
  });
  Object.defineProperty(sidebar, "animate", {
    configurable: true,
    writable: true,
    value: (frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = {
        frames,
        options,
        cancelled: 0,
        finished: Promise.resolve(),
        onfinish: null as (() => void) | null,
        oncancel: null as (() => void) | null,
        cancel() {
          this.cancelled++;
          currentVisual = undefined;
          this.oncancel?.();
        },
      };
      animations.push(animation);
      return animation;
    },
  });
  const motion = createSidebarMotion(
    sidebar as unknown as HTMLElement,
    toggle as unknown as HTMLButtonElement,
    edge,
  );
  t.after(async () => {
    motion.destroy();
    await win.happyDOM.close();
  });
  return {
    sidebar,
    toggle,
    icon,
    child,
    motion,
    animations,
    iconAnimations,
    motionListeners,
    setReduced(value: boolean) {
      reduced = value;
      for (const listener of motionListeners) listener();
    },
    setVisual: (value: typeof currentVisual) => (currentVisual = value),
    setIconVisual: (value: typeof iconVisual) => (iconVisual = value),
    update(visible: boolean, animate = true) {
      motion.update(visible, () => (sidebar.hidden = !visible), animate);
    },
  };
}

test("initial visibility commits immediately; opening animates only transform and opacity", (t) => {
  const f = fixture(t);
  const style = f.sidebar.getAttribute("style");
  f.update(false);
  assert.equal(f.animations.length, 0);
  assert.equal(f.sidebar.hidden, true);
  assert.equal(f.sidebar.inert, true);
  assert.equal(f.sidebar.getAttribute("aria-hidden"), "true");

  f.update(true);
  assert.equal(f.sidebar.hidden, false);
  assert.equal(f.sidebar.inert, false);
  assert.equal(f.sidebar.getAttribute("aria-hidden"), "false");
  assert.equal(f.animations[0].options.duration, 190);
  assert.deepEqual(f.animations[0].frames, [
    { transform: "translateX(-10px) scale(0.98)", opacity: "0" },
    { transform: "scale(0.98)", opacity: "0.9" },
  ]);
  assert.equal(f.sidebar.getAttribute("style"), style);
  f.animations[0].onfinish?.();
  assert.equal(f.animations[0].cancelled, 1);
  assert.equal(f.sidebar.getAttribute("style"), style);
});

test("closing releases layout synchronously and overlays the real inert sidebar at its old geometry", (t) => {
  const f = fixture(t, "right");
  const style = f.sidebar.getAttribute("style");
  f.update(true);
  f.child.focus();
  let applied = false;
  f.motion.update(false, () => {
    assert.equal(f.sidebar.ownerDocument.activeElement, f.toggle);
    f.sidebar.hidden = true;
    applied = true;
  });
  assert.equal(applied, true);
  assert.equal(f.sidebar.hidden, true);
  assert.equal(f.sidebar.inert, true);
  assert.equal(f.sidebar.getAttribute("aria-hidden"), "true");
  assert.equal(f.sidebar.firstElementChild, f.child, "no cloned panel");
  assert.equal(f.sidebar.style.position, "absolute");
  assert.equal(f.sidebar.style.display, "flex");
  assert.equal(f.sidebar.style.left, "42px");
  assert.equal(f.sidebar.style.top, "12px");
  assert.equal(f.sidebar.style.inlineSize, "220px");
  assert.equal(f.sidebar.style.blockSize, "500px");
  assert.equal(f.sidebar.style.pointerEvents, "none");
  assert.equal(f.sidebar.style.getPropertyPriority("position"), "important");
  const animation = f.animations[0];
  assert.equal(animation.options.duration, 150);
  assert.deepEqual(animation.frames[1], {
    transform: "translateX(10px) scale(0.98)",
    opacity: "0",
  });
  for (const frame of animation.frames)
    assert.deepEqual(Object.keys(frame).sort(), ["opacity", "transform"]);
  animation.onfinish?.();
  assert.equal(f.sidebar.getAttribute("style"), style);
  assert.equal(f.sidebar.hidden, true);
  assert.equal(f.sidebar.inert, true);
});

test("rapid reversal continues from the current visual and stale completion cannot clear the new animation", (t) => {
  const f = fixture(t);
  const style = f.sidebar.getAttribute("style");
  f.update(true);
  f.update(false);
  const closing = f.animations[0];
  const staleFinish = closing.onfinish!;
  const staleCancel = closing.oncancel!;
  const intermediate = {
    transform: "matrix(0.98, 0, 0, 0.98, -3, 0)",
    opacity: "0.45",
  };
  f.setVisual(intermediate);
  f.update(true);
  const opening = f.animations[1];
  assert.deepEqual(opening.frames[0], intermediate);
  assert.equal(f.sidebar.hidden, false);
  assert.equal(f.sidebar.inert, false);
  assert.equal(f.sidebar.getAttribute("style"), style);
  assert.equal(closing.cancelled, 1);
  staleFinish();
  staleCancel();
  assert.equal(opening.cancelled, 0);
  assert.equal(f.sidebar.hidden, false);

  f.setVisual({ transform: "matrix(0.98, 0, 0, 0.98, -1, 0)", opacity: "0.8" });
  f.update(false);
  assert.equal(opening.cancelled, 1);
  assert.equal(
    f.sidebar.style.left,
    "42px",
    "transform does not shift the captured geometry twice",
  );
  f.motion.finish();
  assert.equal(f.sidebar.getAttribute("style"), style);
});

test("repeated target updates do not restart motion; an explicit immediate update finishes it", (t) => {
  const f = fixture(t);
  const style = f.sidebar.getAttribute("style");
  f.update(true);
  f.update(false);
  let applied = 0;
  f.motion.update(false, () => applied++);
  assert.equal(applied, 1);
  assert.equal(f.animations.length, 1);
  assert.equal(f.animations[0].cancelled, 0);
  f.update(false, false);
  assert.equal(f.animations[0].cancelled, 1);
  assert.equal(f.sidebar.getAttribute("style"), style);
  assert.equal(f.sidebar.hidden, true);
});

test("sidebar glyphs tilt by edge and return to their original orientation without changing the button", async (t) => {
  for (const edge of ["left", "right"] as const) {
    await t.test(edge, (t) => {
      const f = fixture(t, edge);
      f.icon.style.transform = "scale(0.95)";
      const iconStyle = f.icon.getAttribute("style");
      const buttonMarkup = f.toggle.outerHTML;
      f.update(false);
      assert.equal(f.iconAnimations.length, 0, "no initial-state animation");
      f.update(true);
      const opening = f.iconAnimations[0];
      assert.equal(opening.options.duration, f.animations[0].options.duration);
      assert.deepEqual(opening.frames, [
        { transform: "scale(0.95)" },
        {
          transform: `perspective(80px) rotateY(${edge === "left" ? 18 : -18}deg) scale(0.95)`,
          offset: 0.4,
        },
        { transform: "scale(0.95)" },
      ]);
      f.animations[0].onfinish?.();
      assert.equal(opening.cancelled, 1);
      assert.equal(f.icon.getAttribute("style"), iconStyle);
      assert.equal(
        f.toggle.outerHTML,
        buttonMarkup,
        "button remains untouched",
      );

      f.update(false);
      const closing = f.iconAnimations[1];
      assert.equal(closing.options.duration, f.animations[1].options.duration);
      assert.match(
        String(closing.frames[1].transform),
        new RegExp(`rotateY\\(${edge === "left" ? -18 : 18}deg\\)`),
      );
      assert.deepEqual(closing.frames.at(-1), { transform: "scale(0.95)" });
    });
  }
});

test("rapid reversal continues the glyph from its current transform and cancels superseded feedback", (t) => {
  const f = fixture(t);
  f.update(true);
  f.update(false);
  const staleFinish = f.animations[0].onfinish!;
  const intermediate =
    "matrix3d(0.98, 0, 0.1, 0, 0, 1, 0, 0, -0.1, 0, 0.98, 0, 0, 0, 0, 1)";
  f.setIconVisual({ transform: intermediate });
  f.update(true);
  assert.equal(f.iconAnimations[0].cancelled, 1);
  assert.equal(f.iconAnimations.length, 2);
  assert.deepEqual(f.iconAnimations[1].frames[0], { transform: intermediate });
  assert.deepEqual(f.iconAnimations[1].frames.at(-1), { transform: "none" });
  staleFinish();
  assert.equal(f.iconAnimations[1].cancelled, 0);
  f.motion.finish();
  assert.equal(f.iconAnimations[1].cancelled, 1);
});

test("repeated, immediate and reduced-motion updates never replay glyph feedback; preference changes stop it immediately", (t) => {
  const f = fixture(t);
  f.update(true);
  f.update(false);
  f.update(false);
  assert.equal(f.iconAnimations.length, 1);
  assert.equal(f.iconAnimations[0].cancelled, 0);
  f.update(false, false);
  assert.equal(f.iconAnimations[0].cancelled, 1);
  f.update(true, false);
  assert.equal(f.iconAnimations.length, 1);
  f.update(false);
  assert.equal(f.iconAnimations.length, 2);
  f.setReduced(true);
  assert.equal(f.animations[1].cancelled, 1);
  assert.equal(f.iconAnimations[1].cancelled, 1);
  assert.equal(
    f.sidebar.style.position,
    "",
    "closing overlay is removed immediately",
  );
  f.update(true);
  assert.equal(f.iconAnimations.length, 2);
  assert.equal(f.motionListeners.size, 1);
  f.motion.destroy();
  assert.equal(f.motionListeners.size, 0);
});

test("missing or unavailable glyph animation does not interrupt panel motion", async (t) => {
  for (const kind of ["missing", "unavailable", "throws"] as const) {
    await t.test(kind, (t) => {
      const f = fixture(t);
      if (kind === "missing") f.icon.remove();
      if (kind === "unavailable") (f.icon as any).animate = undefined;
      if (kind === "throws")
        (f.icon as any).animate = () => {
          throw new Error("glyph animation unavailable");
        };
      f.update(true);
      const style = f.sidebar.getAttribute("style");
      f.update(false);
      assert.equal(f.animations.length, 1);
      assert.equal(f.iconAnimations.length, 0);
      f.animations[0].onfinish?.();
      assert.equal(f.sidebar.getAttribute("style"), style);
      assert.equal(f.sidebar.hidden, true);
    });
  }
});

test("reduced motion, unavailable or failing animation and zero geometry leave the committed state clean", async (t) => {
  for (const kind of [
    "reduced",
    "missing",
    "throws",
    "zero",
    "immediate",
  ] as const) {
    await t.test(kind, (t) => {
      const f = fixture(t);
      const style = f.sidebar.getAttribute("style");
      f.update(true);
      if (kind === "reduced") f.setReduced(true);
      if (kind === "missing") (f.sidebar as any).animate = undefined;
      if (kind === "throws")
        (f.sidebar as any).animate = () => {
          throw new Error("animation unavailable");
        };
      if (kind === "zero")
        Object.defineProperty(f.sidebar, "offsetWidth", { value: 0 });
      f.update(false, kind !== "immediate");
      assert.equal(f.animations.length, 0);
      assert.equal(f.iconAnimations.length, 0);
      assert.equal(f.sidebar.hidden, true);
      assert.equal(f.sidebar.inert, true);
      assert.equal(f.sidebar.getAttribute("aria-hidden"), "true");
      assert.equal(f.sidebar.getAttribute("style"), style);
    });
  }
});

test("reduced motion ends an active animation and destroy is idempotent with stale callbacks", (t) => {
  const f = fixture(t);
  f.sidebar.removeAttribute("style");
  f.update(true);
  f.update(false);
  f.setReduced(true);
  f.update(false);
  assert.equal(f.animations[0].cancelled, 1);
  assert.equal(f.sidebar.hasAttribute("style"), false);
  f.setReduced(false);
  f.update(true);
  f.update(false);
  const last = f.animations.at(-1)!;
  const stale = last.onfinish!;
  f.motion.destroy();
  f.motion.destroy();
  f.motion.finish();
  stale();
  assert.equal(last.cancelled, 1);
  assert.equal(f.sidebar.hasAttribute("style"), false);
  assert.equal(f.sidebar.hidden, true);
  assert.equal(f.sidebar.inert, true);
  let applied = false;
  f.motion.update(true, () => (applied = true));
  assert.equal(applied, false);
});

test("cancelling a native animation consumes its rejected completion promise", async () => {
  const win = new Window();
  const sidebar = win.document.createElement("aside");
  const toggle = win.document.createElement("button");
  const icon = win.document.createElement("span");
  icon.className = "zmd-icon";
  toggle.append(icon);
  win.document.body.append(toggle, sidebar);
  const motion = createSidebarMotion(
    sidebar as unknown as HTMLElement,
    toggle as unknown as HTMLButtonElement,
    "right",
  );
  motion.update(false, () => (sidebar.hidden = true));
  motion.update(true, () => (sidebar.hidden = false));
  motion.destroy();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await win.happyDOM.close();
  assert.equal(sidebar.hidden, false);
  assert.equal(sidebar.inert, false);
});

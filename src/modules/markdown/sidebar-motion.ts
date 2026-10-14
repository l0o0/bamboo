export interface SidebarMotion {
  update(visible: boolean, apply: () => void, animate?: boolean): void;
  finish(): void;
  destroy(): void;
}

/** Animate the existing panel while its owner commits the final layout once. */
export function createSidebarMotion(
  sidebar: HTMLElement,
  toggle: HTMLButtonElement,
  edge: "left" | "right",
): SidebarMotion {
  const win = sidebar.ownerDocument.defaultView;
  const reducedMotion = win?.matchMedia?.("(prefers-reduced-motion: reduce)");
  let visible: boolean | undefined;
  let destroyed = false;
  let active: {
    animation: Animation;
    restore: () => void;
    icon?: { element: HTMLElement; animation: Animation };
  } | null = null;

  const finish = () => {
    const previous = active;
    active = null;
    if (!previous) return;
    previous.animation.onfinish = null;
    previous.animation.oncancel = null;
    previous.icon?.animation.cancel();
    previous.animation.cancel();
    previous.restore();
  };

  const onMotionPreferenceChange = () => {
    if (reducedMotion?.matches) finish();
  };
  reducedMotion?.addEventListener?.("change", onMotionPreferenceChange);

  const visual = () => {
    const style = win?.getComputedStyle(sidebar);
    return {
      transform: style?.transform || "none",
      opacity: style?.opacity || "1",
    };
  };

  return {
    update(nextVisible, apply, animate = true) {
      if (destroyed) return;
      const changed = visible !== nextVisible;
      const enabled =
        animate &&
        typeof sidebar.animate === "function" &&
        !reducedMotion?.matches;
      if (!nextVisible && sidebar.contains(sidebar.ownerDocument.activeElement))
        toggle.focus({ preventScroll: true });

      // Resize/active-item updates may repeat the same state. They must not
      // restart an animation already heading toward that state.
      if (!changed && enabled) {
        apply();
        sidebar.inert = !nextVisible;
        sidebar.setAttribute("aria-hidden", String(!nextVisible));
        return;
      }

      const from = active && enabled ? visual() : undefined;
      const icon = toggle.querySelector<HTMLElement>(".zmd-icon");
      const iconFrom =
        active?.icon?.element === icon && enabled && icon
          ? win?.getComputedStyle(icon)?.transform || "none"
          : undefined;
      finish();
      const shouldAnimate =
        visible !== undefined && changed && enabled && sidebar.isConnected;
      // offset geometry excludes the in-flight transform. Both sidebars live
      // in the positioned document body; absolute placement uses that same
      // containing block, including when the backlinks panel is floating.
      const box =
        shouldAnimate && !nextVisible
          ? {
              left: sidebar.offsetLeft,
              top: sidebar.offsetTop,
              width: sidebar.offsetWidth,
              height: sidebar.offsetHeight,
            }
          : null;
      visible = nextVisible;
      apply();
      sidebar.inert = !nextVisible;
      sidebar.setAttribute("aria-hidden", String(!nextVisible));
      if (!shouldAnimate || (box && (!box.width || !box.height))) return;

      const resting = visual();
      const shifted = {
        transform: `translateX(${edge === "left" ? -10 : 10}px)${
          resting.transform === "none" ? "" : ` ${resting.transform}`
        }`,
        opacity: "0",
      };
      const originalStyle = sidebar.getAttribute("style");
      const restore = () => {
        if (originalStyle === null) sidebar.removeAttribute("style");
        else sidebar.setAttribute("style", originalStyle);
      };
      if (box) {
        // Keep the real closing panel above its old position, without keeping
        // its flex width. The owner's hidden/class state stays final throughout.
        // Geometry is assigned once; only transform and opacity are animated.
        const overlay = {
          display: "flex",
          position: "absolute",
          "inset-inline": "auto",
          "inset-block": "auto",
          right: "auto",
          bottom: "auto",
          left: `${box.left}px`,
          top: `${box.top}px`,
          "inline-size": `${box.width}px`,
          "block-size": `${box.height}px`,
          "min-inline-size": "0",
          "max-inline-size": "none",
          "min-block-size": "0",
          "max-block-size": "none",
          "box-sizing": "border-box",
          margin: "0",
          "pointer-events": "none",
          "z-index": "6",
        };
        for (const [property, value] of Object.entries(overlay))
          sidebar.style.setProperty(property, value, "important");
      }
      try {
        const duration = nextVisible ? 190 : 150;
        const animation = sidebar.animate(
          [
            from ?? (nextVisible ? shifted : resting),
            nextVisible ? resting : shifted,
          ],
          {
            duration,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
            fill: "both",
          },
        );
        // Reversing or destroying deliberately cancels the animation. Its
        // finished promise rejects even though cleanup uses the event hooks.
        void animation.finished.catch(() => {});
        const current: NonNullable<typeof active> = { animation, restore };
        active = current;
        const complete = () => {
          if (active === current) finish();
        };
        animation.onfinish = complete;
        animation.oncancel = complete;

        if (icon?.isConnected && typeof icon.animate === "function") {
          // Tilt only the inner glyph. The button hitbox and neighboring menu
          // stay fixed, and the final orientation still identifies its edge.
          const restingIcon = win?.getComputedStyle(icon)?.transform || "none";
          const angle = (edge === "left" ? -18 : 18) * (nextVisible ? -1 : 1);
          try {
            const iconAnimation = icon.animate(
              [
                { transform: iconFrom ?? restingIcon },
                {
                  transform: `perspective(80px) rotateY(${angle}deg)${
                    restingIcon === "none" ? "" : ` ${restingIcon}`
                  }`,
                  offset: 0.4,
                },
                { transform: restingIcon },
              ],
              {
                duration,
                easing: "cubic-bezier(0.2, 0, 0, 1)",
                fill: "both",
              },
            );
            void iconAnimation.finished.catch(() => {});
            current.icon = { element: icon, animation: iconAnimation };
          } catch {
            // A decorative glyph must not prevent the panel from settling.
          }
        }
      } catch {
        restore();
      }
    },
    finish,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      reducedMotion?.removeEventListener?.("change", onMotionPreferenceChange);
      finish();
    },
  };
}

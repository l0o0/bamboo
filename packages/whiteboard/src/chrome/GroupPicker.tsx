import { useEffect, useRef } from "react";
import type { WhiteboardLabels } from "../model/protocol";

export function GroupPicker(props: {
  labels: WhiteboardLabels;
  frames: { id: string; title: string; members: number; current: boolean }[];
  onPreview: (id: string | null) => void;
  onJoin: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => props.onPreview(null);
  }, []);
  return (
    <div
      className="zmd-board-group-picker-backdrop"
      style={{ position: "absolute", inset: 0, zIndex: 100 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <style>{`.react-flow__node.is-group-target { outline: 2px solid var(--zmd-board-accent, #3b82f6); outline-offset: 5px; border-radius: 8px; }`}</style>
      <div
        ref={ref}
        className="zmd-board-context-menu"
        role="dialog"
        aria-modal="true"
        aria-label={props.labels.joinGroup ?? "Join group"}
        style={{
          position: "absolute",
          left: "50%",
          top: 80,
          transform: "translateX(-50%)",
          width: "min(320px, calc(100% - 24px))",
          maxHeight: "calc(100% - 104px)",
          overflowY: "auto",
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.onClose();
            return;
          }
          if (
            !["ArrowDown", "ArrowUp", "Tab", "Home", "End"].includes(event.key)
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const buttons = Array.from(
            ref.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const direction =
            event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)
              ? -1
              : 1;
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index + direction + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }}
      >
        <strong style={{ display: "block", padding: "8px 12px" }}>
          {props.labels.joinGroup ?? "Join group"}
        </strong>
        {props.frames.length ? (
          props.frames.map((frame) => (
            <button
              key={frame.id}
              type="button"
              data-group-choice={frame.id}
              aria-pressed={frame.current}
              onMouseEnter={() => props.onPreview(frame.id)}
              onFocus={() => props.onPreview(frame.id)}
              onClick={() => props.onJoin(frame.id)}
            >
              <span style={{ flex: 1 }}>{frame.title}</span>
              <small>
                {(props.labels.groupMembers ?? "{count} cards").replace(
                  "{count}",
                  String(frame.members),
                )}
                {frame.current ? " ✓" : ""}
              </small>
            </button>
          ))
        ) : (
          <p style={{ padding: "8px 12px" }}>
            {props.labels.noGroups ?? "Create a group first"}
          </p>
        )}
        <button type="button" onClick={props.onClose}>
          {props.labels.close}
        </button>
      </div>
    </div>
  );
}

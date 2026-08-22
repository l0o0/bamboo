# Markdown Settings and Shortcut Design

## Goal

Use one custom Markdown settings modal as the only settings editor. Keep the
Zotero preference pane as a lightweight entry point, and replace raw shortcut
text editing with a compact keyboard-recording control.

## Settings Ownership

The custom Markdown modal owns every editable plugin preference:

- Open `.md` attachments with the Markdown editor.
- Add YAML frontmatter to new notes.
- Editor font size.
- New standalone Markdown note shortcut.

The modal footer contains only the primary Save action. It does not link back
to Zotero preferences.

The Zotero preference pane contains:

- The `Zotero Markdown` title.
- One `Open Markdown Settings` button.
- Existing plugin version and build information.

The preference pane does not duplicate individual settings controls. Clicking
its button opens the same custom modal used by the Markdown tab menu in the
active Zotero main window.

## Shortcut Control

The shortcut row shows the action label on the left and compact keycaps on the
right. The stored value remains the Toolkit-compatible representation such as
`accel,shift,M`, but that internal string is not exposed during normal use.

Platform display rules:

- macOS: `accel` is displayed as `⌘`; `shift` as `⇧`; `alt` as `⌥`; and
  `control` as `⌃`.
- Windows and Linux: `accel` is displayed as `Ctrl`; other modifiers use
  `Shift`, `Alt`, and `Meta`.
- The main key is displayed as an uppercase keycap.

The row offers `Edit`. Activating it enters recording mode:

- The control displays `Press a new shortcut` and receives keyboard focus.
- Modifier-only presses do not complete recording.
- A modifier plus a non-modifier key updates the pending shortcut and exits
  recording mode.
- `Escape` cancels recording and restores the previous shortcut.
- `Backspace` or `Delete` clears the shortcut.
- A `Restore Default` action sets it back to `accel,shift,M`.

Saving the settings writes the preference and immediately re-registers the
Toolkit keyboard callback. Restarting Zotero is not required. Canceling or
closing the modal discards the pending shortcut.

## Validation

Reject shortcuts that contain only modifiers. Empty shortcuts are allowed and
mean that the action has no global binding. The keyboard listener must skip
registration matching when the stored shortcut is empty.

The existing safeguard remains: the global action does not fire while focus is
inside an input, textarea, or editable element.

## Visual Style

The control follows Zotero's restrained native appearance:

- Keycaps use the muted utility surface, one-pixel border, 4px radius, and
  tabular system text.
- Keycaps are separate compact elements, not a large rounded text field.
- Recording uses the existing blue focus treatment without a filled blue
  container.
- Edit, Clear, and Restore Default are quiet text or secondary controls.
- The font-size setting remains a single inline row with its number input on
  the right.

Both light and dark themes use existing Markdown modal tokens.

## Architecture

Shortcut parsing, formatting, and keyboard-event serialization live in a pure
helper module so they can be unit tested without Zotero globals. The modal owns
recording UI state and returns the serialized value with the remaining settings.

The preference-pane load hook binds the entry button. A small shared opener
locates the active main window and opens the same settings modal implementation.
The tab-specific settings entry continues to reuse its existing modal controller.

## Tests

- Parse and format Toolkit shortcut strings on macOS and non-macOS platforms.
- Serialize valid keyboard events and ignore modifier-only events.
- Verify clear, cancel, and default shortcut behavior.
- Verify saving settings immediately refreshes the Toolkit registration.
- Verify the Zotero preference pane contains only the settings-entry button,
  title, and build information.
- Verify the custom modal no longer contains the `Open Zotero Settings` action.

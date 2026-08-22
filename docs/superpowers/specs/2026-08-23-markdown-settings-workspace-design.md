# Markdown Settings Workspace Design

## Goal

Replace the compact single-column settings form with a structured settings
workspace that follows Zotero's native visual language. Remove the misleading
submenu indicator from the editor's `Settings` menu item because it opens a
dialog directly.

## Entry Points

The same settings workspace opens from both existing entry points:

- The `Settings` command in the Markdown editor's more menu.
- The `Open Markdown Settings` button in Zotero's plugin preference pane.

The more-menu `Settings` row is a direct command. It has no chevron, submenu
state, or expanded state.

## Window Structure

The settings workspace remains a modal surface centered over the active Zotero
window. It uses three fixed regions:

1. A 52px header containing `Settings` and a close icon.
2. A 188px navigation rail on the left.
3. A flexible content region on the right with a footer-aligned `Done` button.

The desktop modal is approximately 760px wide and no taller than the available
window. It uses the existing surface, border, text, muted text, focus, and dark
theme tokens. The border radius remains restrained at 8px. Elevation is subtle
and structural rather than decorative.

The content region uses a 28px inline inset and 24px block inset. Section
headings use 15px semibold text. Rows use thin separators and stable 52px
minimum heights so labels and controls align consistently.

## Navigation

The left rail contains four functional pages:

- `General`, with a settings icon.
- `Editor`, with a text icon.
- `Shortcuts`, with a keyboard icon.
- `About`, with an information icon.

The active page uses the muted utility surface, primary text, and a subtle
one-pixel border. Inactive items remain transparent and gain the utility
surface on hover. Every item is a real button with `aria-selected`, keyboard
focus styling, and a stable 36px height.

The default page is `General`. Switching pages does not discard pending values;
all settings are committed only when `Done` is activated. Closing with the
header close button, backdrop, or Escape discards pending values.

## Pages

### General

Contains the two existing boolean preferences:

- Open `.md` attachments with the Markdown editor.
- Add YAML frontmatter when creating a new note.

Use native checkboxes and direct labels. No enclosing card is used.

### Editor

Contains the editor font-size preference. The label remains on the left and the
number stepper stays right-aligned in the row. Its range remains 11 through 22.

### Shortcuts

Contains the existing `New standalone Markdown note` shortcut. The action label
is left-aligned and the current shortcut appears as platform-native keycaps on
the right. `Edit` enters recording mode. A compact overflow button exposes
`Clear` and `Restore Default`, keeping routine rows visually quiet.

The page includes one muted sentence: shortcut changes take effect after
pressing `Done`. Recording behavior remains unchanged:

- Modifier-only presses do not complete recording.
- Escape cancels the current recording operation.
- Delete or Backspace clears the recorded shortcut.
- The default remains `accel,shift,M`.

### About

Displays existing build metadata without introducing network-dependent update
checks:

- Plugin name.
- Installed version.
- Build time.

This is informational and contains no editable controls.

## Footer and Save Behavior

The footer belongs to the content region and stays at the bottom when a page is
short. It contains one primary `Done` button. `Done` writes all pending settings,
refreshes the Toolkit shortcut registration, and closes the modal.

The primary button uses the existing restrained dark treatment shown in the
reference. It must retain sufficient contrast in light and dark themes and must
not introduce a new accent palette.

## Responsive Behavior

At modal widths below 560px, the left rail becomes a compact horizontal tab row
below the header. Labels remain visible while icons may be hidden if necessary.
The content uses a 16px inset. Setting rows may wrap, but controls never overlap
labels. The footer remains reachable without covering page content.

## Architecture

The existing modal controller continues to own open, close, focus restoration,
and settings persistence. Settings rendering is split into small page renderers
inside the Markdown settings module:

- Navigation state selects the visible page.
- One pending `SettingsModalData` object remains the source of truth across
  page switches.
- Shortcut recording updates only the pending object.
- `Done` passes the complete object to the existing save callback.

The settings layout is used only for `ModalKind.settings`; document information
and rename dialogs retain their current compact geometry.

## Accessibility

- The navigation uses tab semantics or an equivalent selected-button pattern.
- Arrow keys move between navigation items; Enter and Space activate them.
- The close icon and shortcut overflow button have accessible names.
- Focus moves to the active page heading after navigation.
- The active recorder announces `Press a new shortcut` through a polite live
  region.
- Reduced-motion users receive immediate page switches with no animated layout.

## Tests

- The more-menu `Settings` item has no submenu flag.
- All four settings navigation pages exist and switch without losing pending
  values.
- General and Editor controls preserve current preference mappings.
- Shortcut keycaps, recording, clear, and restore-default behavior remain
  covered.
- About displays plugin metadata supplied by the opener.
- `Done` saves once and closes; dismissing the modal does not save.
- The settings modal has desktop rail and narrow horizontal navigation styles.
- Document information and rename modals keep their compact layout.

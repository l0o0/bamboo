# Editor Width Alignment Design

**Date:** 2026-08-15  
**Status:** Approved

## Goal

Align the Live editor text, rendered tables, and top toolbar to one horizontal rhythm.

## Layout Rule

- Keep the Live editor outer reading column at `48rem` maximum width.
- Preserve the existing Live line insets: `34px` on the left and `30px` on the right.
- Render table borders inside those same insets instead of against the outer reading-column edges.
- Constrain the toolbar inner track to the same inset content width: `calc(48rem - 64px)`.
- On narrow viewports, all three regions continue to shrink fluidly within their existing outer padding.
- Source mode remains unconstrained and unchanged.

## Implementation

- Expose the Live outer width and left/right insets as shared constants or CSS custom properties where practical.
- Remove table-line padding after moving the complete table grid inward with horizontal margins, avoiding double insets.
- Update the toolbar maximum width from its independent `64rem` track to the shared Live content width.

## Verification

- Heading/body text, table borders, and toolbar inner controls share matching left and right boundaries in Live mode.
- Tables with one to eight columns retain equal column geometry.
- Narrow editor panes do not overflow horizontally.
- Source mode geometry is unchanged.

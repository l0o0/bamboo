/**
 * Minimal Lucide-style SVG icons (MIT) for the markdown toolbar.
 * Inline paths avoid pulling the full lucide package into the plugin bundle.
 */

const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="zmd-icon"';

function svg(paths: string): string {
  return `<svg ${SVG_ATTRS}>${paths}</svg>`;
}

/** pen-line — Live mode */
export const iconLive = () =>
  svg(
    `<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>`,
  );

/** code-2 — Source mode */
export const iconSource = () =>
  svg(
    `<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>`,
  );

/** eye — Preview mode */
export const iconPreview = () =>
  svg(
    `<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>`,
  );

/** bold */
export const iconBold = () =>
  svg(
    `<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>`,
  );

/** italic */
export const iconItalic = () =>
  svg(
    `<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>`,
  );

/** heading-1 */
export const iconH1 = () =>
  svg(
    `<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/>`,
  );

/** heading-2 */
export const iconH2 = () =>
  svg(
    `<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>`,
  );

/** heading-3 */
export const iconH3 = () =>
  svg(
    `<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5 0 2-2.5 2-2.5 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5 0-1.5-1.5-2-2.5-2"/>`,
  );

export const iconUndo = () =>
  svg(`<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v1"/>`);

export const iconRedo = () =>
  svg(`<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v1"/>`);

export const iconList = () =>
  svg(
    `<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>`,
  );

export const iconTask = () =>
  svg(
    `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m8 12 2 2 5-5"/>`,
  );

export const iconCode = () =>
  svg(
    `<path d="m8 9-3 3 3 3"/><path d="m16 9 3 3-3 3"/><path d="m14 5-4 14"/>`,
  );

/** link */
export const iconLink = () =>
  svg(
    `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  );

/** save */
export const iconSave = () =>
  svg(
    `<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>`,
  );

/** table-2 */
export const iconTable = () =>
  svg(
    `<path d="M12 3v18"/><path d="M3 12h18"/><rect width="18" height="18" x="3" y="3" rx="2"/>`,
  );

/** image */
export const iconImage = () =>
  svg(
    `<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>`,
  );

/** ellipsis */
export const iconMoreHorizontal = () =>
  svg(
    `<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>`,
  );

/** Label + icon for mode segment buttons */
export function modeButtonHtml(icon: string, label: string): string {
  return `<span class="zmd-btn-inner">${icon}<span class="zmd-btn-label">${label}</span></span>`;
}

export function iconOnlyButtonHtml(icon: string): string {
  return `<span class="zmd-btn-inner zmd-btn-inner-icon">${icon}</span>`;
}

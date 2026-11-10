export const MIN_ZOOM = 0.7;
export const MAX_ZOOM = 2.0;
export const DEFAULT_ZOOM = 1.0;
export const ZOOM_STEP = 0.1;

export interface ZoomMetrics {
  zoomLevel: number;
  percentageLabel: string;
  containerMaxWidthCss: string;
  mainPaddingPx: number;
  gridMinColumnPx: number;
  gridGapPx: number;
  gridTemplateColumnsCss: string;
  listRowGapPx: number;
  listRowPaddingX: number;
  listRowPaddingY: number;
  listIconSizePx: number;
  listTitleFontRem: number;
  listSubtitleFontRem: number;
}

/**
 * Clamps a zoom factor to valid UI bounds [0.7, 2.0] rounded to 2 decimals.
 */
export function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) return DEFAULT_ZOOM;
  const rounded = parseFloat(level.toFixed(2));
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rounded));
}

/**
 * Computes coordinated layout and typography metrics across grid and list views
 * without relying on non-standard CSS `zoom` (which breaks WebKitGTK grid card boxes
 * and marquee selection coordinates).
 */
export function computeZoomMetrics(rawLevel: number): ZoomMetrics {
  const zoomLevel = clampZoomLevel(rawLevel);
  const percentageLabel = `${Math.round(zoomLevel * 100)}%`;

  // At 100%, match the canonical max-w-7xl (80rem / 1280px). Above 100%, expand
  // proportionally up to 100% of available viewport width so cards can scale smoothly
  // without causing horizontal overflow.
  const containerMaxWidthCss =
    zoomLevel > 1
      ? `min(100%, ${(80 * zoomLevel).toFixed(2)}rem)`
      : "80rem";

  // Keep comfortable outer padding without starving narrow viewports at 200%.
  const paddingFactor = Math.max(0.8, Math.min(1.25, zoomLevel));
  const mainPaddingPx = Math.round(32 * paddingFactor);

  // Base min card track 256px yields 4 columns inside 1280px (with p-8..p-10 and gap-7).
  // Wrapping with min(100%, ...) prevents horizontal overflow on narrow windows at 200%.
  const gridMinColumnPx = Math.round(256 * zoomLevel);
  const gridGapPx = Math.round(28 * Math.max(0.75, Math.min(1.4, zoomLevel)));
  const gridTemplateColumnsCss = `repeat(auto-fill, minmax(min(100%, ${gridMinColumnPx}px), 1fr))`;

  // List view scales cleanly while leaving horizontal headroom for action buttons.
  const listScale = Math.max(0.75, Math.min(1.65, zoomLevel));
  const listRowGapPx = Math.round(14 * Math.max(0.8, Math.min(1.3, zoomLevel)));
  const listRowPaddingX = Math.round(24 * Math.max(0.8, Math.min(1.3, zoomLevel)));
  const listRowPaddingY = Math.round(16 * Math.max(0.8, Math.min(1.4, zoomLevel)));
  const listIconSizePx = Math.round(64 * listScale);
  const listTitleFontRem = parseFloat((1.35 * listScale).toFixed(3));
  const listSubtitleFontRem = parseFloat((0.875 * Math.max(0.85, Math.min(1.35, zoomLevel))).toFixed(3));

  return {
    zoomLevel,
    percentageLabel,
    containerMaxWidthCss,
    mainPaddingPx,
    gridMinColumnPx,
    gridGapPx,
    gridTemplateColumnsCss,
    listRowGapPx,
    listRowPaddingX,
    listRowPaddingY,
    listIconSizePx,
    listTitleFontRem,
    listSubtitleFontRem,
  };
}

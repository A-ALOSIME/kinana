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
 *
 * Grid columns intentionally avoid `1fr` max-breadth expansion so every zoom step
 * produces a strictly proportional change in rendered card dimensions even when
 * only 1-2 services exist or on smaller Linux desktop viewports.
 */
export function computeZoomMetrics(rawLevel: number): ZoomMetrics {
  const zoomLevel = clampZoomLevel(rawLevel);
  const percentageLabel = `${Math.round(zoomLevel * 100)}%`;

  const containerMaxWidthCss =
    zoomLevel > 1
      ? `min(100%, ${(80 * zoomLevel).toFixed(2)}rem)`
      : "80rem";

  const mainPaddingPx = Math.round(32 * (0.75 + 0.35 * (zoomLevel - 0.7)));

  // Fixed proportional track width clamped solely by 100% container width for tiny viewports.
  const gridMinColumnPx = Math.round(256 * zoomLevel);
  const gridGapPx = Math.round(28 * (0.75 + 0.5 * (zoomLevel - 0.7)));
  const gridTemplateColumnsCss = `repeat(auto-fill, min(100%, ${gridMinColumnPx}px))`;

  // List view scales smoothly across the full [0.7, 2.0] range without stalling between 130%-200%.
  const listScale = 0.7 + (zoomLevel - 0.7) * 0.9;
  const listRowGapPx = Math.round(14 * (0.75 + 0.45 * (zoomLevel - 0.7)));
  const listRowPaddingX = Math.round(22 * (0.8 + 0.4 * (zoomLevel - 0.7)));
  const listRowPaddingY = Math.round(14 * (0.75 + 0.55 * (zoomLevel - 0.7)));
  const listIconSizePx = Math.round(52 * zoomLevel);
  const listTitleFontRem = parseFloat((1.25 * listScale).toFixed(3));
  const listSubtitleFontRem = parseFloat((0.875 * (0.78 + 0.48 * (zoomLevel - 0.7))).toFixed(3));

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

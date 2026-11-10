export function extractTextSizeClasses(className?: string): string {
  if (!className) return "text-sm";
  const matches = className.match(
    /\b(?:[a-z]+:)*text-(?:xs|sm|base|lg|xl|2xl|3xl)\b/g
  );
  return matches && matches.length > 0 ? matches.join(" ") : "text-sm";
}

export function extractHorizontalPaddingClasses(className?: string): string {
  if (!className) return "px-4";
  const matches = className.match(
    /\b(?:[a-z]+:)*(?:px|pl|pr|ps|pe)-(?:\d+(?:\.\d+)?|\[[^\]]+\])\b/g
  );
  return matches && matches.length > 0 ? matches.join(" ") : "px-4";
}

export const defaultCardStyle = () => ({
  mode: 'embed',
  background: 'none',
  titleColor: '#ffffff',
  textColor: '#e4e9f4',
  overlay: 0.66,
});
export function validateCardStyle(style) {
  if (
    !style ||
    typeof style !== 'object' ||
    Array.isArray(style) ||
    Object.keys(style).some(
      (k) => !['mode', 'background', 'titleColor', 'textColor', 'overlay'].includes(k),
    ) ||
    !['embed', 'image'].includes(style.mode) ||
    (!['none', 'storm'].includes(style.background) &&
      !/^[a-f0-9]{64}$/.test(style.background ?? '')) ||
    !/^#[\da-f]{6}$/i.test(style.titleColor ?? '') ||
    !/^#[\da-f]{6}$/i.test(style.textColor ?? '') ||
    !Number.isFinite(style.overlay) ||
    style.overlay < 0.35 ||
    style.overlay > 0.9
  )
    throw new Error('Invalid welcome card design.');
  return { ...style };
}

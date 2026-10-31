import { createHash } from 'node:crypto';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export function validateMessageImage(image) {
  const bad = () => {
    throw new Error('اختر صورة PNG أو JPEG أو WebP أو GIF بحجم لا يتجاوز 2MB.');
  };
  if (
    !image ||
    typeof image !== 'object' ||
    Array.isArray(image) ||
    Object.keys(image).some((k) => !['type', 'data', 'sha256'].includes(k))
  )
    bad();
  const extension = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }[image.type];
  if (
    !extension ||
    typeof image.data !== 'string' ||
    image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    /[^A-Za-z0-9+/=]/.test(image.data)
  )
    bad();
  const bytes = Buffer.from(image.data, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== image.data)
    bad();
  const valid =
    image.type === 'image/png'
      ? bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : image.type === 'image/jpeg'
        ? bytes.length >= 4 && bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
        : image.type === 'image/webp'
          ? bytes.length >= 16 &&
            bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP'
          : bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  if (!valid) bad();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (image.sha256 !== sha256) throw new Error('تغيّرت الصورة؛ اخترها مجددًا وأعد المعاينة.');
  return {
    bytes,
    info: { name: 'cortex-image.' + extension, type: image.type, size: bytes.length, sha256 },
  };
}

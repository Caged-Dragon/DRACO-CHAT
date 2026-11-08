// Shrinks big photos before upload: faster sends, less mobile data, less
// storage. Animated GIFs and SVGs are left untouched, and if compression
// wouldn't actually make the file smaller the original is kept.
export async function compressImage(file, { maxDim = 1600, quality = 0.82 } = {}) {
  try {
    if (!file || !file.type || !file.type.startsWith('image/')) return file;
    if (/gif|svg/i.test(file.type)) return file;
    if (typeof createImageBitmap !== 'function') return file;

    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    // Already small enough: don't re-encode (avoids needless quality loss)
    if (scale === 1 && file.size < 350_000) {
      bitmap.close?.();
      return file;
    }

    const keepPng = file.type === 'image/png';
    const outType = keepPng ? 'image/png' : 'image/jpeg';
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!keepPng) {
      ctx.fillStyle = '#ffffff'; // JPEG has no transparency
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outType, quality));
    if (!blob || blob.size >= file.size) return file;

    const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
    const ext = keepPng ? 'png' : 'jpg';
    return new File([blob], `${base}.${ext}`, { type: outType, lastModified: Date.now() });
  } catch {
    return file; // never block an upload because compression failed
  }
}

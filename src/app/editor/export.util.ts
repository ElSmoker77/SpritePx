import { EditorStore } from './editor.store';

export function exportSpritesheet(store: EditorStore, columns = 0) {
  const s = store.state();
  const frames = store.frames();
  const w = s.w, h = s.h;
  const n = frames.length;

  const cols = columns > 0 ? columns : n; // por defecto en fila
  const rows = Math.ceil(n / cols);

  const canvas = document.createElement('canvas');
  canvas.width = cols * w;
  canvas.height = rows * h;

  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const img = ctx.createImageData(canvas.width, canvas.height);
  const data = new Uint32Array(img.data.buffer);

  for (let i = 0; i < n; i++) {
    const fx = (i % cols) * w;
    const fy = Math.floor(i / cols) * h;
    const frame = frames[i];

    for (let y = 0; y < h; y++) {
      const rowStart = (fy + y) * canvas.width + fx;
      const srcStart = y * w;
      for (let x = 0; x < w; x++) {
        data[rowStart + x] = frame[srcStart + x];
      }
    }
  }

  ctx.putImageData(img, 0, 0);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'spritesheet.png';
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
}

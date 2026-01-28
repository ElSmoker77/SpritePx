// editor.store.ts
import { Injectable, signal, computed } from '@angular/core';

/**
 * Temas disponibles para la interfaz.
 */
export type TemaUI = 'oscuro' | 'claro' | 'gris' | 'verde';

/**
 * Herramientas disponibles.
 * 1: lápiz
 * 2: goma
 * 3: cuentagotas
 * 4: relleno
 * 5: lazo (selección libre)
 */
export type Tool = 'pencil' | 'eraser' | 'picker' | 'fill' | 'lasso';

/**
 * Estado visible del editor (UI + configuración).
 */
export interface EditorState {
  tema: TemaUI;

  // Tamaño del lienzo (en píxeles reales del sprite)
  w: number;
  h: number;

  // Zoom visual (cuántos píxeles de pantalla por 1 píxel del sprite)
  zoom: number;

  showGrid: boolean;
  fps: number;

  tool: Tool;
  color: number; // 0xAARRGGBB

  // Tamaño del pincel/goma (radio en píxeles del sprite)
  brushRadius: number; // 0 = 1 píxel, 1 = 3x3, 2 = 5x5, etc.

  onionPrev: boolean;
  onionNext: boolean;
  onionOpacity: number; // 0..1
}

function makeFrame(w: number, h: number, fill: number = 0x00000000): Uint32Array {
  const arr: Uint32Array = new Uint32Array(w * h);
  arr.fill(fill);
  return arr;
}

type Point = { x: number; y: number };

type ClipboardData = {
  w: number;
  h: number;
  pixels: Uint32Array;
};

type UndoSnapshot = { frames: Uint32Array[]; active: number };

/**
 * Store central del editor.
 * Guarda estado, frames y lógica común (selección, pegar, undo, etc.).
 */
@Injectable({ providedIn: 'root' })
export class EditorStore {
  // =========================
  // Estado principal del editor (UI + config)
  // =========================
  state = signal<EditorState>({
    tema: 'oscuro',

    w: 32,
    h: 32,
    zoom: 12,
    showGrid: true,
    fps: 12,

    tool: 'pencil',
    color: 0xff000000,
    brushRadius: 0,

    onionPrev: true,
    onionNext: true,
    onionOpacity: 0.25,
  });

  // =========================
  // Frames / animación
  // =========================
  frames = signal<Uint32Array[]>([makeFrame(32, 32)]);
  active = signal<number>(0);

  activeFrame = computed(() => this.frames()[this.active()]);
  prevFrame = computed(() => {
    const i = this.active() - 1;
    return i >= 0 ? this.frames()[i] : null;
  });
  nextFrame = computed(() => {
    const i = this.active() + 1;
    return i < this.frames().length ? this.frames()[i] : null;
  });

  // =========================
  // Mensajes/avisos para UI
  // =========================
  uiAviso = signal<string | null>(null);
  setAviso(msg: string | null) {
    this.uiAviso.set(msg);
  }

  // =========================
  // Imagen FUENTE (import grande)
  // =========================
  /**
   * La "Fuente" es una imagen grande importada (puede ser enorme).
   * NO cambia el tamaño del lienzo del editor.
   * La usamos como material para recortar regiones y convertirlas en frames.
   */
  sourceCanvas = signal<HTMLCanvasElement | null>(null);
  sourceW = signal<number>(0);
  sourceH = signal<number>(0);

  // Viewport sobre la fuente (zoom + pan)
  sourceZoom = signal<number>(1);
  sourcePanX = signal<number>(0);
  sourcePanY = signal<number>(0);

  // Selección dentro de la fuente (en pixeles de la imagen fuente)
  sourceSel = signal<{ x: number; y: number; w: number; h: number } | null>(null);

  // =========================
  // Mouse (para pegar donde está el cursor)
  // =========================
  mousePixel = signal<Point>({ x: 0, y: 0 });
  setMousePixel(x: number, y: number) {
    this.mousePixel.set({ x, y });
  }

  // =========================
  // Selección (Lasso)
  // =========================
  selectionPath = signal<Point[] | null>(null);
  selectionMask = signal<Set<number> | null>(null);
  isSelecting = signal(false);

  // =========================
  // “Capa flotante” para mover selección
  // =========================
  moving = signal(false);
  moveStart = signal<Point | null>(null);
  moveDx = signal(0);
  moveDy = signal(0);
  floatingPixels = signal<Map<number, number> | null>(null); // idx -> color
  baseWhileMoving = signal<Uint32Array | null>(null);

  // =========================
  // Clipboard interno (CTRL+C / CTRL+V)
  // =========================
  clipboard = signal<ClipboardData | null>(null);

  // =========================
  // Undo (CTRL+Z multi)
  // =========================
  private undoStack: UndoSnapshot[] = [];
  private readonly maxUndo = 60;

  pushUndo() {
    const framesCopy = this.frames().map(fr => new Uint32Array(fr));
    const snap: UndoSnapshot = { frames: framesCopy, active: this.active() };
    this.undoStack.push(snap);
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.frames.set(snap.frames.map(fr => new Uint32Array(fr)));
    this.active.set(Math.min(snap.active, this.frames().length - 1));
    this.clearSelection();
  }

  // =========================
  // UI setters/toggles
  // =========================
  setTema(tema: TemaUI) {
    this.state.update(s => ({ ...s, tema }));
  }
  setTool(tool: Tool) {
    this.state.update(s => ({ ...s, tool }));
  }

  /**
   * ✅ IMPORTANTE:
   * setColor NO debe registrar en "recientes".
   * (Elegir/probar colores NO cuenta como "usado pintando".)
   */
  setColor(color: number) {
    this.state.update(s => ({ ...s, color }));
  }

  setZoom(zoom: number) {
    this.state.update(s => ({ ...s, zoom }));
  }
  toggleGrid() {
    this.state.update(s => ({ ...s, showGrid: !s.showGrid }));
  }
  toggleOnionPrev() {
    this.state.update(s => ({ ...s, onionPrev: !s.onionPrev }));
  }
  toggleOnionNext() {
    this.state.update(s => ({ ...s, onionNext: !s.onionNext }));
  }
  setOnionOpacity(v: number) {
    this.state.update(s => ({ ...s, onionOpacity: v }));
  }
  setFps(fps: number) {
    this.state.update(s => ({ ...s, fps }));
  }

  setBrushRadius(r: number) {
    const rr = Math.max(0, Math.min(20, Math.floor(r)));
    this.state.update(s => ({ ...s, brushRadius: rr }));
  }
  incBrushRadius() {
    this.setBrushRadius(this.state().brushRadius + 1);
  }
  decBrushRadius() {
    this.setBrushRadius(this.state().brushRadius - 1);
  }

  // =========================
  // Tamaño del lienzo (plantilla dibujable)
  // =========================
  /**
   * Cambia el tamaño del lienzo del editor (W/H) para TODOS los frames.
   * - Mantiene el contenido centrado.
   * - Rellena con transparente.
   * - Limita a tamaño "razonable" (ajusta si quieres).
   */
  setCanvasSize(newW: number, newH: number) {
    const MIN = 8;
    const MAX = 512; // <- si quieres, súbelo a 1024

    const w = Math.max(MIN, Math.min(MAX, Math.floor(newW)));
    const h = Math.max(MIN, Math.min(MAX, Math.floor(newH)));

    const s = this.state();
    if (w === s.w && h === s.h) return;

    this.pushUndo();

    const oldW = s.w;
    const oldH = s.h;

    const offX = Math.floor((w - oldW) / 2);
    const offY = Math.floor((h - oldH) / 2);

    const resized = this.frames().map(fr => {
      const out = makeFrame(w, h, 0x00000000);

      for (let y = 0; y < oldH; y++) {
        for (let x = 0; x < oldW; x++) {
          const col = fr[y * oldW + x];
          const a = (col >>> 24) & 0xff;
          if (a === 0) continue;

          const nx = x + offX;
          const ny = y + offY;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

          out[ny * w + nx] = col;
        }
      }

      return out;
    });

    this.frames.set(resized);
    this.state.update(st => ({ ...st, w, h }));
    this.clearSelection();
    this.setAviso(`Lienzo cambiado: ${oldW}x${oldH} → ${w}x${h}`);
  }

  // =========================
  // Frames
  // =========================
  addFrame() {
    this.pushUndo();
    const s = this.state();
    const blank = makeFrame(s.w, s.h);
    this.frames.update(f => [...f, blank]);
    this.active.set(this.frames().length - 1);
  }

  duplicateFrame() {
    this.pushUndo();
    const src = this.activeFrame();
    const clone = new Uint32Array(src);
    this.frames.update(f => [...f, clone]);
    this.active.set(this.frames().length - 1);
  }

  deleteFrame() {
    const f = this.frames();
    if (f.length <= 1) return;
    this.pushUndo();
    const idx = this.active();
    const nf = f.slice(0, idx).concat(f.slice(idx + 1));
    this.frames.set(nf);
    this.active.set(Math.max(0, idx - 1));
    this.clearSelection();
  }

  // =========================
  // Paletas de color
  // - Recientes: se auto-llenan SOLO al pintar (máx 20)
  // - Importada: se carga desde archivo (gpl/json)
  // =========================
  paletteMode = signal<'recientes' | 'importada'>('recientes');

  // Recientes (máx 20) — SOLO “usados pintando”
  recentColors = signal<number[]>([0xff000000]);
  private readonly maxRecentColors = 20;

  // Importada
  importedPalette = signal<number[]>([]);

  setPaletteMode(mode: 'recientes' | 'importada') {
    this.paletteMode.set(mode);
  }

  setImportedPalette(colors: number[]) {
    const clean = colors.filter(c => Number.isFinite(c)).slice(0, 256);
    this.importedPalette.set(clean);
    if (clean.length) this.paletteMode.set('importada');
  }

  /**
   * Lista que muestra la UI según el modo actual
   */
  paletteColors = computed(() => {
    return this.paletteMode() === 'recientes' ? this.recentColors() : this.importedPalette();
  });

  /**
   * ✅ Para que otras operaciones (ej: fill) registren “usado”.
   * (stamp registra automáticamente cuando corresponde)
   */
  registrarColorUsado(color: number) {
    this.pushRecentColorUsado(color);
  }

  private pushRecentColorUsado(color: number) {
    const a = (color >>> 24) & 0xff;
    if (a === 0) return; // no registrar transparentes

    const list = this.recentColors();
    const next = [color, ...list.filter(c => c !== color)].slice(0, this.maxRecentColors);
    this.recentColors.set(next);
  }

  // =========================
  // Pintado con “stamp” (pincel/goma)
  // =========================
  stamp(x: number, y: number, color: number) {
    const s = this.state();
    const r = s.brushRadius;

    const frames = this.frames();
    const a = this.active();
    const frame = frames[a];
    const out = new Uint32Array(frame);

    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue;
        out[ny * s.w + nx] = color;
      }
    }

    const nf = frames.slice();
    nf[a] = out;
    this.frames.set(nf);

    // ✅ REGISTRA SOLO si realmente estás PINTANDO con lápiz
    // (Goma / picker / buscar colores NO debería tocar “recientes”)
    if (this.state().tool === 'pencil') {
      this.pushRecentColorUsado(color);
    }
  }

  // =========================
  // Selección: iniciar / actualizar / finalizar lasso
  // =========================
  startLasso(x: number, y: number) {
    this.selectionPath.set([{ x, y }]);
    this.selectionMask.set(null);
    this.isSelecting.set(true);
  }

  pushLassoPoint(x: number, y: number) {
    const path = this.selectionPath();
    if (!path) return;
    path.push({ x, y });
    this.selectionPath.set([...path]);
  }

  finishLasso() {
    const path = this.selectionPath();
    if (!path || path.length < 3) {
      this.clearSelection();
      return;
    }

    const s = this.state();
    const mask = new Set<number>();

    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (this.pointInPolygon(x, y, path)) {
          mask.add(y * s.w + x);
        }
      }
    }

    this.selectionMask.set(mask.size ? mask : null);
    this.isSelecting.set(false);
  }

  clearSelection() {
    this.selectionPath.set(null);
    this.selectionMask.set(null);
    this.isSelecting.set(false);
    this.stopMoving();
  }

  // =========================
  // Mover selección (SHIFT + arrastrar)
  // =========================
  startMoveSelection(startX: number, startY: number) {
    const mask = this.selectionMask();
    if (!mask || mask.size === 0) return;

    this.pushUndo();

    const s = this.state();
    const frame = this.activeFrame();

    const base = new Uint32Array(frame);
    const floatMap = new Map<number, number>();

    for (const idx of mask) {
      const col = frame[idx];
      floatMap.set(idx, col);
      base[idx] = 0x00000000;
    }

    this.baseWhileMoving.set(base);
    this.floatingPixels.set(floatMap);

    this.moving.set(true);
    this.moveStart.set({ x: startX, y: startY });
    this.moveDx.set(0);
    this.moveDy.set(0);
  }

  updateMoveSelection(currX: number, currY: number) {
    if (!this.moving()) return;
    const start = this.moveStart();
    if (!start) return;
    this.moveDx.set(currX - start.x);
    this.moveDy.set(currY - start.y);
  }

  endMoveSelection() {
    if (!this.moving()) return;

    const s = this.state();
    const base = this.baseWhileMoving();
    const floatMap = this.floatingPixels();
    const mask = this.selectionMask();
    if (!base || !floatMap || !mask) {
      this.stopMoving();
      return;
    }

    const dx = this.moveDx();
    const dy = this.moveDy();

    const out = new Uint32Array(base);
    const newMask = new Set<number>();

    for (const [idx, col] of floatMap.entries()) {
      const ox = idx % s.w;
      const oy = Math.floor(idx / s.w);

      const nx = ox + dx;
      const ny = oy + dy;

      if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue;

      const nidx = ny * s.w + nx;
      out[nidx] = col;
      newMask.add(nidx);
    }

    this.replaceActiveFrame(out);
    this.selectionMask.set(newMask.size ? newMask : null);
    this.stopMoving();
  }

  stopMoving() {
    this.moving.set(false);
    this.moveStart.set(null);
    this.moveDx.set(0);
    this.moveDy.set(0);
    this.floatingPixels.set(null);
    this.baseWhileMoving.set(null);
  }

  // =========================
  // Copiar / Pegar
  // =========================
  copySelection() {
    const mask = this.selectionMask();
    if (!mask || mask.size === 0) return;

    const s = this.state();
    const frame = this.activeFrame();

    const { minX, minY, maxX, maxY } = this.boundsFromMask(mask, s.w);
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;

    const pixels = new Uint32Array(cw * ch);
    pixels.fill(0x00000000);

    for (const idx of mask) {
      const x = idx % s.w;
      const y = Math.floor(idx / s.w);
      const cx = x - minX;
      const cy = y - minY;
      pixels[cy * cw + cx] = frame[idx];
    }

    this.clipboard.set({ w: cw, h: ch, pixels });
    this.setAviso('Selección copiada (Ctrl+V para pegar).');
  }

  pasteClipboard(atX: number, atY: number) {
    const clip = this.clipboard();
    if (!clip) return;

    this.pushUndo();

    const s = this.state();
    const frame = this.activeFrame();
    const out = new Uint32Array(frame);
    const newMask = new Set<number>();

    for (let y = 0; y < clip.h; y++) {
      for (let x = 0; x < clip.w; x++) {
        const col = clip.pixels[y * clip.w + x];
        const a = (col >>> 24) & 0xff;
        if (a === 0) continue;

        const nx = atX + x;
        const ny = atY + y;
        if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue;

        const nidx = ny * s.w + nx;
        out[nidx] = col;
        newMask.add(nidx);
      }
    }

    this.replaceActiveFrame(out);
    this.selectionMask.set(newMask.size ? newMask : null);
  }

  pasteClipboardAtMouse() {
    const clip = this.clipboard();
    if (!clip) return;

    const m = this.mousePixel();
    const atX = m.x - Math.floor(clip.w / 2);
    const atY = m.y - Math.floor(clip.h / 2);
    this.pasteClipboard(atX, atY);
  }

  deleteSelectionPixels() {
    const mask = this.selectionMask();
    if (!mask || mask.size === 0) return;

    this.pushUndo();

    const frame = this.activeFrame();
    const out = new Uint32Array(frame);
    for (const idx of mask) out[idx] = 0x00000000;

    this.replaceActiveFrame(out);
  }

  // =========================
  // Importar imagen (al editor, ajusta al frame actual)
  // =========================
  async importarImagen(img: HTMLImageElement, comoNuevo: boolean) {
    const s = this.state();
    const W = s.w,
      H = s.h;

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);

    if (img.width > W || img.height > H) {
      this.setAviso(
        `Aviso: la imagen (${img.width}x${img.height}) es más grande que el lienzo (${W}x${H}). Se recortará.`
      );
    } else {
      this.setAviso(null);
    }

    const src = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const out = makeFrame(W, H, 0x00000000);

    const offsetX = Math.floor((W - img.width) / 2);
    const offsetY = Math.floor((H - img.height) / 2);

    const copyW = Math.min(W, img.width);
    const copyH = Math.min(H, img.height);

    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        const dx = x + offsetX;
        const dy = y + offsetY;
        if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;

        const si = (y * img.width + x) * 4;
        const r = src[si + 0];
        const g = src[si + 1];
        const b = src[si + 2];
        const a = src[si + 3];

        out[dy * W + dx] = (a << 24) | (r << 16) | (g << 8) | b;
      }
    }

    this.pushUndo();

    if (comoNuevo) {
      this.frames.update(f => [...f, out]);
      this.active.set(this.frames().length - 1);
    } else {
      this.replaceActiveFrame(out);
    }

    this.clearSelection();
  }

  // =========================
  // Fuente: importar + viewport + selección + recorte
  // =========================
  async importarFuente(img: HTMLImageElement) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;

    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);

    this.sourceCanvas.set(c);
    this.sourceW.set(img.width);
    this.sourceH.set(img.height);

    this.sourceZoom.set(1);
    this.sourcePanX.set(0);
    this.sourcePanY.set(0);
    this.sourceSel.set(null);

    this.setAviso(`Fuente importada: ${img.width}x${img.height}. Selecciona un área para recortar.`);
  }

  setSourceZoom(z: number) {
    const zz = Math.max(0.05, Math.min(64, z));
    this.sourceZoom.set(zz);
  }
  setSourcePan(px: number, py: number) {
    this.sourcePanX.set(px);
    this.sourcePanY.set(py);
  }
  setSourceSel(sel: { x: number; y: number; w: number; h: number } | null) {
    this.sourceSel.set(sel);
  }

  recortarFuenteAFrame(comoNuevo: boolean) {
    const src = this.sourceCanvas();
    const sel = this.sourceSel();
    if (!src) {
      this.setAviso('No hay Fuente cargada. Importa una imagen como Fuente primero.');
      return;
    }
    if (!sel || sel.w <= 0 || sel.h <= 0) {
      this.setAviso('Selecciona un rectángulo en la Fuente para recortar.');
      return;
    }

    const s = this.state();
    const W = s.w,
      H = s.h;

    const SW = this.sourceW();
    const SH = this.sourceH();

    const sx = Math.max(0, Math.min(SW - 1, Math.floor(sel.x)));
    const sy = Math.max(0, Math.min(SH - 1, Math.floor(sel.y)));
    const sw = Math.max(1, Math.min(SW - sx, Math.floor(sel.w)));
    const sh = Math.max(1, Math.min(SH - sy, Math.floor(sel.h)));

    const temp = document.createElement('canvas');
    temp.width = sw;
    temp.height = sh;
    const tctx = temp.getContext('2d')!;
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);

    const outC = document.createElement('canvas');
    outC.width = W;
    outC.height = H;
    const octx = outC.getContext('2d')!;
    octx.imageSmoothingEnabled = false;
    octx.clearRect(0, 0, W, H);
    octx.drawImage(temp, 0, 0, sw, sh, 0, 0, W, H);

    const data = octx.getImageData(0, 0, W, H).data;
    const out = new Uint32Array(W * H);

    for (let i = 0; i < out.length; i++) {
      const p = i * 4;
      const r = data[p + 0];
      const g = data[p + 1];
      const b = data[p + 2];
      const a = data[p + 3];
      out[i] = (a << 24) | (r << 16) | (g << 8) | b;
    }

    this.pushUndo();

    if (comoNuevo) {
      this.frames.update(f => [...f, out]);
      this.active.set(this.frames().length - 1);
    } else {
      const frames = this.frames();
      const a = this.active();
      const nf = frames.slice();
      nf[a] = out;
      this.frames.set(nf);
    }

    this.clearSelection();
    this.setAviso(`Recorte aplicado (${sw}x${sh} → ${W}x${H}).`);
  }

  // =========================
  // Helpers internos
  // =========================
  private replaceActiveFrame(newFrame: Uint32Array) {
    const frames = this.frames();
    const a = this.active();
    const nf = frames.slice();
    nf[a] = newFrame;
    this.frames.set(nf);
  }

  /**
   * Ray casting: punto dentro de polígono (lasso).
   */
  private pointInPolygon(x: number, y: number, poly: Point[]) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x,
        yi = poly[i].y;
      const xj = poly[j].x,
        yj = poly[j].y;

      const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private boundsFromMask(mask: Set<number>, width: number) {
    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;

    for (const idx of mask) {
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    return { minX, minY, maxX, maxY };
  }

  /**
   * Recorta TODOS los fotogramas al rectángulo mínimo alpha>0 (considerando TODOS los frames).
   */
  autocropTodos(padding: number = 0, centrar: boolean = false) {
    const s = this.state();
    const W = s.w;
    const H = s.h;
    const frames = this.frames();

    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;

    for (const fr of frames) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const v = fr[y * W + x];
          const a = (v >>> 24) & 0xff;
          if (a === 0) continue;

          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!isFinite(minX)) {
      this.setAviso('No hay píxeles dibujados para recortar.');
      return;
    }

    const pad = Math.max(0, Math.floor(padding));
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(W - 1, maxX + pad);
    maxY = Math.min(H - 1, maxY + pad);

    const newW = maxX - minX + 1;
    const newH = maxY - minY + 1;

    this.pushUndo();

    let recortados: Uint32Array[] = frames.map(fr => {
      const out: Uint32Array = new Uint32Array(newW * newH);
      out.fill(0x00000000);

      for (let y = 0; y < newH; y++) {
        for (let x = 0; x < newW; x++) {
          out[y * newW + x] = fr[(minY + y) * W + (minX + x)];
        }
      }
      return out;
    });

    if (centrar) {
      recortados = recortados.map(fr => this.centrarFrame(fr, newW, newH));
    }

    this.frames.set(recortados);
    this.state.update(st => ({ ...st, w: newW, h: newH }));
    this.clearSelection();

    this.setAviso(`Autocrop listo${centrar ? ' y centrado' : ''}: ${W}x${H} → ${newW}x${newH}`);
  }

  /**
   * Centra el contenido (alpha>0) dentro de un frame sin cambiar su tamaño.
   * Devuelve un NUEVO Uint32Array.
   */
  private centrarFrame(frame: Uint32Array, W: number, H: number): Uint32Array {
    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = frame[y * W + x];
        const a = (v >>> 24) & 0xff;
        if (a === 0) continue;

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (!isFinite(minX)) return frame;

    const contentW = maxX - minX + 1;
    const contentH = maxY - minY + 1;

    const targetMinX = Math.floor((W - contentW) / 2);
    const targetMinY = Math.floor((H - contentH) / 2);

    const dx = targetMinX - minX;
    const dy = targetMinY - minY;

    if (dx === 0 && dy === 0) return frame;

    const out = new Uint32Array(W * H);
    out.fill(0x00000000);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = frame[y * W + x];
        const a = (v >>> 24) & 0xff;
        if (a === 0) continue;

        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;

        out[ny * W + nx] = v;
      }
    }

    return out;
  }

  /**
   * Opción extra: centra el contenido del frame ACTIVO sin recortar.
   */
  centrarFrameActivo() {
    const s = this.state();
    const W = s.w,
      H = s.h;
    const frame = this.activeFrame();

    this.pushUndo();
    const out = this.centrarFrame(frame, W, H);
    this.replaceActiveFrame(out);

    this.clearSelection();
    this.setAviso('Contenido centrado en el fotograma activo.');
  }
}

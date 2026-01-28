import { Component, ElementRef, ViewChild, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorStore } from './editor.store';

@Component({
  selector: 'pixel-canvas',
  standalone: true,
  imports: [CommonModule],
  template: `
    <canvas #c
      (pointerdown)="onDown($event)"
      (pointermove)="onMove($event)"
      (pointerup)="onUp()"
      (pointerleave)="onUp()"
      style="touch-action:none; border:1px solid #333;"></canvas>
  `,
})
export class PixelCanvasComponent {
  @ViewChild('c', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  // drawing: true cuando estamos “pintando” (no lasso ni mover)
  private drawing = false;

  // strokeUndoPushed: evita pushUndo por cada pixel al arrastrar
  private strokeUndoPushed = false;

  constructor(public store: EditorStore) {
    // Render reactivo cuando cambie el estado relevante
    effect(() => this.render());
  }

  // =========================
  // Atajos de teclado (estilo Piskel)
  // =========================
  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    // Evita que el navegador haga cosas raras con algunas teclas
    // (por ejemplo, en algunos layouts, ctrl+/- hace zoom del navegador)
    const isMac = navigator.userAgent.includes('Mac');
    const ctrlOrMeta = e.ctrlKey || (isMac && e.metaKey);

    // --- Herramientas 1..5 (sin Ctrl) ---
    if (!ctrlOrMeta) {
      if (e.key === '1') this.store.setTool('pencil');
      if (e.key === '2') this.store.setTool('eraser');
      if (e.key === '3') this.store.setTool('picker');
      if (e.key === '4') this.store.setTool('fill');
      if (e.key === '5') this.store.setTool('lasso');

      // Tamaño de pincel/goma con + y -
      // Teclado normal: '-' , '+' suele venir como '=' con Shift en muchos layouts
      // NumPad: 'Add' / 'Subtract'
      if (e.key === '-' || e.key === 'Subtract') {
        e.preventDefault();
        this.store.decBrushRadius();
      }
      if (e.key === '+' || e.key === '=' || e.key === 'Add') {
        e.preventDefault();
        this.store.incBrushRadius();
      }
    }

    // --- CTRL/CMD + Z (deshacer) ---
    if (ctrlOrMeta && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      this.store.undo();
      return;
    }

    // --- CTRL/CMD + C ---
    if (ctrlOrMeta && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      this.store.copySelection();
      return;
    }

    // --- CTRL/CMD + V (pegar donde está el mouse) ---
    if (ctrlOrMeta && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      this.store.pasteClipboardAtMouse();
      return;
    }

    // Delete: borrar píxeles seleccionados
    if (e.key === 'Delete') {
      e.preventDefault();
      this.store.deleteSelectionPixels();
      return;
    }

    // Escape: limpiar selección
    if (e.key === 'Escape') {
      e.preventDefault();
      this.store.clearSelection();
      return;
    }
  }

  // =========================
  // Render del canvas
  // =========================
  private render() {
    const c = this.canvasRef.nativeElement;
    const s = this.store.state();
    const w = s.w, h = s.h, z = s.zoom;

    // Ajustamos tamaño del canvas en pixeles reales de pantalla
    c.width = w * z;
    c.height = h * z;

    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // Limpiar
    ctx.clearRect(0, 0, c.width, c.height);

    // Fondo tipo “transparencia” (checkerboard), adaptado al tema
    this.drawCheckerboard(ctx, c.width, c.height, Math.max(4, Math.floor(z / 2)));

    // Onion skin (prev/next)
    const prev = this.store.prevFrame();
    const next = this.store.nextFrame();
    if (s.onionPrev && prev) this.drawFrame(ctx, prev, w, h, z, s.onionOpacity);
    if (s.onionNext && next) this.drawFrame(ctx, next, w, h, z, s.onionOpacity);

    // Si estamos moviendo: dibujamos base + capa flotante
    if (this.store.moving()) {
      const base = this.store.baseWhileMoving();
      const floating = this.store.floatingPixels();
      if (base) this.drawFrame(ctx, base, w, h, z, 1);
      if (floating) this.drawFloating(ctx, floating, z, this.store.moveDx(), this.store.moveDy());
    } else {
      // Frame activo normal
      this.drawFrame(ctx, this.store.activeFrame(), w, h, z, 1);
    }

    // Grid
    if (s.showGrid && z >= 6) {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;

      for (let x = 0; x <= w; x++) {
        ctx.beginPath();
        ctx.moveTo(x * z + 0.5, 0);
        ctx.lineTo(x * z + 0.5, h * z);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * z + 0.5);
        ctx.lineTo(w * z, y * z + 0.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Selección (línea + highlight)
    this.drawSelection(ctx, z);

    // Cursor del pincel: solo cuando NO estás moviendo y NO estás lasso
    if (!this.store.moving() && !this.store.isSelecting()) {
      this.drawBrushCursor(ctx, z);
    }
  }

  /**
   * Dibuja un frame ARGB (Uint32Array) en el canvas
   */
  private drawFrame(
    ctx: CanvasRenderingContext2D,
    frame: Uint32Array,
    w: number,
    h: number,
    z: number,
    alpha: number
  ) {
    ctx.globalAlpha = alpha;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = frame[y * w + x];
        const a = (v >>> 24) & 0xff;
        if (a === 0) continue;

        const r = (v >>> 16) & 0xff;
        const g = (v >>> 8) & 0xff;
        const b = v & 0xff;

        ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
        ctx.fillRect(x * z, y * z, z, z);
      }
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Dibuja la “capa flotante” desplazada (cuando mueves selección)
   */
  private drawFloating(
    ctx: CanvasRenderingContext2D,
    floating: Map<number, number>,
    z: number,
    dx: number,
    dy: number
  ) {
    const s = this.store.state();

    for (const [idx, col] of floating.entries()) {
      const a = (col >>> 24) & 0xff;
      if (!a) continue;

      const ox = idx % s.w;
      const oy = Math.floor(idx / s.w);

      const nx = ox + dx;
      const ny = oy + dy;
      if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue;

      const r = (col >>> 16) & 0xff;
      const g = (col >>> 8) & 0xff;
      const b = col & 0xff;

      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      ctx.fillRect(nx * z, ny * z, z, z);
    }
  }

  /**
   * Dibuja la selección: línea tipo “hormiguitas” + sombreado en mask
   */
  private drawSelection(ctx: CanvasRenderingContext2D, z: number) {
    const path = this.store.selectionPath();
    const mask = this.store.selectionMask();

    ctx.save();

    // Línea del lasso (cerramos el polígono para que se vea “completo”)
    if (path && path.length > 1) {
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(path[0].x * z, path[0].y * z);
      for (const p of path) ctx.lineTo(p.x * z, p.y * z);
      // Cerrar al inicio (mejora visual)
      ctx.lineTo(path[0].x * z, path[0].y * z);
      ctx.stroke();
    }

    // Sombreado dentro de la selección
    if (mask && mask.size) {
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#ffffff';
      const w = this.store.state().w;

      for (const idx of mask) {
        const x = idx % w;
        const y = Math.floor(idx / w);
        ctx.fillRect(x * z, y * z, z, z);
      }
    }

    ctx.restore();
  }

  /**
   * Dibuja un rectángulo guía del pincel en la posición del mouse
   */
  private drawBrushCursor(ctx: CanvasRenderingContext2D, z: number) {
    const s = this.store.state();
    const m = this.store.mousePixel();
    const r = s.brushRadius;

    // Si el mouse está fuera del lienzo, no dibujamos cursor
    if (m.x < 0 || m.y < 0 || m.x >= s.w || m.y >= s.h) return;

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(
      (m.x - r) * z + 0.5,
      (m.y - r) * z + 0.5,
      (2 * r + 1) * z,
      (2 * r + 1) * z
    );
    ctx.restore();
  }

  // =========================
  // Eventos de mouse/puntero
  // =========================
  onDown(e: PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const { x, y } = this.eventToPixel(e);
    this.store.setMousePixel(x, y);

    // SHIFT + click izquierdo: mover selección si existe
    if (e.shiftKey && e.button === 0) {
      this.store.startMoveSelection(x, y);
      return;
    }

    // Si es lazo: iniciamos selección
    if (this.store.state().tool === 'lasso') {
      this.store.startLasso(x, y);
      return;
    }

    // Caso normal: pintamos
    this.drawing = true;
    this.strokeUndoPushed = false;
    this.applyTool(x, y);
  }

  onMove(e: PointerEvent) {
    const { x, y } = this.eventToPixel(e);
    this.store.setMousePixel(x, y);

    // Si estamos moviendo selección
    if (this.store.moving()) {
      this.store.updateMoveSelection(x, y);
      return;
    }

    // Si estamos dibujando lazo
    if (this.store.isSelecting()) {
      this.store.pushLassoPoint(x, y);
      return;
    }

    // Si estamos pintando
    if (!this.drawing) return;
    this.applyTool(x, y);
  }

  onUp() {
    // Si estábamos moviendo, commit
    if (this.store.moving()) {
      this.store.endMoveSelection();
      return;
    }

    // Si estábamos seleccionando lazo, finalizar
    if (this.store.isSelecting()) {
      this.store.finishLasso();
    }

    this.drawing = false;
    this.strokeUndoPushed = false;
  }

  // =========================
  // Aplicar herramienta actual
  // =========================
  private applyTool(x: number, y: number) {
    const s = this.store.state();
    const tool = s.tool;

    // Para pintar/borrar, hacemos undo una vez al iniciar el “stroke”
    const beginStroke = () => {
      if (!this.strokeUndoPushed) {
        this.store.pushUndo();
        this.strokeUndoPushed = true;
      }
    };

    if (tool === 'pencil') {
      beginStroke();
      this.store.stamp(x, y, s.color);
      return;
    }

    if (tool === 'eraser') {
      beginStroke();
      this.store.stamp(x, y, 0x00000000);
      return;
    }

    if (tool === 'picker') {
      const frame = this.store.activeFrame();
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
      this.store.setColor(frame[y * s.w + x]);
      return;
    }

    if (tool === 'fill') {
      // fill es una operación grande: guardamos undo una vez
      this.store.pushUndo();
      const frame = this.store.activeFrame();
      this.floodFill(x, y, frame, s.w, s.h, s.color);
      this.store['pushRecentColorUsado']?.(s.color);
      return;
    }
  }

  /**
   * Relleno BFS clásico.
   */
  private floodFill(
    x0: number,
    y0: number,
    frame: Uint32Array,
    w: number,
    h: number,
    newColor: number
  ) {
    if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return;

    const oldColor = frame[y0 * w + x0];
    if (oldColor === newColor) return;

    const out = new Uint32Array(frame);
    const q: number[] = [x0, y0];

    while (q.length) {
      const y = q.pop()!;
      const x = q.pop()!;
      const idx = y * w + x;

      if (out[idx] !== oldColor) continue;
      out[idx] = newColor;

      if (x > 0) q.push(x - 1, y);
      if (x < w - 1) q.push(x + 1, y);
      if (y > 0) q.push(x, y - 1);
      if (y < h - 1) q.push(x, y + 1);
    }

    // Commit: reemplazamos el frame activo
    const frames = this.store.frames();
    const a = this.store.active();
    const nf = frames.slice();
    nf[a] = out;
    this.store.frames.set(nf);
  }

  /**
   * Convierte coordenadas de pantalla -> píxel del sprite.
   */
  private eventToPixel(e: PointerEvent) {
    const c = this.canvasRef.nativeElement;
    const rect = c.getBoundingClientRect();
    const s = this.store.state();
    const x = Math.floor((e.clientX - rect.left) / s.zoom);
    const y = Math.floor((e.clientY - rect.top) / s.zoom);
    return { x, y };
  }

  /**
   * Fondo de transparencia (checkerboard) tipo editor.
   */
  private drawCheckerboard(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    cell: number
  ) {
    const tema = this.store.state().tema;
    let a = '#f2f2f2';
    let b = '#d9d9d9';

    if (tema === 'oscuro') { a = '#1a1a1a'; b = '#232323'; }
    if (tema === 'gris')   { a = '#2d2d2d'; b = '#3a3a3a'; }
    if (tema === 'verde')  { a = '#0f1f14'; b = '#142a1c'; }
    if (tema === 'claro')  { a = '#f2f2f2'; b = '#d9d9d9'; }

    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        ctx.fillStyle = (((x / cell) + (y / cell)) % 2 === 0) ? a : b;
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }
}

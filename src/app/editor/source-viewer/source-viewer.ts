import { Component, ElementRef, ViewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorStore } from '../editor.store';

/**
 * Visor de la "Fuente" (imagen grande):
 * - Muestra la imagen con zoom/pan
 * - Permite seleccionar un rectángulo (drag con click izquierdo)
 * - Pan: arrastrar con botón medio o con ALT + arrastrar
 *
 * La selección se guarda en EditorStore.sourceSel (en pixeles de la imagen fuente).
 */
@Component({
  selector: 'source-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './source-viewer.html',
  styleUrl: './source-viewer.css',
})
export class SourceViewerComponent {
  @ViewChild('cv', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  // Estados internos de interacción
  private selecting = false;
  private panning = false;

  private startScreenX = 0;
  private startScreenY = 0;

  // pan inicial al empezar el drag (en px pantalla)
  private panStartX = 0;
  private panStartY = 0;

  // selección inicial (en px fuente)
  private selStartX = 0;
  private selStartY = 0;

  constructor(public store: EditorStore) {
    // Render reactivo cuando cambie cualquier cosa de la fuente/viewport
    effect(() => {
      this.store.sourceCanvas();
      this.store.sourceZoom();
      this.store.sourcePanX();
      this.store.sourcePanY();
      this.store.sourceSel();
      this.store.state().tema;
      this.render();
    });
  }

  // -------------------------
  // Render
  // -------------------------
  private render() {
    const c = this.canvasRef.nativeElement;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // Ajustar resolución real del canvas al tamaño mostrado (para que el mouse calce)
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.floor(rect.width * dpr));
    c.height = Math.max(1, Math.floor(rect.height * dpr));

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // dibujar en coords CSS

    // Fondo checkerboard (transparencia)
    this.drawCheckerboard(ctx, rect.width, rect.height, 10);

    const src = this.store.sourceCanvas();
    if (!src) return;

    // Transformación: pantalla -> fuente
    const zoom = this.store.sourceZoom();
    const panX = this.store.sourcePanX();
    const panY = this.store.sourcePanY();

    // Dibujo de la fuente en el visor
    // Pantalla: (panX, panY) es el origen donde cae el (0,0) de la fuente
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    ctx.drawImage(src, 0, 0);
    ctx.restore();

    // Dibujo de selección
    const sel = this.store.sourceSel();
    if (sel) {
      const sx = panX + sel.x * zoom;
      const sy = panY + sel.y * zoom;
      const sw = sel.w * zoom;
      const sh = sel.h * zoom;

      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw, sh);

      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx, sy, sw, sh);
      ctx.restore();
    }
  }

  // -------------------------
  // Interacción (pointer)
  // -------------------------
  onDown(e: PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const src = this.store.sourceCanvas();
    if (!src) return;

    // Pan con botón medio o ALT + arrastrar
    const panMode = (e.button === 1) || e.altKey;

    const { x: sx, y: sy } = this.eventToScreen(e);

    this.startScreenX = sx;
    this.startScreenY = sy;

    if (panMode) {
      this.panning = true;
      this.panStartX = this.store.sourcePanX();
      this.panStartY = this.store.sourcePanY();
      return;
    }

    // Si no es pan, es selección rectángulo
    const { x: fx, y: fy } = this.screenToSource(sx, sy);

    this.selecting = true;
    this.selStartX = fx;
    this.selStartY = fy;

    this.store.setSourceSel({ x: fx, y: fy, w: 1, h: 1 });
  }

  onMove(e: PointerEvent) {
    const src = this.store.sourceCanvas();
    if (!src) return;

    const { x: sx, y: sy } = this.eventToScreen(e);

    // Pan
    if (this.panning) {
      const dx = sx - this.startScreenX;
      const dy = sy - this.startScreenY;
      this.store.setSourcePan(this.panStartX + dx, this.panStartY + dy);
      return;
    }

    // Selección
    if (this.selecting) {
      const { x: fx, y: fy } = this.screenToSource(sx, sy);

      // Normalizamos el rect (para que funcione arrastrar hacia cualquier dirección)
      const x0 = Math.min(this.selStartX, fx);
      const y0 = Math.min(this.selStartY, fy);
      const x1 = Math.max(this.selStartX, fx);
      const y1 = Math.max(this.selStartY, fy);

      this.store.setSourceSel({
        x: x0,
        y: y0,
        w: Math.max(1, x1 - x0),
        h: Math.max(1, y1 - y0),
      });
    }
  }

  onUp() {
    this.selecting = false;
    this.panning = false;
  }

  // -------------------------
  // Acciones UI
  // -------------------------
  resetView() {
    this.store.setSourceZoom(1);
    this.store.setSourcePan(0, 0);
  }

  /**
   * Encaja la imagen dentro del visor automáticamente (zoom y pan).
   * Muy útil cuando importas imágenes enormes.
   */
  ajustarAEncaje() {
    const src = this.store.sourceCanvas();
    if (!src) return;

    const c = this.canvasRef.nativeElement;
    const rect = c.getBoundingClientRect();

    const margin = 12;
    const vw = Math.max(10, rect.width - margin * 2);
    const vh = Math.max(10, rect.height - margin * 2);

    const zx = vw / src.width;
    const zy = vh / src.height;
    const z = Math.max(0.05, Math.min(16, Math.min(zx, zy)));

    // Centrar
    const panX = (rect.width - src.width * z) / 2;
    const panY = (rect.height - src.height * z) / 2;

    this.store.setSourceZoom(z);
    this.store.setSourcePan(panX, panY);
  }

  // -------------------------
  // Utilidades de coordenadas
  // -------------------------
  private eventToScreen(e: PointerEvent) {
    const c = this.canvasRef.nativeElement;
    const rect = c.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x, y };
  }

  private screenToSource(screenX: number, screenY: number) {
    const zoom = this.store.sourceZoom();
    const panX = this.store.sourcePanX();
    const panY = this.store.sourcePanY();

    // Invertimos: pantalla = pan + fuente * zoom
    const fx = Math.floor((screenX - panX) / zoom);
    const fy = Math.floor((screenY - panY) / zoom);

    // Clamp al tamaño de la fuente
    const W = this.store.sourceW();
    const H = this.store.sourceH();
    const x = Math.max(0, Math.min(W - 1, fx));
    const y = Math.max(0, Math.min(H - 1, fy));
    return { x, y };
  }

  private drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number, cell: number) {
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

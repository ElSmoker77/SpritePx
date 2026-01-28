// editor-page.ts
import { Component, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToolboxComponent } from '../toolbox/toolbox';
import { PixelCanvasComponent } from '../pixel-canvas.component';
import { TimelineComponent } from '../timeline/timeline';
import { PreviewPlayerComponent } from '../preview-player/preview-player';
import { EditorStore } from '../editor.store';
import { exportSpritesheet } from '../export.util';
import { SourceViewerComponent } from '../source-viewer/source-viewer';

type PanelKey = 'vis' | 'canvas' | 'preview' | 'source' | 'import' | 'export' | 'aviso';

@Component({
  selector: 'editor-page',
  standalone: true,
  imports: [
    CommonModule,
    ToolboxComponent,
    PixelCanvasComponent,
    TimelineComponent,
    PreviewPlayerComponent,
    SourceViewerComponent,
  ],
  templateUrl:'./editor-page.html',
  styleUrl: './editor-page.css'
})
export class EditorPageComponent {
  // inputs lienzo
  canvasW: number = 32;
  canvasH: number = 32;

  // acordeón
  openPanel: PanelKey = 'vis';

  constructor(public store: EditorStore) {
    effect(() => {
      const s = this.store.state();
      this.canvasW = s.w;
      this.canvasH = s.h;
    });
  }

  isOpen(k: PanelKey) { return this.openPanel === k; }
  toggle(k: PanelKey) { this.openPanel = (this.openPanel === k) ? 'vis' : k; }

  exportarSpritesheet() { exportSpritesheet(this.store); }

  aplicarCanvasSize() {
    this.store.setCanvasSize(this.canvasW, this.canvasH);
    this.canvasW = this.store.state().w;
    this.canvasH = this.store.state().h;
  }

  async importarComoFuente(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const img = await this.cargarImagen(input.files[0]);
    await this.store.importarFuente(img);

    // abre automáticamente el panel Fuente (se siente re pro)
    this.openPanel = 'source';

    input.value = '';
  }

  recortarAFrame(comoNuevo: boolean) {
    this.store.recortarFuenteAFrame(comoNuevo);
    this.openPanel = 'source';
  }

  private cargarImagen(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }
}

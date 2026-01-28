import { Component, ElementRef, QueryList, ViewChildren, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorStore } from '../editor.store';

@Component({
  selector: 'timeline',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './timeline.html',
  styleUrl: './timeline.css',
})
export class TimelineComponent {
  @ViewChildren('thumb') thumbs!: QueryList<ElementRef<HTMLCanvasElement>>;

  constructor(public store: EditorStore) {
    effect(() => {
      // Re-render thumbs cuando cambian frames o tamaño
      this.store.frames();
      this.store.state();
      queueMicrotask(() => this.renderThumbs());
    });
  }

  private renderThumbs() {
    const s = this.store.state();
    const frames = this.store.frames();
    const els = this.thumbs.toArray();

    for (let i = 0; i < els.length; i++) {
      const c = els[i].nativeElement;
      const ctx = c.getContext('2d')!;
      const w = s.w, h = s.h;
      const z = Math.floor(64 / Math.max(w, h)); // mini-zoom
      c.width = w * z;
      c.height = h * z;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);

      const f = frames[i];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = f[y * w + x];
        const a = (v >>> 24) & 0xff;
        if (!a) continue;
        const r = (v >>> 16) & 0xff;
        const g = (v >>> 8) & 0xff;
        const b = v & 0xff;
        ctx.fillStyle = `rgba(${r},${g},${b},${a/255})`;
        ctx.fillRect(x*z, y*z, z, z);
      }
    }
  }
}

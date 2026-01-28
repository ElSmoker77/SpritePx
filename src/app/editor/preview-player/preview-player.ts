import { Component, ElementRef, ViewChild, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorStore } from '../editor.store';

@Component({
  selector: 'preview-player',
  standalone: true,
  imports: [CommonModule],
  templateUrl:'./preview-player.html',
  styleUrl:'./preview-player.css'
})
export class PreviewPlayerComponent implements OnDestroy {
  @ViewChild('p', { static: true }) prevRef!: ElementRef<HTMLCanvasElement>;

  reproduciendo = true;
  private timer: any = null;
  private idx = 0;

  constructor(public store: EditorStore) {
    effect(() => {
      // Reinicia si cambian frames o fps
      this.store.frames();
      this.store.state();
      this.restart();
    });
  }

  ngOnDestroy() { this.stop(); }

  toggle() {
    this.reproduciendo = !this.reproduciendo;
    if (this.reproduciendo) this.restart();
    else this.stop();
  }

  private restart() {
    this.stop();
    this.idx = 0;
    this.draw();
    if (!this.reproduciendo) return;

    const fps = Math.max(1, this.store.state().fps);
    this.timer = setInterval(() => this.draw(), 1000 / fps);
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private draw() {
    const s = this.store.state();
    const frames = this.store.frames();
    if (!frames.length) return;

    const c = this.prevRef.nativeElement;
    const ctx = c.getContext('2d')!;
    const w = s.w, h = s.h;

    const z = Math.max(1, Math.floor(160 / Math.max(w, h)));
    c.width = w * z;
    c.height = h * z;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);

    const f = frames[this.idx % frames.length];
    this.idx++;

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

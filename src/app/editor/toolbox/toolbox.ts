import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorStore, Tool } from '../editor.store';

// ---------- helpers color ----------
function argbToHex(color: number): string {
  const r = ((color >>> 16) & 0xff).toString(16).padStart(2, '0');
  const g = ((color >>> 8) & 0xff).toString(16).padStart(2, '0');
  const b = (color & 0xff).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}
function hexToArgb(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0xff << 24) | (r << 16) | (g << 8) | b;
}
function toCss(color: number) {
  const a = ((color >>> 24) & 0xff) / 255;
  const r = (color >>> 16) & 0xff;
  const g = (color >>> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r},${g},${b},${a})`;
}
function toHexNoAlpha(color: number) {
  const r = ((color >>> 16) & 0xff).toString(16).padStart(2, '0');
  const g = ((color >>> 8) & 0xff).toString(16).padStart(2, '0');
  const b = (color & 0xff).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

// ---------- parser de paletas ----------
function parsePaletteText(text: string): number[] {
  // 1) JSON: ["#RRGGBB", ...]
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) {
      return j
        .map(v => typeof v === 'string' ? v.trim() : '')
        .filter(v => /^#?[0-9a-fA-F]{6}$/.test(v))
        .map(v => {
          const h = v.replace('#', '');
          const r = parseInt(h.slice(0, 2), 16);
          const g = parseInt(h.slice(2, 4), 16);
          const b = parseInt(h.slice(4, 6), 16);
          return (0xff << 24) | (r << 16) | (g << 8) | b;
        });
    }
  } catch {}

  // 2) GPL (GIMP Palette): líneas "R G B Nombre"
  const out: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#')) continue;
    if (t.startsWith('GIMP')) continue;
    if (t.startsWith('Name:')) continue;
    if (t.startsWith('Columns:')) continue;

    const parts = t.split(/\s+/);
    if (parts.length < 3) continue;

    const r = parseInt(parts[0], 10);
    const g = parseInt(parts[1], 10);
    const b = parseInt(parts[2], 10);
    if ([r, g, b].some(n => Number.isNaN(n) || n < 0 || n > 255)) continue;

    out.push((0xff << 24) | (r << 16) | (g << 8) | b);
  }
  return out;
}

@Component({
  selector: 'toolbox',
  standalone: true,
  imports: [CommonModule],
  templateUrl:'./toolbox.html',
  styleUrl:'./toolbox.css',
})
export class ToolboxComponent {
  constructor(public store: EditorStore) {}
  get s() { return this.store.state(); }
  get colorHex() { return argbToHex(this.s.color); }

  toCss = toCss;
  toHexNoAlpha = toHexNoAlpha;

  setTool(t: Tool) { this.store.setTool(t); }
  onColor(hex: string) { this.store.setColor(hexToArgb(hex)); }

  async importarPaleta(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const text = await file.text();
    const colors = parsePaletteText(text);

    if (!colors.length) {
      this.store.setAviso?.('No pude leer la paleta. Prueba con .gpl (GIMP) o .json ["#RRGGBB", ...].');
      input.value = '';
      return;
    }

    this.store.setImportedPalette(colors);
    this.store.setAviso?.(`Paleta importada: ${colors.length} colores.`);
    input.value = '';
  }
}

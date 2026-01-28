import { Routes } from '@angular/router';
import { EditorPageComponent } from './editor/editor-page/editor-page';
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'editor' },
  { path: 'editor', component: EditorPageComponent },
];

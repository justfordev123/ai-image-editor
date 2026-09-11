import { Component, input } from '@angular/core';

const paths: Record<string, string> = {
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5',
  download: 'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',
  undo: 'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12',
  redo: 'm15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12',
  crop: 'M6 2v16h16M2 6h16v16',
  rotate: 'M4 9a8 8 0 1 1 0 6M4 3v6h6',
  flip: 'M12 2v20M8 5 2 18h6V5Zm8 0 6 13h-6V5Z',
  draw: 'm4 17-1 4 4-1L20 7l-3-3L4 17Zm11-11 3 3',
  adjust: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
  select: 'm5 3 14 9-7 1-3 7L5 3Z',
  close: 'm6 6 12 12M6 18 18 6',
  heart: 'M20 5c-3-3-7-1-8 1-1-2-5-4-8-1-5 5 4 11 8 15 4-4 13-10 8-15Z',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  menu: 'M4 6h16M4 12h16M4 18h16',
};
@Component({
  selector: 'app-icon',
  template:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="paths[name()] || paths[\'spark\']" /></svg>',
  styles:
    ':host { display: inline-flex; width: 20px; height: 20px; flex: 0 0 20px; } svg { width: 100%; height: 100%; }',
})
export class IconComponent {
  readonly name = input('spark');
  readonly paths = paths;
}

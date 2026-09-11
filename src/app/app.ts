import { Component } from '@angular/core';
import { ImageEditorComponent } from './image-editor.component';

@Component({
  selector: 'app-root',
  imports: [ImageEditorComponent],
  template: '<app-image-editor />',
})
export class App {}

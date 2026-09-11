import { AsyncPipe } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { EditorStore } from './editor.store';

@Component({
  selector: 'app-canvas-start',
  imports: [AsyncPipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './canvas-start.component.html',
  styleUrl: './canvas-start.component.scss',
})
export class CanvasStartComponent {
  readonly store = inject(EditorStore);
  readonly ready = input(false);
  readonly busy = input(false);
  readonly sample = output<void>();
  readonly upload = output<void>();
  readonly generate = output<string>();
  readonly creating = signal(false);
  readonly prompt = signal('');
}

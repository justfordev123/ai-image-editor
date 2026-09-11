import { AsyncPipe } from '@angular/common';
import { Component, input, output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { EditorStore } from './editor.store';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-ai-panel',
  imports: [
    AsyncPipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    IconComponent,
  ],
  templateUrl: './ai-panel.component.html',
  styleUrl: './panel.scss',
})
export class AiPanelComponent {
  readonly store = inject(EditorStore);
  readonly hasImage = input(false);
  readonly busy = input(false);
  readonly generate = output<void>();
  readonly close = output<void>();
}

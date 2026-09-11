import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { IconComponent } from './icon.component';

export interface Adjustment {
  type: 'brightness' | 'contrast' | 'saturation';
  value: number;
}
export type AdjustmentValues = Record<Adjustment['type'], number>;

@Component({
  selector: 'app-properties-panel',
  imports: [MatButtonModule, IconComponent],
  templateUrl: './properties-panel.component.html',
  styleUrl: './panel.scss',
})
export class PropertiesPanelComponent {
  readonly disabled = input(false);
  readonly values = input.required<AdjustmentValues>();
  readonly adjust = output<Adjustment>();
  readonly close = output<void>();
  readonly sliders: { type: Adjustment['type']; label: string; min: number; max: number }[] = [
    { type: 'brightness', label: 'Brightness', min: -0.5, max: 0.5 },
    { type: 'contrast', label: 'Contrast', min: -1, max: 1 },
    { type: 'saturation', label: 'Saturation', min: -1, max: 1 },
  ];
}

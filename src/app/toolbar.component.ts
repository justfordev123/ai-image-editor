import { Component, ElementRef, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IconComponent } from './icon.component';

export type Tool = 'select' | 'crop' | 'rotate' | 'flip' | 'draw' | 'adjust' | 'ai';
@Component({
  selector: 'app-toolbar',
  imports: [MatButtonModule, MatMenuModule, MatTooltipModule, IconComponent],
  template: `
    <nav class="desktop-tools" aria-label="Editing tools">
      @for (tool of tools; track tool.id) {
        <button
          mat-button
          [class.selected]="active() === tool.id"
          [attr.aria-pressed]="active() === tool.id"
          [disabled]="tool.id === 'ai' ? !hasImage() : disabled()"
          [attr.data-tool]="tool.id"
          (click)="choose.emit(tool.id)"
          [matTooltip]="tool.label"
          matTooltipPosition="right"
        >
          <app-icon [name]="tool.id === 'ai' ? 'spark' : tool.id" /><span>{{ tool.label }}</span>
        </button>
      }
    </nav>
    <button class="mobile-tools" mat-stroked-button [matMenuTriggerFor]="menu">
      <app-icon name="menu" /> Tools
    </button>
    <mat-menu #menu="matMenu">
      @for (tool of tools; track tool.id) {
        <button
          mat-menu-item
          [disabled]="tool.id === 'ai' ? !hasImage() : disabled()"
          (click)="choose.emit(tool.id)"
        >
          <app-icon [name]="tool.id === 'ai' ? 'spark' : tool.id" /> {{ tool.label }}
        </button>
      }
    </mat-menu>
  `,
  styles: `
    @use '@angular/material' as mat;

    :host {
      display: block;
    }
    // Restoring focus after a pointer action should not leave a focus overlay.
    button:not(:focus-visible) {
      @include mat.button-overrides(
        (
          text-focus-state-layer-opacity: 0,
          outlined-focus-state-layer-opacity: 0,
        )
      );
    }
    .desktop-tools {
      display: none;
    }
    @media (min-width: 768px) {
      .mobile-tools {
        display: none;
      }
      .desktop-tools {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 9px;
      }
      .desktop-tools button {
        width: 64px;
        height: 64px;
        min-width: 64px;
        padding: 0;
        border-radius: var(--radius-button);
      }
      .desktop-tools button span {
        display: block;
        font-size: 12px;
        line-height: 16px;
      }
      .selected {
        background: var(--primary-grey);
      }
    }
  `,
})
export class ToolbarComponent {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly active = input<Tool>('select');
  readonly disabled = input(false);
  readonly hasImage = input(false);
  readonly choose = output<Tool>();
  readonly tools: { id: Tool; label: string }[] = [
    { id: 'select', label: 'Select' },
    { id: 'crop', label: 'Crop' },
    { id: 'rotate', label: 'Rotate' },
    { id: 'flip', label: 'Flip' },
    { id: 'draw', label: 'Draw' },
    { id: 'adjust', label: 'Adjust' },
    { id: 'ai', label: 'AI' },
  ];

  focusTool(tool: Tool) {
    const buttons = this.element.nativeElement.querySelectorAll<HTMLButtonElement>('button');
    Array.from(buttons)
      .find(
        (button) =>
          button.getClientRects().length &&
          (button.dataset['tool'] === tool || button.classList.contains('mobile-tools')),
      )
      ?.focus();
  }
}

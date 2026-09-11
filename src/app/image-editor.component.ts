import { AsyncPipe, NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  TemplateRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import type ImageEditor from 'tui-image-editor';
import { ToolbarComponent, type Tool } from './toolbar.component';
import {
  PropertiesPanelComponent,
  type Adjustment,
  type AdjustmentValues,
} from './properties-panel.component';
import { AiPanelComponent } from './ai-panel.component';
import { CanvasStartComponent } from './canvas-start.component';
import { IconComponent } from './icon.component';
import { EditorStore } from './editor.store';
import { CREAITION_THEME } from './creaition-theme';
import { SAMPLE_IMAGE, type GeneratedImage } from './models';

@Component({
  selector: 'app-image-editor',
  imports: [
    AsyncPipe,
    NgTemplateOutlet,
    MatButtonModule,
    MatDialogModule,
    MatTooltipModule,
    ToolbarComponent,
    PropertiesPanelComponent,
    AiPanelComponent,
    CanvasStartComponent,
    IconComponent,
  ],
  templateUrl: './image-editor.component.html',
  styleUrl: './image-editor.component.scss',
})
export class ImageEditorComponent implements AfterViewInit {
  readonly store = inject(EditorStore);
  readonly generating = toSignal(this.store.state$.pipe(map((state) => state.loading)), {
    initialValue: false,
  });
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  @ViewChild('canvasHost', { static: true }) private canvasHost!: ElementRef<HTMLDivElement>;
  @ViewChild('canvasStage', { static: true }) private canvasStage!: ElementRef<HTMLDivElement>;
  @ViewChild('properties', { static: true }) private properties!: TemplateRef<unknown>;
  @ViewChild(ToolbarComponent) private toolbar?: ToolbarComponent;
  private editor?: ImageEditor;
  private observer?: ResizeObserver;
  private modal?: MatDialogRef<unknown>;
  readonly desktop = signal(false);
  readonly hasImage = signal(false);
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly tool = signal<Tool>('select');
  readonly activePanel = signal<'ai' | 'adjust' | null>(null);
  readonly error = signal('');
  readonly title = signal('Untitled image');
  readonly dimensions = signal('');
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  readonly onlyFavorites = signal(false);
  readonly isSample = signal(true);
  readonly adjustments = signal<AdjustmentValues>({ brightness: 0, contrast: 0, saturation: 0 });

  hasFavorites(images: GeneratedImage[]) {
    return images.some((image) => image.favorite);
  }

  constructor() {
    inject(BreakpointObserver)
      .observe('(min-width: 1024px)')
      .pipe(takeUntilDestroyed())
      .subscribe((result) => {
        this.desktop.set(result.matches);
        if (result.matches) this.modal?.close('resize');
        else if (this.activePanel()) this.openProperties();
      });
    this.store.generated$
      .pipe(takeUntilDestroyed())
      .subscribe((image) => void this.openImage(image));
    this.destroyRef.onDestroy(() => {
      this.store.cancel();
      this.observer?.disconnect();
      this.editor?.destroy();
      this.closeProperties();
    });
  }

  async ngAfterViewInit() {
    try {
      // Load the library's browser distributions via angular.json, excluding Fabric's Node-only dependencies.
      const TuiImageEditor = (window as unknown as { tui: { ImageEditor: typeof ImageEditor } }).tui
        .ImageEditor;
      if (this.destroyRef.destroyed) return;
      this.editor = new TuiImageEditor(this.canvasHost.nativeElement, {
        ...CREAITION_THEME,
        cssMaxWidth: 800,
        cssMaxHeight: 700,
      });
      this.editor.on('undoStackChanged', (length: number) => this.canUndo.set(length > 0));
      this.editor.on('redoStackChanged', (length: number) => this.canRedo.set(length > 0));
      this.observer = new ResizeObserver(() => this.fitCanvas());
      this.observer.observe(this.canvasStage.nativeElement);
      await this.store.ready;
      if (this.destroyRef.destroyed) return;
      const image = this.store.currentImage;
      if (image) await this.openImage(image);
      this.ready.set(true);
    } catch {
      this.error.set('The image editor could not be loaded. Refresh to try again.');
    }
  }

  async openImage(image: GeneratedImage) {
    if (!this.editor || this.busy()) return;
    this.store.clearFeedback();
    const previousId = this.store.currentImage?.id;
    // Remember intent during loading so refresh resumes it; roll back if the image fails.
    this.store.selectImage(image.id);
    if (
      !(await this.loadImage(image.url, image.name || 'Edited image', image.id === SAMPLE_IMAGE.id))
    )
      this.store.selectImage(previousId ?? '');
  }

  async removeImage(image: GeneratedImage) {
    if (!this.ready() || this.busy() || this.generating()) return;
    const isCurrent = this.store.currentImage?.id === image.id;
    this.store.removeImage(image.id);
    if (!isCurrent) return;
    this.closeProperties(false);
    this.stopDrawing();
    this.hasImage.set(false);
    this.canUndo.set(false);
    this.canRedo.set(false);
    this.dimensions.set('');
    this.title.set('Untitled image');
    this.error.set('');
    this.onlyFavorites.set(false);
    this.store.clearFeedback();
    const next = this.store.currentImage;
    if (next) await this.openImage(next);
  }

  async openSample() {
    if (!this.editor || this.busy() || this.generating()) return;
    this.store.clearFeedback();
    this.onlyFavorites.set(false);
    const saving = this.store.addSampleImage();
    await this.loadImage(SAMPLE_IMAGE.url, SAMPLE_IMAGE.name, true);
    await saving;
  }

  private fitCanvas() {
    if (!this.editor || !this.hasImage()) return;
    const stage = this.canvasStage.nativeElement;
    if (stage.clientWidth <= 48 || stage.clientHeight <= 48) return;
    const size = this.editor.getCanvasSize();
    const scale = Math.min(
      1,
      (stage.clientWidth - 48) / size.width,
      (stage.clientHeight - 48) / size.height,
    );
    const host = this.canvasHost.nativeElement;
    host.style.width = `${Math.round(size.width * scale)}px`;
    host.style.height = `${Math.round(size.height * scale)}px`;
    // CSS sizing preserves pixels and undo history; TUI's resize command would add an undo entry.
    host
      .querySelectorAll<HTMLElement>('.tui-image-editor-canvas-container, canvas')
      .forEach((element) => {
        Object.assign(element.style, {
          width: '100%',
          height: '100%',
          maxWidth: '100%',
          maxHeight: '100%',
        });
      });
    this.dimensions.set(`${Math.round(size.width)} × ${Math.round(size.height)} px`);
  }

  async loadImage(url: string, name: string, sample = false) {
    if (!this.editor || this.busy()) return false;
    this.busy.set(true);
    this.error.set('');
    try {
      this.editor.stopDrawingMode();
      this.tool.set('select');
      await this.editor.loadImageFromURL(url, name);
      this.editor.clearUndoStack();
      this.editor.clearRedoStack();
      this.syncAdjustments();
      this.hasImage.set(true);
      this.title.set(name);
      this.isSample.set(sample);
      this.fitCanvas();
      return true;
    } catch {
      this.error.set('This image could not be opened. Try a PNG, JPEG, or WebP file.');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!this.ready() || this.busy() || this.generating()) return;
    this.store.clearFeedback();
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      this.error.set('Choose a PNG, JPEG, or WebP file under 10 MB.');
      return;
    }
    try {
      const image = await createImageBitmap(file);
      const validSize = image.width * image.height <= 20_000_000;
      image.close();
      if (!validSize) {
        this.error.set('Use an image smaller than 20 megapixels.');
        return;
      }
      // Store the original bytes as a data URL so history survives a page reload.
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const name = file.name.replace(/\.[^.]+$/, '');
      if (await this.loadImage(url, name)) {
        this.onlyFavorites.set(false);
        await this.store.addUploadedImage(url, name);
      }
    } catch {
      this.error.set('This file is not a readable image.');
    }
  }

  private async command(action: (editor: ImageEditor) => unknown) {
    if (!this.editor || !this.hasImage() || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await action(this.editor);
      this.syncAdjustments();
      this.fitCanvas();
    } catch {
      this.error.set('That edit could not be applied. Try selecting a different tool.');
    } finally {
      this.busy.set(false);
    }
  }
  chooseTool(tool: Tool) {
    if (!this.hasImage()) return;
    if (tool === 'ai') {
      this.stopDrawing();
      this.activePanel.set('ai');
      this.openProperties();
      return;
    }
    if (!this.editor || this.busy()) return;
    this.editor.stopDrawingMode();
    this.tool.set(tool);
    if (tool === 'adjust') {
      this.activePanel.set('adjust');
      this.openProperties();
      return;
    }
    this.closeProperties(false);
    if (tool === 'crop') {
      this.editor.startDrawingMode('CROPPER');
      this.editor.setCropzoneRect(1);
    }
    if (tool === 'draw')
      this.editor.startDrawingMode('FREE_DRAWING', { width: 8, color: '#000000' });
    if (tool === 'rotate') void this.command((editor) => editor.rotate(90));
    if (tool === 'flip') void this.command((editor) => editor.flipX());
  }
  private stopDrawing() {
    this.editor?.stopDrawingMode();
    this.tool.set('select');
  }
  crop() {
    void this.command(async (editor) => {
      const rect = editor.getCropzoneRect();
      if (!rect || rect.width < 1 || rect.height < 1) throw new Error('Select a crop area.');
      await editor.crop(rect);
      editor.stopDrawingMode();
      this.tool.set('select');
    });
  }
  undo() {
    this.stopDrawing();
    void this.command((editor) => editor.undo());
  }
  redo() {
    this.stopDrawing();
    void this.command((editor) => editor.redo());
  }
  adjust(adjustment: Adjustment) {
    if (this.adjustments()[adjustment.type] === adjustment.value) return;
    // TUI 3.15.0 supports these Fabric filters, but its declaration only types mask options.
    void this.command((editor) =>
      editor.applyFilter(adjustment.type, {
        [adjustment.type]: adjustment.value,
      } as unknown as { maskObjId: number }),
    );
  }
  private syncAdjustments() {
    // The pinned TUI version has no public filter-value getter. Read its filter component so
    // sliders reflect the actual image after undo, redo, crop, and loading a different image.
    const editor = this.editor as unknown as {
      _graphics: {
        getComponent(name: 'FILTER'): {
          getOptions(type: Adjustment['type']): Partial<AdjustmentValues> | null;
        };
      };
    };
    const filter = editor._graphics.getComponent('FILTER');
    this.adjustments.set({
      brightness: filter.getOptions('brightness')?.brightness ?? 0,
      contrast: filter.getOptions('contrast')?.contrast ?? 0,
      saturation: filter.getOptions('saturation')?.saturation ?? 0,
    });
  }
  generate() {
    if (!this.editor || !this.hasImage() || this.busy() || this.generating()) return;
    this.stopDrawing();
    try {
      const size = this.editor.getCanvasSize();
      const source = this.editor.toDataURL({
        format: 'jpeg',
        quality: 0.9,
        multiplier: Math.min(1, 1024 / Math.max(size.width, size.height)),
      });
      void this.store.generate({
        intent: 'edit',
        prompt: this.store.snapshot.preferences.prompt,
        source,
      });
    } catch {
      this.error.set('Could not prepare the canvas for AI editing. Try uploading the image again.');
    }
  }
  createImage(prompt: string) {
    if (!this.ready() || this.hasImage() || this.busy() || this.generating()) return;
    this.error.set('');
    void this.store.generate({ intent: 'create', prompt });
  }
  download() {
    if (!this.editor || !this.hasImage()) return;
    this.stopDrawing();
    try {
      const anchor = document.createElement('a');
      anchor.href = this.editor.toDataURL({ format: 'png' });
      anchor.download = `${this.title() || 'image-studio'}.png`;
      anchor.click();
    } catch {
      this.error.set('Could not export this image. Try again.');
    }
  }
  openProperties() {
    if (this.desktop() || this.modal || !this.activePanel()) return;
    const panel = this.activePanel()!;
    this.modal = this.dialog.open(this.properties, {
      width: '480px',
      maxWidth: '100vw',
      maxHeight: '95dvh',
      panelClass: 'properties-dialog',
      ariaLabel: panel === 'ai' ? 'AI panel' : 'Adjust panel',
      autoFocus: 'first-tabbable',
      restoreFocus: false,
    });
    this.modal.afterClosed().subscribe((reason) => {
      this.modal = undefined;
      if (reason !== 'resize') {
        this.activePanel.set(null);
        if (this.tool() === 'adjust') this.tool.set('select');
      }
      if (reason !== 'tool' && !this.destroyRef.destroyed) this.toolbar?.focusTool(panel);
    });
  }
  closeProperties(restoreFocus = true) {
    const panel = this.activePanel();
    this.activePanel.set(null);
    if (this.tool() === 'adjust') this.tool.set('select');
    this.modal?.close(restoreFocus ? undefined : 'tool');
    if (restoreFocus && panel && this.desktop() && !this.destroyRef.destroyed)
      this.toolbar?.focusTool(panel);
  }
}

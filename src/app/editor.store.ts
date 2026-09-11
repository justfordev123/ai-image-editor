import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Subject, Subscription, finalize } from 'rxjs';
import { AiService } from './ai.service';
import {
  DEFAULTS,
  SAMPLE_IMAGE,
  type EditorState,
  type GeneratedImage,
  type GenerationRequest,
  type Preferences,
} from './models';
import { readHistory, saveHistory } from './image-history';

const STORAGE_KEY = 'creaition-preferences-v1';
const CURRENT_IMAGE_KEY = 'creaition-current-image-v1';
export function restorePreferences(value: unknown): Preferences {
  const prompt = value && typeof value === 'object' && 'prompt' in value ? value.prompt : '';
  // Discard old mode, model, batch, and parameter settings; only the prompt is editable now.
  return { prompt: typeof prompt === 'string' ? prompt.slice(0, 2000) : '' };
}

@Injectable({ providedIn: 'root' })
export class EditorStore {
  private readonly ai = inject(AiService);
  private readonly subject = new BehaviorSubject<EditorState>({
    preferences: { ...DEFAULTS },
    images: [],
    loading: false,
    message: '',
    error: null,
    storageWarning: null,
  });
  readonly state$ = this.subject.asObservable();
  readonly generated$ = new Subject<GeneratedImage>();
  private generation?: Subscription;
  private runId = 0;
  private saving = Promise.resolve();
  private currentImageId: string | null = null;
  readonly ready: Promise<void>;

  constructor() {
    try {
      this.patch({
        preferences: restorePreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')),
      });
      this.currentImageId = localStorage.getItem(CURRENT_IMAGE_KEY);
    } catch {
      this.patch({ storageWarning: 'Preferences could not be restored. Using defaults.' });
    }
    this.ready = readHistory()
      .then((images) => {
        this.patch({ images });
        // A refresh can interrupt the first IndexedDB write; the bundled sample is recoverable.
        if (this.currentImageId === SAMPLE_IMAGE.id) this.ensureSampleImage();
      })
      .catch(() =>
        this.patch({
          storageWarning: 'Image history is unavailable. New images will remain in this session.',
        }),
      );
  }

  get snapshot() {
    return this.subject.value;
  }
  get currentImage() {
    return (
      this.snapshot.images.find((image) => image.id === this.currentImageId) ??
      this.snapshot.images[0]
    );
  }
  selectImage(id: string) {
    this.currentImageId = id;
    try {
      localStorage.setItem(CURRENT_IMAGE_KEY, id);
    } catch {
      this.patch({
        storageWarning: 'The current image selection could not be saved on this device.',
      });
    }
  }
  private patch(value: Partial<EditorState>) {
    this.subject.next({ ...this.snapshot, ...value });
  }
  clearFeedback() {
    if (!this.snapshot.loading) this.patch({ error: null, message: '' });
  }
  update(value: Partial<Preferences>) {
    const preferences = restorePreferences({ ...this.snapshot.preferences, ...value });
    this.patch({ preferences });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      this.patch({ storageWarning: 'Preferences could not be saved on this device.' });
    }
  }
  private persist(images: GeneratedImage[]) {
    this.patch({ images });
    this.saving = this.saving
      .then(() => saveHistory(images))
      .catch(() =>
        this.patch({
          storageWarning:
            'Device storage is full or unavailable. Download images you want to keep.',
        }),
      );
  }
  toggleFavorite(id: string) {
    this.persist(
      this.snapshot.images.map((image) =>
        image.id === id ? { ...image, favorite: !image.favorite } : image,
      ),
    );
  }
  removeImage(id: string) {
    this.persist(this.snapshot.images.filter((image) => image.id !== id));
    if (this.currentImageId === id) this.selectImage(this.snapshot.images[0]?.id ?? '');
  }

  async addUploadedImage(url: string, name: string) {
    // Wait for stored history so a quick upload cannot be overwritten by restoration.
    await this.ready;
    const image = this.addImage(url, '', name);
    this.selectImage(image.id);
    await this.saving;
  }

  async addSampleImage() {
    await this.ready;
    const image = this.ensureSampleImage();
    this.selectImage(image.id);
    await this.saving;
  }

  private ensureSampleImage() {
    return (
      this.snapshot.images.find((item) => item.id === SAMPLE_IMAGE.id) ??
      this.addImage(
        SAMPLE_IMAGE.url,
        'White ceramic ribbon sculpture sample',
        SAMPLE_IMAGE.name,
        SAMPLE_IMAGE.id,
      )
    );
  }

  private addImage(
    url: string,
    prompt: string,
    name?: string,
    id: string = crypto.randomUUID(),
  ): GeneratedImage {
    const image: GeneratedImage = {
      id,
      url,
      prompt,
      name,
      createdAt: Date.now(),
      favorite: false,
    };
    // Keep favorites and the 30 most recent non-favorites, including uploads.
    const images = [image, ...this.snapshot.images];
    const recent = new Set(
      images
        .filter((item) => !item.favorite)
        .slice(0, 30)
        .map((item) => item.id),
    );
    this.persist(images.filter((item) => item.favorite || recent.has(item.id)));
    return image;
  }

  async generate(request: GenerationRequest) {
    if (this.snapshot.loading) return;
    const prompt = request.prompt.trim();
    if (!prompt || (request.intent === 'edit' && !request.source)) {
      this.patch({ error: 'Enter a prompt and, when editing, load an image first.' });
      return;
    }
    const runId = ++this.runId;
    this.patch({ loading: true, error: null, message: 'Connecting to the AI service…' });
    await this.ready;
    if (!this.snapshot.loading || runId !== this.runId) return;
    this.generation = this.ai
      .generate({ ...request, prompt })
      .pipe(finalize(() => this.patch({ loading: false })))
      .subscribe({
        next: (event) => {
          if (event.type === 'status') this.patch({ message: event.message });
          if (event.type === 'image') {
            const name =
              request.intent === 'create'
                ? 'Untitled image'
                : this.currentImage?.name || 'Edited image';
            const image = this.addImage(event.url, prompt, name);
            this.generated$.next(image);
          }
        },
        error: (error: Error) => this.patch({ error: error.message, message: '' }),
        complete: () =>
          this.patch({
            message: request.intent === 'create' ? 'Image created.' : 'Image updated.',
          }),
      });
  }
  cancel() {
    this.runId++;
    this.generation?.unsubscribe();
    this.patch({ loading: false, message: '' });
  }
}

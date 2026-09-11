export interface Preferences {
  prompt: string;
}
export const DEFAULTS: Preferences = { prompt: '' };
export const SAMPLE_IMAGE = {
  id: 'sample',
  url: '/samples/ceramic-ribbon.png',
  name: 'Ceramic study',
};
export type GenerationRequest =
  { intent: 'create'; prompt: string } | { intent: 'edit'; prompt: string; source: string };
export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  createdAt: number;
  favorite: boolean;
  name?: string;
}
export type GenerationEvent =
  | { type: 'status'; message: string }
  | { type: 'image'; url: string }
  | { type: 'error'; message: string };
export interface EditorState {
  preferences: Preferences;
  images: GeneratedImage[];
  loading: boolean;
  message: string;
  error: string | null;
  storageWarning: string | null;
}

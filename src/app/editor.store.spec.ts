import { restorePreferences } from './editor.store';
import { DEFAULTS } from './models';

describe('stored preferences', () => {
  it('recovers from invalid prompts', () => {
    for (const value of [null, undefined, 42, { prompt: 42 }]) {
      expect(restorePreferences(value)).toEqual(DEFAULTS);
    }
  });
  it('retains only the prompt from legacy generation preferences', () => {
    expect(
      restorePreferences({
        mode: 'create',
        model: 'stabilityai/stable-diffusion-xl-base-1.0',
        batch: 4,
        prompt: 'Make the background darker',
        seed: 999,
        steps: 50,
      }),
    ).toEqual({ prompt: 'Make the background darker' });
  });
  it('bounds a restored prompt to the API limit', () => {
    expect(restorePreferences({ prompt: 'a'.repeat(3000) }).prompt).toHaveLength(2000);
  });
});

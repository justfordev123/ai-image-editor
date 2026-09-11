import { TestBed } from '@angular/core/testing';
import { provideHttpClient, HttpEventType } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AiService } from './ai.service';
import { type GenerationEvent, type GenerationRequest } from './models';

const REQUEST: GenerationRequest = {
  intent: 'edit',
  prompt: 'Make the background darker',
  source: 'data:image/png;base64,YQ==',
};

describe('AI stream', () => {
  let service: AiService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('buffers split lines and does not replay progress when the final response arrives', () => {
    const events: GenerationEvent[] = [];
    const status = '{"type":"status","message":"Generating"}\n';
    const image = '{"type":"image","url":"data:image/png;base64,YQ=="}\n';
    const complete = vi.fn();
    service.generate(REQUEST).subscribe({ next: (event) => events.push(event), complete });
    const req = http.expectOne('/api/generate');
    expect(req.request.timeout).toBe(150_000);
    req.event({
      type: HttpEventType.DownloadProgress,
      loaded: 10,
      partialText: status.slice(0, 10),
    });
    expect(events).toHaveLength(0);
    req.event({
      type: HttpEventType.DownloadProgress,
      loaded: status.length + 8,
      partialText: status + image.slice(0, 8),
    });
    expect(events).toHaveLength(1);
    req.flush(status + image);
    expect(events.map((event) => event.type)).toEqual(['status', 'image']);
    expect(complete).toHaveBeenCalledOnce();
  });
  it('rejects a truncated successful HTTP response without an image', () => {
    const error = vi.fn();
    service.generate(REQUEST).subscribe({ error });
    http.expectOne('/api/generate').flush('{"type":"status","message":"Waiting"}\n');
    expect(error.mock.calls[0][0].message).toContain('before an image arrived');
  });
  it('shows streamed quota errors and stops', () => {
    const error = vi.fn();
    service.generate(REQUEST).subscribe({ error });
    http.expectOne('/api/generate').flush('{"type":"error","message":"Credits exhausted"}\n');
    expect(error.mock.calls[0][0].message).toBe('Credits exhausted');
  });
  it('preserves readable service errors', () => {
    const error = vi.fn();
    service.generate(REQUEST).subscribe({ error });
    http
      .expectOne('/api/generate')
      .flush('{"error":"AI is unavailable. Please contact the demo owner."}', {
        status: 503,
        statusText: 'Unavailable',
      });
    expect(error.mock.calls[0][0].message).toBe(
      'AI is unavailable. Please contact the demo owner.',
    );
  });
  it.each(['not-json\n', 'null\n', '{"type":"status","message":42}\n', '{"type":"unknown"}\n'])(
    'turns malformed stream %s into a readable error',
    (body) => {
      const error = vi.fn();
      service.generate(REQUEST).subscribe({ error });
      http.expectOne('/api/generate').flush(body);
      expect(error.mock.calls[0][0].message).toBe(
        'The AI service returned an unreadable response. Please try again.',
      );
    },
  );
  it('rejects a non-image result', () => {
    const error = vi.fn();
    service.generate(REQUEST).subscribe({ error });
    http
      .expectOne('/api/generate')
      .flush('{"type":"image","url":"https://unexpected.example/image"}\n');
    expect(error.mock.calls[0][0].message).toContain('invalid image');
  });
  it.each(['error', 'timeout'])('explains a network %s and terminates the request', (type) => {
    const error = vi.fn();
    service.generate(REQUEST).subscribe({ error });
    http.expectOne('/api/generate').error(new ProgressEvent(type));
    expect(error.mock.calls[0][0].message).toContain(
      type === 'timeout' ? 'took too long' : 'Check your connection',
    );
  });
  it('aborts HTTP on unsubscribe', () => {
    const subscription = service.generate(REQUEST).subscribe();
    const req = http.expectOne('/api/generate');
    subscription.unsubscribe();
    expect(req.cancelled).toBe(true);
  });
});

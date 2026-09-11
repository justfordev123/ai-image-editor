import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { GenerationEvent, GenerationRequest } from './models';

function parseEvent(line: string): GenerationEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('The AI service returned an unreadable response. Please try again.');
  }
  if (value && typeof value === 'object' && 'type' in value) {
    if (
      (value.type === 'status' || value.type === 'error') &&
      'message' in value &&
      typeof value.message === 'string' &&
      value.message.trim()
    ) {
      return { type: value.type, message: value.message };
    }
    if (value.type === 'image') {
      if (
        'url' in value &&
        typeof value.url === 'string' &&
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.url)
      ) {
        return { type: 'image', url: value.url };
      }
      throw new Error('The AI service returned an invalid image. Please try again.');
    }
  }
  throw new Error('The AI service returned an unreadable response. Please try again.');
}

@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly http = inject(HttpClient);

  generate(request: GenerationRequest): Observable<GenerationEvent> {
    return new Observable((subscriber) => {
      let consumed = 0;
      let receivedImage = false;
      const subscription = this.http
        .post('/api/generate', request, {
          observe: 'events',
          reportProgress: true,
          responseType: 'text',
          timeout: 150_000,
        })
        .subscribe({
          next: (event) => {
            const text =
              event.type === HttpEventType.DownloadProgress
                ? event.partialText
                : event.type === HttpEventType.Response
                  ? event.body
                  : null;
            if (!text) return;
            const end = text.lastIndexOf('\n') + 1;
            const lines = text.slice(consumed, end).split('\n').filter(Boolean);
            consumed = end;
            try {
              for (const line of lines) {
                const message = parseEvent(line);
                if (message.type === 'error') throw new Error(message.message);
                if (message.type === 'image') receivedImage = true;
                subscriber.next(message);
              }
            } catch (error) {
              subscriber.error(error);
            }
          },
          error: (error: HttpErrorResponse) => {
            const timedOut =
              error.status === 408 ||
              error.status === 504 ||
              error.error?.name === 'TimeoutError' ||
              error.error?.type === 'timeout';
            let message = timedOut
              ? 'The image request took too long. Please try again.'
              : error.status === 0
                ? 'Cannot reach the AI service. Check your connection and try again.'
                : 'The AI service could not complete this request. Please try again.';
            try {
              const body: unknown = JSON.parse(error.error);
              if (
                body &&
                typeof body === 'object' &&
                'error' in body &&
                typeof body.error === 'string'
              )
                message = body.error || message;
            } catch {
              /* Proxy errors may not contain JSON. */
            }
            subscriber.error(new Error(message));
          },
          complete: () => {
            if (receivedImage) subscriber.complete();
            else
              subscriber.error(
                new Error('The connection ended before an image arrived. Please try again.'),
              );
          },
        });
      return () => subscription.unsubscribe();
    });
  }
}

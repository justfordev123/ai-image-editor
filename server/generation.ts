import type { Request, Response } from 'express';
import { setTimeout as delay } from 'node:timers/promises';
import type { GenerationRequest, GenerationEvent } from '../src/app/models.js';

export function validateRequest(input: unknown): GenerationRequest {
  if (!input || typeof input !== 'object') throw new Error('An image request is required.');
  const value = input as GenerationRequest;
  if (value.intent !== 'create' && value.intent !== 'edit')
    throw new Error('Choose image creation or editing.');
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 2000)
    throw new Error('Enter a prompt of 1–2,000 characters.');
  if (value.intent === 'create') return { intent: 'create', prompt: value.prompt.trim() };
  if (
    typeof value.source !== 'string' ||
    !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value.source) ||
    value.source.length > 5_500_000
  ) {
    throw new Error('Use a PNG or JPEG source image under 4 MB.');
  }
  return { intent: 'edit', prompt: value.prompt.trim(), source: value.source };
}

export function errorDetails(error: unknown): { status: number; message: string } {
  const status = (error as { status?: number })?.status ?? 500;
  const messages: Record<number, string> = {
    400: 'Azure could not process this prompt or image. Try a different prompt or image.',
    401: 'The AI service could not authenticate. Please contact the demo owner.',
    402: 'AI credits are exhausted. Please contact the demo owner.',
    403: 'This demo cannot access the image model. Please contact the demo owner.',
    404: 'The image model is unavailable. Please contact the demo owner.',
    408: 'Azure timed out while processing the image. Please try again.',
    429: 'The AI service is busy or its quota is exhausted. Wait a moment and try again.',
    503: 'The Azure image model is temporarily unavailable. Try again shortly.',
    504: 'The image request took too long. Please try again.',
  };
  return {
    status,
    message: messages[status] ?? 'The AI service could not return an image. Please try again.',
  };
}

export function imageEndpoint(endpoint: string, intent: GenerationRequest['intent']): URL {
  const url = new URL(endpoint);
  const path = url.pathname.replace(/\/+$/, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !['', '/openai/v1', '/openai/v1/images/generations', '/openai/v1/images/edits'].includes(path)
  ) {
    throw new Error('Use an Azure resource URL or its /openai/v1/images/generations endpoint.');
  }
  url.pathname = `/openai/v1/images/${intent === 'create' ? 'generations' : 'edits'}`;
  return url;
}

export function parseRetryAfter(header: string | null): number {
  if (!header) return 0;
  const seconds = Number(header);
  return Number.isFinite(seconds)
    ? Math.max(0, seconds)
    : Math.max(0, (Date.parse(header) - Date.now()) / 1000) || 0;
}

export function retryDelay(status: number, attempt: number, retryAfter = 0): number | null {
  // A timeout or server error may follow billable work. Only retry explicit rate-limit rejections.
  if (attempt >= 2 || status !== 429 || retryAfter > 30) return null;
  return Math.max(retryAfter * 1000, 1000 * 2 ** attempt);
}

export async function generate(req: Request, res: Response): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Use POST.' });
    return;
  }
  let request: GenerationRequest;
  try {
    request = validateRequest(req.body);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  const apiKey = process.env['AZURE_OPENAI_API_KEY']?.trim();
  const endpoint = process.env['AZURE_OPENAI_ENDPOINT']?.trim();
  const model = process.env['AZURE_OPENAI_DEPLOYMENT']?.trim() || 'gpt-image-2';
  if (!apiKey || !endpoint) {
    res.status(503).json({
      error: 'AI is not available in this demo yet. You can still upload and edit images.',
    });
    return;
  }
  let url: URL;
  try {
    url = imageEndpoint(endpoint, request.intent);
  } catch {
    res.status(503).json({ error: 'AI is unavailable. Please contact the demo owner.' });
    return;
  }

  const parameters = {
    model,
    prompt: request.prompt,
    n: 1,
    size: request.intent === 'create' ? '1024x1024' : 'auto',
    quality: 'medium',
    output_format: 'png',
  };
  let body: string | FormData = JSON.stringify(parameters);
  const headers: Record<string, string> = { 'api-key': apiKey };
  if (request.intent === 'edit') {
    const form = new FormData();
    for (const [key, value] of Object.entries(parameters)) form.set(key, String(value));
    const mime = request.source.slice(5, request.source.indexOf(';'));
    form.set(
      'image',
      new Blob([Buffer.from(request.source.split(',')[1], 'base64')], { type: mime }),
      mime === 'image/png' ? 'canvas.png' : 'canvas.jpg',
    );
    body = form;
    // fetch supplies the multipart boundary; setting Content-Type here would break uploads.
  } else {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('The image request timed out after 2 minutes.')),
    120_000,
  );
  res.on('close', () => controller.abort());
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (event: GenerationEvent) => {
    if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };
  const startedAt = Date.now();
  const heartbeat = setInterval(
    () =>
      send({
        type: 'status',
        message: `Waiting for the model · ${Math.floor((Date.now() - startedAt) / 1000)}s`,
      }),
    10_000,
  );
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let retryAfter = 0;
      let accepted = false;
      try {
        send({
          type: 'status',
          message: attempt
            ? 'Requesting the model again…'
            : request.intent === 'create'
              ? 'Creating your image with Azure…'
              : 'Editing your image with Azure…',
        });
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
          redirect: 'error',
        });
        retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        if (!response.ok) {
          await response.body?.cancel();
          throw Object.assign(new Error('Azure image request failed.'), {
            status: response.status,
          });
        }
        accepted = true;
        const result = (await response.json()) as { data?: { b64_json?: unknown }[] } | null;
        const image = result?.data?.[0]?.b64_json;
        if (
          typeof image !== 'string' ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(image) ||
          !Buffer.from(image, 'base64')
            .subarray(0, 8)
            .equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        ) {
          throw new Error('Azure did not return a PNG image.');
        }
        send({
          type: 'image',
          url: `data:image/png;base64,${image}`,
        });
        break;
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        const details = errorDetails(error);
        // Never resubmit after a successful HTTP response, even if its image body is invalid.
        const wait = accepted ? null : retryDelay(details.status, attempt, retryAfter);
        if (wait === null) {
          send({ type: 'error', message: details.message });
          break;
        }
        send({
          type: 'status',
          message: `Provider is busy. Retrying in ${wait / 1000}s (retry ${attempt + 1}/2)…`,
        });
        await delay(wait, undefined, { signal: controller.signal });
      }
    }
  } catch {
    send({
      type: 'error',
      message: controller.signal.aborted
        ? 'The image request timed out or was cancelled. Please try again.'
        : 'Could not complete the image request. Please try again.',
    });
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timeout);
    res.end();
  }
}

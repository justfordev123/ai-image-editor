import { test, type TestContext } from 'node:test';
import { EventEmitter } from 'node:events';
import type { Request, Response as ServerResponse } from 'express';
import assert from 'node:assert/strict';
import {
  errorDetails,
  generate,
  imageEndpoint,
  parseRetryAfter,
  retryDelay,
  validateRequest,
} from './generation.js';

const valid = {
  intent: 'edit',
  prompt: 'Make the background darker',
  source: 'data:image/png;base64,YQ==',
};
test('accepts only the prompt and source, discarding legacy generation settings', () => {
  assert.deepEqual(validateRequest(valid), valid);
  assert.deepEqual(
    validateRequest({
      ...valid,
      mode: 'create',
      model: 'https://attacker.example',
      batch: 4,
      steps: 10000,
    }),
    valid,
  );
});
test('requires a bounded prompt and an inline source image for editing', () => {
  for (const invalid of [
    { prompt: ' ' },
    { prompt: 42 },
    { prompt: 'a'.repeat(2001) },
    { intent: undefined },
    { intent: 'invalid' },
    { source: undefined },
    { source: '' },
    { source: 'https://example.com/image.png' },
    { source: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { source: 'data:image/webp;base64,YQ==' },
    { source: 'data:image/png;base64,' + 'A'.repeat(5_500_000) },
  ]) {
    assert.throws(() => validateRequest({ ...valid, ...invalid }));
  }
  assert.throws(() => validateRequest(null));
});
test('creation requires an explicit intent and uses only the prompt', () => {
  assert.deepEqual(
    validateRequest({ intent: 'create', prompt: ' A blue vase ', model: 'other/model', batch: 4 }),
    {
      intent: 'create',
      prompt: 'A blue vase',
    },
  );
  assert.throws(() => validateRequest({ intent: 'create', prompt: ' ' }));
  assert.throws(() => validateRequest({ prompt: 'A blue vase' }));
});
test('retries rate limits with bounded delay but not potentially billable server failures', () => {
  assert.equal(retryDelay(429, 0), 1000);
  assert.equal(retryDelay(429, 1), 2000);
  assert.equal(retryDelay(429, 2), null);
  assert.equal(retryDelay(429, 0, 12), 12000);
  assert.equal(retryDelay(429, 0, 60), null);
  for (const status of [400, 401, 402, 403, 404, 408, 500, 502, 503, 504])
    assert.equal(retryDelay(status, 0), null);
});
test('parses Retry-After seconds and dates without invalid timers', () => {
  assert.equal(parseRetryAfter('12'), 12);
  assert.equal(parseRetryAfter('invalid'), 0);
  assert.equal(parseRetryAfter('-1'), 0);
  assert.ok(parseRetryAfter(new Date(Date.now() + 10000).toUTCString()) > 8);
});
test('does not expose provider internals or credentials in errors', () => {
  assert.match(errorDetails({ status: 402, message: 'secret' }).message, /credits/);
  assert.doesNotMatch(errorDetails(new Error('azure_private_key')).message, /private_key/);
});

const azureOrigin = 'https://fixture.services.ai.azure.com';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

function configureAzure(t: TestContext) {
  for (const [key, value] of Object.entries({
    AZURE_OPENAI_API_KEY: 'azure_test_key',
    AZURE_OPENAI_ENDPOINT: `${azureOrigin}/openai/v1/images/generations`,
    AZURE_OPENAI_DEPLOYMENT: 'studio-image-deployment',
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

function createResponse() {
  return Object.assign(new EventEmitter(), {
    destroyed: false,
    ended: false,
    statusCode: 200,
    jsonBody: undefined as unknown,
    headers: {} as Record<string, string>,
    events: [] as { type: string; url?: string; message?: string }[],
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    flushHeaders() {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.jsonBody = body;
    },
    end() {
      this.ended = true;
    },
    write(line: string) {
      this.events.push(JSON.parse(line));
    },
  });
}

async function run(body: unknown = valid, response = createResponse(), method = 'POST') {
  await generate({ method, body } as Request, response as unknown as ServerResponse);
  return response;
}

test('resolves both Azure image routes from resource, v1, or full endpoint URLs', () => {
  for (const path of [
    '',
    '/',
    '/openai/v1/',
    '/openai/v1/images/generations',
    '/openai/v1/images/edits',
  ]) {
    assert.equal(
      imageEndpoint(`${azureOrigin}${path}`, 'create').href,
      `${azureOrigin}/openai/v1/images/generations`,
    );
    assert.equal(
      imageEndpoint(`${azureOrigin}${path}`, 'edit').href,
      `${azureOrigin}/openai/v1/images/edits`,
    );
  }
  assert.equal(
    imageEndpoint(`${azureOrigin}/openai/v1/images/generations?api-version=preview`, 'edit').search,
    '?api-version=preview',
  );
  for (const endpoint of [
    'invalid',
    'http://fixture.example',
    `${azureOrigin}/wrong/path`,
    'https://key@fixture.example',
  ]) {
    assert.throws(() => imageEndpoint(endpoint, 'create'));
  }
});

test('sends Azure JSON creation and multipart current-image edits with server-only configuration', async (t) => {
  configureAzure(t);
  let creating = true;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: URL, init: RequestInit) => {
    assert.equal(
      input.href,
      `${azureOrigin}/openai/v1/images/${creating ? 'generations' : 'edits'}`,
    );
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert(init.signal instanceof AbortSignal);
    const headers = new Headers(init.headers);
    assert.equal(headers.get('api-key'), 'azure_test_key');
    assert.equal(headers.get('Authorization'), null);
    const parameters = {
      model: 'studio-image-deployment',
      prompt: creating ? 'A blue vase' : valid.prompt,
      n: 1,
      size: creating ? '1024x1024' : 'auto',
      quality: 'medium',
      output_format: 'png',
    };
    if (creating) {
      assert.equal(headers.get('Content-Type'), 'application/json');
      assert.deepEqual(JSON.parse(String(init.body)), parameters);
    } else {
      assert.equal(headers.get('Content-Type'), null);
      assert(init.body instanceof FormData);
      const form = init.body;
      for (const [key, value] of Object.entries(parameters))
        assert.equal(form.get(key), String(value));
      assert.deepEqual([...form.keys()].sort(), [...Object.keys(parameters), 'image'].sort());
      const file = form.get('image');
      assert(file instanceof File);
      assert.equal(file.type, 'image/jpeg');
      assert.equal(file.name, 'canvas.jpg');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from([255, 216, 255, 217]));
    }
    return Response.json({ data: [{ b64_json: png }] });
  });
  const created = await run({ intent: 'create', prompt: ' A blue vase ', model: 'client-model' });
  creating = false;
  const edited = await run({ ...valid, source: 'data:image/jpeg;base64,/9j/2Q==' });
  for (const response of [created, edited]) {
    assert.equal(response.headers['Content-Type'], 'application/x-ndjson');
    assert.deepEqual(response.events.at(-1), {
      type: 'image',
      url: `data:image/png;base64,${png}`,
    });
    assert.equal(response.ended, true);
  }
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('retries a rejected Azure request and returns its image exactly once', async (t) => {
  configureAzure(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === 1
      ? Response.json({ error: 'Busy' }, { status: 429, headers: { 'Retry-After': '1' } })
      : Response.json({ data: [{ b64_json: png }] });
  });
  const { events } = await run();
  assert.equal(calls, 2);
  assert(events.some((event) => event.message?.includes('Retrying in 1s')));
  assert.equal(events.filter((event) => event.type === 'image').length, 1);
});

test('does not retry auth errors, server errors, network failures, or invalid successful responses', async (t) => {
  configureAzure(t);
  const cases = [
    () => Response.json({ error: 'azure_private_key' }, { status: 401 }),
    () => Response.json({ error: 'private details' }, { status: 504 }),
    () => Response.json({ error: 'Busy' }, { status: 429, headers: { 'Retry-After': '60' } }),
    () => {
      throw new Error('azure_private_key');
    },
    () => new Response('{'),
    () => Response.json(null),
    () => Response.json({ data: [] }),
    () => Response.json({ data: [{ url: 'https://fixture.example/result.png' }] }),
    () => Response.json({ data: [{ b64_json: 'not an image' }] }),
    () => Response.json({ data: [{ b64_json: 'YQ==' }] }),
  ];
  for (const response of cases) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => response());
    const { events } = await run();
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(events.at(-1)?.type, 'error');
    assert.doesNotMatch(JSON.stringify(events), /azure_private_key|private details/);
    fetchMock.mock.restore();
  }
});

test('rejects invalid requests and missing Azure configuration before contacting the model', async (t) => {
  configureAzure(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected request');
  });
  assert.equal((await run({}, createResponse(), 'GET')).statusCode, 405);
  assert.equal((await run({ intent: 'edit', prompt: 'No source' })).statusCode, 400);
  process.env['AZURE_OPENAI_ENDPOINT'] = 'https://fixture.example/wrong';
  assert.equal((await run()).statusCode, 503);
  delete process.env['AZURE_OPENAI_API_KEY'];
  const missingKey = await run();
  assert.equal(missingKey.statusCode, 503);
  assert.match(JSON.stringify(missingKey.jsonBody), /upload and edit/);
  assert.doesNotMatch(JSON.stringify(missingKey.jsonBody), /AZURE_OPENAI|\.env/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('aborts the Azure request when the browser disconnects without resubmission', async (t) => {
  configureAzure(t);
  const response = createResponse();
  let signal: AbortSignal | undefined;
  const fetchMock = t.mock.method(globalThis, 'fetch', (_input: URL, init: RequestInit) => {
    signal = init.signal!;
    return new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      response.destroyed = true;
      response.emit('close');
    });
  });
  await run(valid, response);
  assert.equal(signal?.aborted, true);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(response.ended, true);
  assert.equal(response.events.filter((event) => event.type === 'image').length, 0);
});

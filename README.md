# Image Studio

**[Open the live demo](https://ai-image-editor-silk.vercel.app/)** — Vercel sign-in or a separately shared reviewer link is required.

A small Angular image editor for the frontend assessment. Angular Material owns the controls; TUI Image Editor **3.15.0** owns the canvas. A single server endpoint connects to Azure OpenAI **gpt-image-2**, keeping the API key out of the browser.

**Demo status:** deployed to Vercel on September 11, 2026, from this checkout. Source is available in the [public GitHub repository](https://github.com/justfordev123/ai-image-editor). Azure provides image creation and editing, and the supplied brand fonts are bundled locally. Deployment and verification details are recorded below.

![Empty canvas with sample, upload, and AI generation choices](docs/screenshots/empty-canvas.png)

## Run locally

Use Node.js 22.12+ (tested with 22.22.2) and npm.

```sh
git clone https://github.com/justfordev123/ai-image-editor.git
cd ai-image-editor
npm ci
cp .env.example .env
# Add AZURE_OPENAI_API_KEY to .env and confirm the endpoint and deployment name.
npm start
```

Open [http://127.0.0.1:4200](http://127.0.0.1:4200). The command starts Angular on port 4200 and the API on port 3001. The editor, upload, adjustments, sample, and export work without an API key. Using either AI action without configuration produces an actionable error; it never substitutes a sample for an API result.

## Configure AI — Azure GPT Image 2

1. Deploy `gpt-image-2` in your Azure resource and obtain its API key from **Keys and Endpoint**.
2. Set `AZURE_OPENAI_API_KEY` in the root `.env`. Confirm `AZURE_OPENAI_ENDPOINT` and set `AZURE_OPENAI_DEPLOYMENT` to the actual deployment name (default: `gpt-image-2`).
3. Restart the API after changing `.env`. Credentials stay on the server; `HF_TOKEN` is no longer used.
4. Start with the sample, upload your own image, or click **Generate with AI** inside the empty canvas. Once an image is open, select AI in the toolbar to edit it.

Replace the placeholder endpoint in `.env.example` with your own Azure resource:

```dotenv
AZURE_OPENAI_ENDPOINT=https://your-resource.services.ai.azure.com/openai/v1/images/generations
AZURE_OPENAI_DEPLOYMENT=gpt-image-2
AZURE_OPENAI_API_KEY=
```

The server uses Node's built-in `fetch` with the `api-key` header. Creation sends JSON to `/openai/v1/images/generations`; editing sends the current canvas as a multipart image to `/openai/v1/images/edits` on the same resource. A resource URL or `/openai/v1/` base URL also works, and any explicit API-version query is retained. The `model` field uses the deployment name. Both operations request one PNG at medium quality; creation uses 1024×1024 and editing uses automatic sizing. See the [Azure image guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/dall-e) and [v1 image API reference](https://learn.microsoft.com/en-us/azure/foundry/openai/reference-preview-latest).

`POST /api/generate` accepts `{ intent: "create", prompt }` or `{ intent: "edit", prompt, source }`. Editing always requires a source image; a missing source never silently switches to creation. The endpoint streams status events and a Base64 image result for either operation.

AI edits the current image once per click. The source includes canvas adjustments and drawing, and is sent as a JPEG with its longest side capped at 1024 pixels. A successful result replaces the canvas and is saved in local history. Exact pixel fidelity is not guaranteed.

Azure returns `data[0].b64_json`; the server checks for PNG data and wraps it in a data URL for the editor. WebP uploads remain supported locally and are converted with the rest of the canvas to JPEG before editing. The original Hugging Face option has been replaced by Azure per the revised request.

## Features

- When there is no saved image to restore, the editor offers three choices inside the empty canvas: **Use sample image**, **Upload an image**, and **Generate with AI**. The editing toolbar, canvas title, and undo/redo controls remain hidden until an image is loaded. Generation opens a compact prompt form in the same area. The chosen image replaces those controls and enables editing.
- Upload PNG, JPEG, or WebP; crop, rotate, flip, draw, adjust brightness/contrast/saturation, undo/redo, and export PNG.
- Separate AI and Adjust panels, opened from their left toolbar buttons (or the mobile Tools menu). Closing a panel expands the canvas.
- The Creaition design palette uses primary grey `#efefee`, secondary grey `#bebebe`, background `#f0f0f0`, white `#ffffff`, and black `#000000`. Supporting text is black, separators use secondary grey, and the canvas uses primary grey. Standard action buttons use 50px corners and a 35px minimum height; inputs use square corners and a 50px field baseline, while multiline prompts remain taller. Cards use `1rem` corners. Hover inverts button colors between black and white and changes only the variable font slant from 0 to 12.
- Mobile-first layout at 640, 768, 1024, and 1280px. Tools collapse below 768px; properties use a Material dialog below 1024px.
- AI panel with one prompt textarea and an Edit image button. The sidebar stays focused on editing. Initial image creation is available inside the empty canvas; style/enhancement controls, suggestions, model selection, batches, and advanced settings remain removed at the user’s request.
- Loading feedback and streamed request/waiting/retry messages. Inputs are disabled during AI requests; failures preserve the prompt and current canvas and allow retry. Feedback remains visible when the AI panel is closed. A 150-second browser timeout also releases stalled requests.
- The chosen sample, uploaded originals, and AI results are saved in local explorations with favorites in IndexedDB. Explorations displays only saved images; deleting the sample removes its card without adding a sample shortcut in its place. Deleting the active image opens the next saved image, or returns to the start choices when none remain. Deletion is disabled during loading and AI requests. The prompt and last selected image ID stay in localStorage. Refresh reopens that selection, including an older history entry; the sample is stored once rather than duplicated each time it is opened. Uploaded files retain their names and can be reopened after a reload without creating duplicate entries. The most recent 30 non-favorites and all favorites are retained. Storage failures are visible, and images remain available in memory for the session.

## Architecture and decisions

```text
ImageEditorComponent
  ├── CanvasStartComponent → sample / upload / AI creation
  ├── ToolbarComponent → TUI canvas commands
  ├── AiPanelComponent → EditorStore (RxJS)
  ├── PropertiesPanelComponent → canvas adjustments
  └── History/favorites → EditorStore → IndexedDB

EditorStore → AiService (Angular HttpClient)
            → POST /api/generate (NDJSON stream)
            → Azure OpenAI images API → gpt-image-2 → PNG
```

- **One store, one endpoint.** A `BehaviorSubject` holds image-request state. One RxJS subscription handles each request, and component teardown aborts pending requests. No NgRx, routing layer, database server, or account system is needed for this scope.
- **Refresh restoration.** Startup waits for local history before presenting the canvas. Selection is remembered as soon as an image is chosen, so a refresh during loading can resume it; a failed load restores the previous selection. If the first sample write was interrupted, its record can be recovered from the bundled asset. Manual canvas edits and undo/redo are not serialized; refresh restores the selected history image.
- **Custom Angular controls over headless TUI.** This avoids the built-in UI's mobile size constraints. `creaition-theme.ts` configures TUI canvas selection controls, while `styles.scss` applies the same design language to Material. Canvas CSS resizing preserves export pixels and does not add undo entries.
- **Browser distributions for the old library.** `angular.json` loads the official Fabric/TUI browser bundles in dependency order. Importing the package entry with a modern bundler pulls in Fabric's Node dependencies. TUI's published 3.15.0 distribution still contains older version comments; the npm version is pinned correctly.
- **Honest progress.** The endpoint streams request status and a waiting heartbeat while Azure produces the final image. Partial-image streaming is not enabled, and the UI does not fabricate percentages.
- **Bounded retries.** HTTP 429 rejections retry at 1s then 2s, respecting `Retry-After` up to 30 seconds. Network failures, server errors, timeouts, and malformed successful responses are not automatically resubmitted because Azure may already have performed billable work. Authentication and invalid requests also fail without retry. A request times out after two minutes.
- **Server-only credentials.** `.env` is ignored by Git. The server fixes the model and parameters for each intent, and validates the prompt and any required source image. It does not accept arbitrary inference URLs or source-image URLs. Uploaded image files stay local unless explicitly used for AI editing.

## Fonts

`styles.scss` loads the user-supplied `strokeWeightvar.ttf` and `Eina03-Regular.ttf` from `public/fonts/`. The primary variable font exposes `wght` from 20–180 and `slnt` from −12–12; the UI uses weights 60/80/120. Buttons keep the same `strokeWeight(var)` font family and weight 60, with slant 0 normally and 12 on enabled hover; the separate static hover font remains removed. See [font details](public/fonts/README.md).

## Validation

See the [success-indicator review](docs/success-indicators.md) for criterion-by-criterion evidence, fixes, and remaining submission limitations.

```sh
npm run check       # Formatting, API TypeScript, unit/server tests, production build
npm run test:e2e    # Real Chromium editor workflows; provider responses are fixtures
```

If Chromium is missing, run `npx playwright install chromium` once.

The tests cover split NDJSON chunks, readable failures, truncated responses, request abortion, legacy preference cleanup, required source images, request validation, retry timing, Azure endpoint resolution, JSON generation and multipart editing contracts, Base64 PNG responses, and prevention of duplicate submissions after ambiguous failures. External fetches are mocked in automated tests.

Browser checks cover the three empty-canvas choices, file-picker cancellation, invalid-file recovery, creation failure/retry and transition to editing, canvas loading, crop, rotation, drawing, filters, undo/redo, PNG export, current-canvas AI requests, sample/upload persistence and restoration after refresh, selection of older history entries, refresh during sample loading, persistent favorites/prompts, history card alignment and non-overlapping controls, duplicate-request prevention, mobile dialog focus, and overflow at 320/640/768/1024/1280px. They do not spend provider credits.

**Azure live check:** on September 10, 2026, two authenticated requests through the app succeeded with `gpt-image-2`: creation returned a 1024×1024 PNG in 76 seconds; editing returned a 1254×1254 PNG in 83.6 seconds using automatic sizing. Visual inspection confirmed a white vase on a grey background, followed by the same vase on a pastel blue background. Both images appeared in history, which restored after refresh. See the [creation result](docs/screenshots/live-azure-create-result.png), [edited result](docs/screenshots/live-azure-edit-result.png), [app screenshot](docs/screenshots/live-azure-edit.png), and [check metadata](docs/live-azure-check.json). These checks verify the two local requests; the later hosted verification is recorded below.

**Historical provider evidence:** the previous Qwen integration completed one live edit and encountered exhausted credits on creation on September 10, 2026. Those records remain in [edit metadata](docs/live-ai-check.json) and [creation metadata](docs/live-create-check.json); they do not verify Azure.

**Latest assessment check:** on September 11, the reviewed deployment created a 1024×1024 PNG through the real UI in 36.4 seconds with one request. Favorites restored after refresh, deleting the active image returned to the start choices, and the served bundle matched the tested build. Brand tokens, primary font loading, hover typography, and absence of the configured API key in frontend assets were verified. See [the application screenshot](docs/screenshots/assessment-live-create.png).

**Earlier Vercel live check:** on September 11, 2026, the deployed API created a 1024×1024 PNG in 47.4 seconds. Opening the reviewer link without a Vercel login also allowed a real edit through the deployed UI: the sample’s background became pastel blue, the 1254×1254 result replaced the canvas, and history contained both images. See [deployment verification](docs/vercel-deployment.json). These are two successful demo requests, not a load or reliability test. The original sample was generated separately; see [sample provenance](docs/sample-provenance.txt) and the [requirement checklist](docs/requirements.md).

### Dependency limitation

`npm audit` currently reports **10 findings (6 moderate, 2 high, 2 critical)** in the mandatory TUI 3.15.0 / Fabric dependency tree, including legacy Node-only `request` and `form-data` dependencies. The test tooling was updated to address its separately fixable advisories. TUI runs only in the browser here; SVG import/export is not offered, and Fabric's Node rendering path is not bundled or used by the API. These boundaries reduce exposure but do not make the dependency tree security-clean. Replacing or upgrading the editor should be assessed before a production rollout; changing the required version was intentionally avoided.

## Vercel demo deployment

The demo is deployed at [ai-image-editor-silk.vercel.app](https://ai-image-editor-silk.vercel.app), with Vercel Authentication enabled for all deployment URLs. The reviewer share link is provided separately and expires on September 18, 2026; it is not stored in source control. The [deployment dashboard](https://vercel.com/xinyu9/ai-image-editor/3qzdWenqQUWY85QF6TeZSpLKb7k8) shows the deployed build.

- Vercel project: `xinyu9/ai-image-editor`.
- Angular build: `npm run build`; output: `dist/ai-image-editor/browser`.
- API: `api/generate.ts`, running on Node.js 22 with Fluid Compute and a 180-second function limit. The application itself cancels image requests after 120 seconds.
- `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, and `AZURE_OPENAI_DEPLOYMENT` are configured as secrets for Production and Preview. The API key was verified absent from the frontend build.
- `.vercelignore` excludes environment files, local build/cache output, test files, screenshots, and temporary artifacts from uploads.
- Local validation before deployment passed the production build, 27 unit/server tests, and 18 browser tests.

To update the demo from this linked checkout:

```sh
npm run check
npx vercel deploy --prod
```

Keep deployment protection enabled when using funded Azure credentials. The app has no account system or distributed rate limiter. A share link grants access to anyone who has it; manage or revoke it through Vercel. History stays in each visitor's browser and is not shared between devices. Source is published at [justfordev123/ai-image-editor](https://github.com/justfordev123/ai-image-editor).

## Screenshots

[Empty canvas](docs/screenshots/empty-canvas.png) · [Mobile empty canvas](docs/screenshots/empty-canvas-mobile.png) · [Inline generation](docs/screenshots/create-image.png) · [Upload history](docs/screenshots/upload-history.png) · [Button hover](docs/screenshots/button-hover.png) · [Live Azure creation](docs/screenshots/live-azure-create.png) · [Live Azure edit](docs/screenshots/live-azure-edit.png) · [Desktop](docs/screenshots/desktop.png) · [Adjust panel](docs/screenshots/adjust.png) · [Mobile canvas](docs/screenshots/mobile.png) · [Mobile properties](docs/screenshots/mobile-properties.png)

## References

- [TUI Image Editor](https://ui.toast.com/tui-image-editor) and [source/API](https://github.com/nhn/tui.image-editor)
- [Azure image generation models](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/dall-e)
- [Azure v1 image REST API](https://learn.microsoft.com/en-us/azure/foundry/openai/reference-preview-latest)
- [Angular version compatibility](https://angular.dev/reference/versions)

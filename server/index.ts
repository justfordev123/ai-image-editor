import express from 'express';
import { generate } from './generation.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' }));
app.all('/api/generate', generate);
app.use(
  (
    error: { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(error.status ?? 500).json({
      error:
        error.status === 413
          ? 'The image is too large. Use an image under 4 MB.'
          : 'Could not read this request.',
    });
  },
);
app.listen(3001, '127.0.0.1', () => console.log('AI API ready at http://127.0.0.1:3001'));

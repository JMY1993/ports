import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { routes } from './routes.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = new Hono();
// Middleware
app.use(cors());
// API routes
app.route('/', routes);
// Serve static files from UI build
const uiBuildPath = path.join(__dirname, '../../ui/dist');
// Check if UI build exists
const uiBuildExists = fs.existsSync(uiBuildPath);
if (uiBuildExists) {
    // Serve static files
    app.use('/*', async (c, next) => {
        // Skip API routes
        if (c.req.path.startsWith('/api')) {
            return next();
        }
        const filePath = path.join(uiBuildPath, c.req.path === '/' ? 'index.html' : c.req.path);
        try {
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                const content = fs.readFileSync(filePath);
                const ext = path.extname(filePath).toLowerCase();
                const mimeTypes = {
                    '.html': 'text/html',
                    '.js': 'application/javascript',
                    '.css': 'text/css',
                    '.json': 'application/json',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.svg': 'image/svg+xml',
                    '.ico': 'image/x-icon',
                };
                const contentType = mimeTypes[ext] || 'application/octet-stream';
                return c.body(content, { headers: { 'Content-Type': contentType } });
            }
        }
        catch {
            // Ignore errors and fall through
        }
        // For SPA routing, return index.html if not found
        if (c.req.path !== '/' && !c.req.path.startsWith('/api')) {
            const indexPath = path.join(uiBuildPath, 'index.html');
            if (fs.existsSync(indexPath)) {
                const content = fs.readFileSync(indexPath);
                return c.html(content.toString());
            }
        }
        return next();
    });
}
// Default route / health check
app.get('/', (c) => {
    if (!uiBuildExists) {
        return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Vibe Ports UI</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 600px; margin: 0 auto; }
            h1 { color: #333; }
            code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
            .error { color: #d32f2f; margin: 1rem 0; }
          </style>
        </head>
        <body>
          <h1>Vibe Ports UI Server</h1>
          <p>Server is running, but the UI build is not available.</p>
          <p class="error">⚠️ Build the frontend: <code>cd ui && npm run build</code></p>
          <p>Or run: <code>npm run build:ui</code> from the root directory.</p>
        </body>
      </html>
    `);
    }
    return c.text('Vibe Ports UI Server is running');
});
const PORT = parseInt(process.env.PORT || '3000', 10);
serve({
    fetch: app.fetch,
    port: PORT
}, (info) => {
    console.log(`Vibe Ports UI Server is running on http://localhost:${info.port}`);
    if (uiBuildExists) {
        console.log('✓ UI build found and served');
    }
    else {
        console.log('⚠ UI build not found - serving API only');
    }
});

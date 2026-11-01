import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function adminApiPlugin() {
  const handler = async (req: any, res: any) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const authHeader = req.headers['authorization'];
          const { handleCreateStaff } = await import('./api/staff/create.js');
          const result = await handleCreateStaff(data, authHeader);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message || 'Failed to create staff account' }));
        }
      });
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  };

  const logoHandler = async (req: any, res: any) => {
    if (req.method === 'GET') {
      try {
        const url = new URL(req.url, 'http://localhost');
        const schoolId = url.searchParams.get('school_id');
        const { handleGetSchoolLogo } = await import('./api/school/logo.js');
        const result = await handleGetSchoolLogo(schoolId);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message || 'Failed to get school logo' }));
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const authHeader = req.headers['authorization'];
          const { handleSchoolLogo } = await import('./api/school/logo.js');
          const result = await handleSchoolLogo(data, authHeader);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message || 'Failed to update school logo' }));
        }
      });
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  };

  const smsHandler = async (req: any, res: any) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const authHeader = req.headers['authorization'];
          const { handleSendSMS } = await import('./api/communication/send-sms.js');
          const result = await handleSendSMS(data, authHeader);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message || 'Failed to dispatch SMS' }));
        }
      });
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  };

  return {
    name: 'admin-api-plugin',
    configureServer(server: any) {
      server.middlewares.use('/api/staff/create', handler);
      server.middlewares.use('/api/school/logo', logoHandler);
      server.middlewares.use('/api/communication/send-sms', smsHandler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use('/api/staff/create', handler);
      server.middlewares.use('/api/school/logo', logoHandler);
      server.middlewares.use('/api/communication/send-sms', smsHandler);
    },
  };
}

// Local stack only: proxy Supabase-style paths to locally running services.
const localProxy = {
  '/auth/v1': { target: 'http://127.0.0.1:9999', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/auth\/v1/, '') },
  '/rest/v1': { target: 'http://127.0.0.1:3000', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/rest\/v1/, '') },
  '/functions/v1': { target: 'http://127.0.0.1:8000', changeOrigin: true },
  '/_dev/mail': { target: 'http://127.0.0.1:8025', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/_dev\/mail/, '') || '/' },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [react(), adminApiPlugin()],
    server: { host: '0.0.0.0', port: 5173, allowedHosts: true, proxy: localProxy },
    preview: { host: '0.0.0.0', port: 5173, allowedHosts: true, proxy: localProxy },
    build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  };
});


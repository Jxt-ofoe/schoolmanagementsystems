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

  const reportViewHandler = async (req: any, res: any) => {
    if (req.method === 'GET') {
      try {
        const url = new URL(req.url, 'http://localhost');
        const shareId = url.searchParams.get('id') || url.searchParams.get('shareId');
        const { handleReportView } = await import('./api/report/view.js');
        const result = await handleReportView(shareId);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message || 'Failed to load report card' }));
      }
      return;
    }
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  };

  const paystackInitHandler = async (req: any, res: any) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const authHeader = req.headers['authorization'];
          const { handlePaystackInit } = await import('./api/billing/paystack-init.js');
          const result = await handlePaystackInit(data, authHeader);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message || 'Failed to init Paystack checkout' }));
        }
      });
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  };

  const paystackVerifyHandler = async (req: any, res: any) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const authHeader = req.headers['authorization'];
          const { handlePaystackVerify } = await import('./api/billing/paystack-verify.js');
          const result = await handlePaystackVerify(data, authHeader);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message || 'Payment verification failed' }));
        }
      });
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  };

  const paystackWebhookHandler = async (req: any, res: any) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', async () => {
        try {
          const sig = req.headers['x-paystack-signature'];
          const { handlePaystackWebhook } = await import('./api/billing/paystack-webhook.js');
          const result = await handlePaystackWebhook(body, sig);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message || 'Webhook failed' }));
        }
      });
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  };

  const chargeRecurringHandler = async (req: any, res: any) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const authHeader = req.headers['authorization'];
          const { handleChargeRecurring } = await import('./api/billing/charge-recurring.js');
          const result = await handleChargeRecurring(data, authHeader);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message || 'Recurring charge failed' }));
        }
      });
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  };

  const sendReminderHandler = async (req: any, res: any) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const authHeader = req.headers['authorization'];
          const { handleSendReminder } = await import('./api/billing/send-reminder.js');
          const result = await handleSendReminder(data, authHeader);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message || 'Failed to dispatch reminder' }));
        }
      });
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  };

  const syncTopupHandler = async (req: any, res: any) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const authHeader = req.headers['authorization'];
          const { handleSyncTopup } = await import('./api/billing/sync-topup.js');
          const result = await handleSyncTopup(data, authHeader);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message || 'Failed to sync topup' }));
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
      server.middlewares.use('/api/report/view', reportViewHandler);
      server.middlewares.use('/api/billing/paystack-init', paystackInitHandler);
      server.middlewares.use('/api/billing/paystack-verify', paystackVerifyHandler);
      server.middlewares.use('/api/billing/paystack-webhook', paystackWebhookHandler);
      server.middlewares.use('/api/billing/charge-recurring', chargeRecurringHandler);
      server.middlewares.use('/api/billing/send-reminder', sendReminderHandler);
      server.middlewares.use('/api/billing/sync-topup', syncTopupHandler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use('/api/staff/create', handler);
      server.middlewares.use('/api/school/logo', logoHandler);
      server.middlewares.use('/api/communication/send-sms', smsHandler);
      server.middlewares.use('/api/report/view', reportViewHandler);
      server.middlewares.use('/api/billing/paystack-init', paystackInitHandler);
      server.middlewares.use('/api/billing/paystack-verify', paystackVerifyHandler);
      server.middlewares.use('/api/billing/paystack-webhook', paystackWebhookHandler);
      server.middlewares.use('/api/billing/charge-recurring', chargeRecurringHandler);
      server.middlewares.use('/api/billing/send-reminder', sendReminderHandler);
      server.middlewares.use('/api/billing/sync-topup', syncTopupHandler);
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


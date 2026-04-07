const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { createProxyMiddleware } = require('http-proxy-middleware');
const config = require('./config');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const dbRoutes = require('./routes/db');
const rpcRoutes = require('./routes/rpc');

const app = express();
const supabaseOrigin = new URL(config.supabaseUrl).origin;

function isOriginAllowed(origin) {
  if (config.corsOrigins.includes('*')) return true;
  return config.corsOrigins.includes(origin);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isOriginAllowed(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  }),
);

app.use(morgan('dev'));
app.use(
  '/supabase',
  createProxyMiddleware({
    target: supabaseOrigin,
    changeOrigin: true,
    ws: true,
    pathRewrite: { '^/supabase': '' },
    on: {
      proxyReq(proxyReq, req) {
        if (!req.headers.apikey) {
          proxyReq.setHeader('apikey', config.supabaseAnonKey);
        }
      },
    },
  }),
);
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'backend', timestamp: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'backend',
    message: 'Backend is running. Use /api/health, /api/*, and /supabase/* proxy routes.',
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'backend', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/db', dbRoutes);
app.use('/api/rpc', rpcRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, _req, res, _next) => {
  res.status(500).json({
    error: err?.message || 'Unexpected server error.',
  });
});

module.exports = app;

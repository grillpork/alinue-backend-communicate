import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import auth from './modules/auth/auth.routes';
import postRouter from './modules/post/post.routes';
import userRouter from './modules/user/user.routes';
import upload from './modules/upload/upload.routes';
import showcaseRouter from './modules/showcase/showcase.routes';
import serviceRouter from './modules/service/service.routes';
import adminRouter from './modules/admin/admin.routes';
import notificationRouter from './modules/notification/notification.routes';
import { getDb } from './config/db';

const app = new Hono();

// Logger
app.use('*', logger());

// CORS Configuration
app.use('*', async (c, next) => {
  const allowedOrigins = (
    c.env?.CORS_ORIGIN ||
    process.env.CORS_ORIGIN ||
    'http://localhost:3000,http://localhost:3001,http://localhost:5173,https://alinue.tripopsaibut.workers.dev,https://catako.site'
  )
    .split(',')
    .map((o) => o.trim());

  const corsMiddleware = cors({
    origin: (origin) => {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return origin || '*';
      }
      return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposeHeaders: ['Content-Length', 'X-Total-Count'],
    credentials: true,
    maxAge: 86400,
  });

  return corsMiddleware(c, next);
});

// URL Normalizer: หากมี double slash (//) ใน request path ให้ redirect เป็น single slash (/) ด้วย 308
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname.includes('//')) {
    url.pathname = url.pathname.replace(/\/+/g, '/');
    return c.redirect(url.toString(), 308);
  }
  await next();
});

// Root / Health Check
app.get('/', (c) => {
  return c.json({
    status: 'online',
    service: 'Alinue Backend API',
    database: 'PostgreSQL (VPS)',
    storage: 'Cloudflare R2',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', async (c) => {
  try {
    const rawUrl = c?.env?.DATABASE_URL || process.env.DATABASE_URL;
    let dbHost = 'none';
    try {
      if (rawUrl) dbHost = new URL(rawUrl).host;
    } catch {}
    const sql = getDb(c);
    const start = Date.now();
    await sql`SELECT 1`;
    const latency = Date.now() - start;
    return c.json({
      status: 'healthy',
      database: 'connected',
      dbHost,
      latency: `${latency}ms`,
      uptime: process.uptime ? process.uptime() : undefined,
    });
  } catch (err) {
    return c.json(
      {
        status: 'unhealthy',
        database: 'disconnected',
        error: err.message,
      },
      500
    );
  }
});

// Mount Modules
app.route('/api/auth', auth);
app.route('/api/posts', postRouter);
app.route('/api/users', userRouter);
app.route('/api/upload', upload);
app.route('/api/showcases', showcaseRouter);
app.route('/api/services', serviceRouter);
app.route('/api/admin', adminRouter);
app.route('/admin', adminRouter);
app.route('/api/notifications', notificationRouter);

// 404 Handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      message: `Endpoint not found: ${c.req.method} ${c.req.url}`,
    },
    404
  );
});

// Global Error Handler
app.onError((err, c) => {
  console.error('Unhandled Server Error:', err);
  return c.json(
    {
      success: false,
      message: err.message || 'Internal Server Error',
    },
    500
  );
});

export default app;

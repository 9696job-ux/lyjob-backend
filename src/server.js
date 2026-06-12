require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const authRoutes      = require('./routes/auth.routes');
const migrateRoutes   = require('./routes/migrate_full');
const entitiesRoutes  = require('./routes/entities.routes');
const functionsRoutes = require('./routes/functions.routes');
const adminRoutes     = require('./routes/admin.routes');
const sriNotifRoutes  = require('./routes/sri_notif.routes');
const sriNotifSvc    = require('./services/sri_notif.service');
const { startCronJobs } = require('./services/cron.service');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Security & Middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// CORS — allow frontend domain
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:5173',
    'http://localhost:3000',
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX) || 200,
  message:  { error: 'Demasiadas solicitudes, intenta en unos minutos' },
  skip: (req) => req.path === '/health',
});
app.use(limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiados intentos de autenticación. Espera 15 minutos.' },
});
app.use('/api/auth/login',           authLimiter);
app.use('/api/auth/register',        authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/migrate', migrateRoutes);
app.use('/api',           entitiesRoutes);
app.use('/api/functions', functionsRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/sri-notif', sriNotifRoutes);

// PayPhone webhook (no auth header needed — uses its own validation)
app.post('/api/webhook/payphone', (req, res, next) => {
  req.url = '/payphoneWebhook';
  functionsRoutes(req, res, next);
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Servir archivos del frontend para deploy
app.get('/static/:file', (req, res) => {
  const path = require('path');
  const fs   = require('fs');
  const file = req.params.file;
  const allowed = ['index.js', 'index.css'];
  if (!allowed.includes(file)) return res.status(404).send('Not found');
  const filePath = path.join(__dirname, '..', 'frontend-dist', file);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  const ext = file.endsWith('.js') ? 'application/javascript' : 'text/css';
  res.setHeader('Content-Type', ext);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(filePath);
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Lyjob Backend corriendo en puerto ${PORT}`);
  console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Frontend: ${process.env.FRONTEND_URL || 'http://localhost:5173'}\n`);
  startCronJobs();
  // Crear tablas de Notificaciones SRI si no existen
  sriNotifSvc.initAllSchedulers();
  // (tablas se crean vía el endpoint /api/migrate en el primer deploy)
  setTimeout(() => sriNotifSvc.initAllSchedulers(), 3000);
});

module.exports = app;

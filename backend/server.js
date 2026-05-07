require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');

const logger = require('./logger');
const { apiLimiter } = require('./middleware/rateLimiter');
const authRoutes = require('./routes/auth');
const vaultRoutes = require('./routes/vault');
const adminRoutes = require('./routes/admin');
const db = require('./database'); // initialize DB on startup

const app = express();
const PORT = process.env.PORT || 3001;

const isProd = process.env.NODE_ENV === 'production';

// ─── Security Headers (Helmet) ────────────────────────────────────────────────
// En développement via IP, on assouplit la CSP pour éviter que le navigateur bloque tout
app.use(helmet({
  contentSecurityPolicy: false, // Désactivé temporairement pour test
  hsts: isProd ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!isProd || !origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed by policy'));
    }
  },
  credentials: true,
}));

// ─── Body Parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: false, limit: '512kb' }));
app.use(cookieParser());

// ─── HTTP Request Logger ──────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
  skip: (req) => req.path === '/api/health',
}));

// ─── Global Rate Limiter ──────────────────────────────────────────────────────
app.use('/api', apiLimiter);

// ─── Static Files (Frontend) ──────────────────────────────────────────────────
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath, {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
    }
  },
}));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/admin', adminRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Route introuvable.' });
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
db.init().then(() => {
  // Cleanup sessions on startup
  try {
    const deleted = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    logger.info(`Cleaned up ${deleted.changes} expired sessions`);
  } catch (e) {
    logger.warn('Session cleanup failed', { error: e.message });
  }

  app.listen(PORT, () => {
    logger.info(`🔐 SecureVault backend running on port ${PORT}`);
    logger.info(`📁 Serving frontend from: ${frontendPath}`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}).catch(err => {
  logger.error('Failed to initialize database', { error: err.message });
  process.exit(1);
});

module.exports = app;

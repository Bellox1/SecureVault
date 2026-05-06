const rateLimit = require('express-rate-limit');
const logger = require('../logger');

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(429).json({ error: 'Trop de requêtes, veuillez réessayer plus tard.' });
  },
});

// Strict rate limiter for auth endpoints (anti brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 login attempts per 15 min per IP
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', { ip: req.ip });
    res.status(429).json({
      error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
    });
  },
});

// Registration: even stricter
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Register rate limit exceeded', { ip: req.ip });
    res.status(429).json({ error: 'Trop de tentatives d\'inscription. Réessayez dans 1 heure.' });
  },
});

module.exports = { apiLimiter, authLimiter, registerLimiter };

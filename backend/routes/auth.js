const express = require('express');
const router = express.Router();
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db = require('../database');
const logger = require('../logger');
const { JWT_SECRET } = require('../middleware/auth');
const { authLimiter, registerLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');

// Anti-cache middleware for auth routes
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

const LOCK_THRESHOLD = 5;          // lock after 5 failed attempts
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeEmail(email) {
  return email.toLowerCase().trim();
}

function generateToken(userId, email) {
  return jwt.sign(
    { sub: userId, email },
    JWT_SECRET,
    {
      expiresIn: '2h',
      algorithm: 'HS256',
      issuer: 'securevault',
      audience: 'securevault-api',
    }
  );
}

function setCookies(res, token) {
  res.cookie('sv_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

// ─── POST /api/auth/register-invite ──────────────────────────────────────────
// Step 1: Request registration by email
router.post('/register-invite',
  registerLimiter,
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    const { email } = req.body;
    const normalizedEmail = sanitizeEmail(email);

    try {
      // Check existing user
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
      if (existing) {
        return res.json({ message: 'Si cet email est valide, vous recevrez un lien.' });
      }

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + 30 * 60 * 1000; // 30 mins

      db.prepare('INSERT OR REPLACE INTO pending_registrations (token, email, expires_at) VALUES (?, ?, ?)')
        .run(token, normalizedEmail, expiresAt);

      // Simulation d'envoi d'email
      const inviteUrl = `${req.headers.origin}/register.html?regToken=${token}&email=${encodeURIComponent(normalizedEmail)}`;
      logger.info('Verification link generated', { inviteUrl });

      // En mode local, on renvoie l'URL pour faciliter le test
      res.json({
        message: 'Lien de vérification généré (voir console serveur).',
        devLink: process.env.NODE_ENV === 'development' ? inviteUrl : null
      });
    } catch (err) {
      logger.error('Invite error', { error: err.message });
      res.status(500).json({ error: 'Erreur lors de la génération du lien.' });
    }
  }
);

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register',
  registerLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Email invalide.'),
    body('passwordHash').isLength({ min: 64, max: 128 }).withMessage('Hash de mot de passe invalide.'),
    body('salt').isLength({ min: 32 }).withMessage('Salt invalide.'),
    body('token').notEmpty().withMessage('Token requis.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, passwordHash, salt, token } = req.body;
    const normalizedEmail = sanitizeEmail(email);

    try {
      // Verify token
      const pending = db.prepare('SELECT * FROM pending_registrations WHERE token = ? AND email = ?').get(token, normalizedEmail);
      if (!pending || pending.expires_at < Date.now()) {
        return res.status(400).json({ error: 'Lien expiré ou invalide.' });
      }

      // Hash the client-sent passwordHash with Argon2id (defense in depth)
      // The client already did PBKDF2 to derive the hash; we rehash it with Argon2id server-side
      const serverHash = await argon2.hash(passwordHash, {
        type: argon2.argon2id,
        memoryCost: 65536, // 64MB
        timeCost: 3,
        parallelism: 4,
        saltLength: 32,
      });

      const userId = uuidv4();
      const now = Date.now();

      db.prepare(`
        INSERT INTO users (id, email, password_hash, salt, kdf_iterations, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, normalizedEmail, serverHash, salt, 600000, now);

      // Delete the token
      db.prepare('DELETE FROM pending_registrations WHERE token = ?').run(token);

      logger.info('New user registered', { userId, ip: req.ip });

      res.status(201).json({
        message: 'Compte créé avec succès.',
        userId,
        salt, // client needs this to derive key on login
      });
    } catch (err) {
      logger.error('Registration error', { error: err.message });
      res.status(500).json({ error: 'Erreur lors de la création du compte.' });
    }
  }
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Email invalide.'),
    body('passwordHash').isLength({ min: 64, max: 128 }).withMessage('Hash invalide.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, passwordHash } = req.body;
    const normalizedEmail = sanitizeEmail(email);
    const GENERIC_ERROR = { error: 'Email ou mot de passe incorrect.' };

    try {
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);

      // Constant-time: always compute argon2.verify even if user not found
      const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$dummysaltdummysaltdummysalt$dummyhashvalue0000000000000000000000000000000000';
      const hashToVerify = user ? user.password_hash : dummyHash;

      // Check account lockout
      if (user && user.locked_until && user.locked_until > Date.now()) {
        const remainingMs = user.locked_until - Date.now();
        const remainingMin = Math.ceil(remainingMs / 60000);
        return res.status(423).json({
          error: `Compte verrouillé. Réessayez dans ${remainingMin} minute(s).`,
        });
      }

      const isValid = await argon2.verify(hashToVerify, passwordHash);

      if (!user || !isValid) {
        if (user) {
          const newFailedCount = (user.failed_logins || 0) + 1;
          const lockedUntil = newFailedCount >= LOCK_THRESHOLD ? Date.now() + LOCK_DURATION_MS : null;
          db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
            .run(newFailedCount, lockedUntil, user.id);

          if (lockedUntil) {
            logger.warn('Account locked due to too many failed attempts', { userId: user.id, ip: req.ip });
          }
        }
        logger.warn('Failed login attempt', { email: normalizedEmail, ip: req.ip });
        return res.status(401).json(GENERIC_ERROR);
      }

      // Reset failed logins on success
      db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = ? WHERE id = ?')
        .run(Date.now(), user.id);

      // Create JWT and session
      const token = generateToken(user.id, user.email);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const sessionId = uuidv4();
      const now = Date.now();

      db.prepare(`
        INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, created_at, expires_at, last_used)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, user.id, tokenHash, req.ip, req.headers['user-agent'] || '', now, now + SESSION_TTL_MS, now);

      setCookies(res, token);

      logger.info('User logged in', { userId: user.id, ip: req.ip });

      res.json({
        message: 'Connexion réussie.',
        user: { id: user.id, email: user.email },
        salt: user.salt, // client re-derives encryption key from this
        kdfIterations: user.kdf_iterations,
      });
    } catch (err) {
      logger.error('Login error', { error: err.message });
      res.status(500).json({ error: 'Erreur lors de la connexion.' });
    }
  }
);

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  console.log('\n\n' + '='.repeat(40));
  console.log('!!! REQUETE DE DECONNEXION RECUE !!!');
  console.log('='.repeat(40) + '\n');
  const token = req.cookies?.sv_token;
  let deletedCount = 0;

  if (token) {
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.sub) {
        const result = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(decoded.sub);
        deletedCount += (result.changes || 0);
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const result2 = db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      deletedCount += (result2.changes || 0);

      console.log(`--- LOGOUT: Deleted ${deletedCount} sessions for user ---`);
    } catch (err) {
      logger.error('Logout purge error', { error: err.message });
    }
  }
  res.clearCookie('sv_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
  res.json({ message: 'Déconnexion réussie.', deletedIndex: deletedCount });
});

// EMERGENCY PURGE (Temporary for debugging)
router.get('/purge-sessions-now', (req, res) => {
  db.prepare('DELETE FROM sessions').run();
  res.clearCookie('sv_token');
  res.send('Toutes les sessions ont été purgées. Veuillez actualiser la page d\'accueil.');
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, email, created_at, last_login, is_admin FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    logger.warn('Me check: User not found in DB but session exists', { userId: req.user.id });
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }
  console.log('--- AUTH ME SUCCESS ---', user.email);
  res.json({ user });
});

// ─── GET /api/auth/salt ────────────────────────────────────────────────────────
// Returns user's KDF salt for key derivation BEFORE login (needed for auth hash)
router.post('/salt',
  authLimiter,
  [body('email').isEmail().normalizeEmail()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Email invalide.' });

    const { email } = req.body;
    const user = db.prepare('SELECT salt, kdf_iterations FROM users WHERE email = ?').get(sanitizeEmail(email));

    // Always return same structure to prevent email enumeration
    // If user doesn't exist, return a deterministic fake salt derived from email
    if (!user) {
      const fakeSalt = crypto.createHash('sha256').update(email + 'securevault-fake').digest('hex');
      return res.json({ salt: fakeSalt, kdfIterations: 600000 });
    }

    res.json({ salt: user.salt, kdfIterations: user.kdf_iterations });
  }
);

module.exports = router;

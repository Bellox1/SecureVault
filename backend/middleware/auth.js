const jwt = require('jsonwebtoken');
const db = require('../database');
const crypto = require('crypto');
const logger = require('../logger');

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  logger.warn('JWT_SECRET not set in environment. Using random secret (sessions will not persist across restarts).');
  return crypto.randomBytes(64).toString('hex');
})();

module.exports = { JWT_SECRET };

module.exports.authenticate = (req, res, next) => {
  try {
    const token = req.cookies?.sv_token;
    if (!token) {
      return res.status(401).json({ error: 'Authentification requise.' });
    }

    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'securevault',
      audience: 'securevault-api',
    });

    // Check session in DB (token binding)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = db.prepare(`
      SELECT * FROM sessions WHERE token_hash = ? AND user_id = ? AND expires_at > ?
    `).get(tokenHash, payload.sub, Date.now());

    if (!session) {
      logger.warn('Session not found or expired', { userId: payload.sub, ip: req.ip });
      res.clearCookie('sv_token');
      return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.' });
    }

    // Update last_used
    db.prepare('UPDATE sessions SET last_used = ? WHERE id = ?').run(Date.now(), session.id);

    req.user = { id: payload.sub, email: payload.email, sessionId: session.id };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      res.clearCookie('sv_token');
      return res.status(401).json({ error: 'Token expiré. Veuillez vous reconnecter.' });
    }
    logger.error('JWT verification error', { error: err.message, ip: req.ip });
    res.clearCookie('sv_token');
    return res.status(401).json({ error: 'Token invalide.' });
  }
};

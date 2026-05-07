const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authenticate, isAdmin } = require('../middleware/auth');
const db = require('../database');
const logger = require('../logger');

// All routes here require admin privileges
router.use(authenticate, isAdmin);

/**
 * GET /api/admin/stats
 * Get general system statistics
 */
router.get('/stats', (req, res) => {
  try {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const itemCount = db.prepare('SELECT COUNT(*) as count FROM vault_items').get().count;
    const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
    
    res.json({
      users: userCount,
      items: itemCount,
      sessions: sessionCount,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error('Admin stats error', { error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques.' });
  }
});

/**
 * GET /api/admin/logs
 * Read recent application logs
 */
router.get('/logs', (req, res) => {
  try {
    const type = req.query.type === 'error' ? 'error.log' : 'combined.log';
    const logPath = path.join(__dirname, '..', '..', 'logs', type);
    
    console.log(`[Admin] Log request: type=${req.query.type} -> file=${type}`);

    if (!fs.existsSync(logPath)) {
      return res.json({ logs: [] });
    }

    // Read last 100 lines
    const logsData = fs.readFileSync(logPath, 'utf8');
    if (!logsData.trim()) return res.json({ logs: [] });

    const lines = logsData.trim().split('\n').slice(-100).reverse();
    
    const parsedLogs = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return { message: line, level: 'info', timestamp: new Date().toISOString() };
      }
    });

    res.json({ logs: parsedLogs });
  } catch (err) {
    console.error('[Admin] Log reading error:', err.message);
    logger.error('Admin logs error', { error: err.message });
    res.status(500).json({ error: 'Erreur lors de la lecture des logs.' });
  }
});

/**
 * POST /api/admin/logs/clear
 * Clear all log files
 */
router.post('/logs/clear', (req, res) => {
  try {
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    const files = ['combined.log', 'error.log'];
    
    files.forEach(file => {
      const p = path.join(logsDir, file);
      if (fs.existsSync(p)) {
        try {
          fs.truncateSync(p, 0);
        } catch (e) {
          console.error(`Failed to truncate ${file}:`, e.message);
        }
      }
    });

    logger.info('System logs cleared by admin', { userId: req.user.id });
    res.json({ message: 'Logs vidés avec succès.' });
  } catch (err) {
    console.error('[Admin] Clear logs error:', err.message);
    logger.error('Clear logs error', { error: err.message });
    res.status(500).json({ error: `Erreur: ${err.message}` });
  }
});

module.exports = router;

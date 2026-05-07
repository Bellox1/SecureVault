const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { body, param, validationResult } = require('express-validator');
const db = require('../database');
const logger = require('../logger');
const { authenticate } = require('../middleware/auth');

// All vault routes require authentication
router.use(authenticate);

// ─── Validation helpers ────────────────────────────────────────────────────────

const vaultItemValidation = [
  body('type').isIn(['login', 'card', 'note']).withMessage('Type invalide.'),
  body('name_enc').notEmpty().withMessage('Le nom est requis.'),
  body('data_enc').notEmpty().withMessage('Les données sont requises.'),
  body('iv').notEmpty().withMessage('IV requis.'),
  body('auth_tag').notEmpty().withMessage('Auth tag requis.'),
];

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.error('Validation failed', { 
      body: req.body, 
      errors: errors.array() 
    });
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
}

// ─── GET /api/vault ───────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const items = db.prepare(`
      SELECT id, type, name_enc, data_enc, iv, auth_tag, favorite, folder_id, created_at, updated_at
      FROM vault_items WHERE user_id = ?
      ORDER BY updated_at DESC
    `).all(req.user.id);

    res.json({ items });
  } catch (err) {
    logger.error('Error fetching vault', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération du coffre.' });
  }
});

// ─── GET /api/vault/:id ───────────────────────────────────────────────────────
router.get('/:id',
  [param('id').isUUID()],
  (req, res) => {
    if (!validate(req, res)) return;
    try {
      const item = db.prepare(`
        SELECT id, type, name_enc, data_enc, iv, auth_tag, favorite, folder_id, created_at, updated_at
        FROM vault_items WHERE id = ? AND user_id = ?
      `).get(req.params.id, req.user.id);

      if (!item) return res.status(404).json({ error: 'Élément introuvable.' });
      res.json({ item });
    } catch (err) {
      logger.error('Error fetching vault item', { userId: req.user.id, error: err.message });
      res.status(500).json({ error: 'Erreur.' });
    }
  }
);

// ─── POST /api/vault ──────────────────────────────────────────────────────────
router.post('/',
  vaultItemValidation,
  (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { type, name_enc, data_enc, iv, auth_tag, favorite, folder_id } = req.body;
      const id = uuidv4();
      const now = Date.now();

      db.prepare(`
        INSERT INTO vault_items (id, user_id, type, name_enc, data_enc, iv, auth_tag, favorite, folder_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.user.id, type, name_enc, data_enc, iv, auth_tag, favorite ? 1 : 0, folder_id || null, now, now);

      logger.info('Vault item created', { userId: req.user.id, itemId: id, type });
      res.status(201).json({ id, message: 'Élément créé.' });
    } catch (err) {
      logger.error('Error creating vault item', { userId: req.user.id, error: err.message });
      res.status(500).json({ error: 'Erreur lors de la création.' });
    }
  }
);

// ─── PUT /api/vault/:id ───────────────────────────────────────────────────────
router.put('/:id',
  [param('id').isUUID(), ...vaultItemValidation],
  (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { type, name_enc, data_enc, iv, auth_tag, favorite, folder_id } = req.body;
      const now = Date.now();

      const result = db.prepare(`
        UPDATE vault_items
        SET type = ?, name_enc = ?, data_enc = ?, iv = ?, auth_tag = ?,
            favorite = ?, folder_id = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(type, name_enc, data_enc, iv, auth_tag, favorite ? 1 : 0, folder_id || null, now, req.params.id, req.user.id);

      if (result.changes === 0) return res.status(404).json({ error: 'Élément introuvable.' });
      logger.info('Vault item updated', { userId: req.user.id, itemId: req.params.id });
      res.json({ message: 'Élément mis à jour.' });
    } catch (err) {
      logger.error('Error updating vault item', { userId: req.user.id, error: err.message });
      res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
    }
  }
);

// ─── DELETE /api/vault/:id ────────────────────────────────────────────────────
router.delete('/:id',
  [param('id').isUUID()],
  (req, res) => {
    if (!validate(req, res)) return;
    try {
      const result = db.prepare('DELETE FROM vault_items WHERE id = ? AND user_id = ?')
        .run(req.params.id, req.user.id);

      if (result.changes === 0) return res.status(404).json({ error: 'Élément introuvable.' });
      logger.info('Vault item deleted', { userId: req.user.id, itemId: req.params.id });
      res.json({ message: 'Élément supprimé.' });
    } catch (err) {
      logger.error('Error deleting vault item', { userId: req.user.id, error: err.message });
      res.status(500).json({ error: 'Erreur lors de la suppression.' });
    }
  }
);

// ─── GET /api/vault/folders ───────────────────────────────────────────────────
router.get('/folders/list', (req, res) => {
  try {
    const folders = db.prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY created_at ASC').all(req.user.id);
    res.json({ folders });
  } catch (err) {
    logger.error('Error fetching folders', { error: err.message });
    res.status(500).json({ error: 'Erreur.' });
  }
});

// ─── POST /api/vault/folders ──────────────────────────────────────────────────
router.post('/folders/create',
  [body('name_enc').isString().isLength({ min: 1, max: 5000 })],
  (req, res) => {
    if (!validate(req, res)) return;
    try {
      const id = uuidv4();
      db.prepare('INSERT INTO folders (id, user_id, name_enc, created_at) VALUES (?, ?, ?, ?)')
        .run(id, req.user.id, req.body.name_enc, Date.now());
      res.status(201).json({ id });
    } catch (err) {
      logger.error('Error creating folder', { error: err.message });
      res.status(500).json({ error: 'Erreur lors de la création du dossier.' });
    }
  }
);

module.exports = router;

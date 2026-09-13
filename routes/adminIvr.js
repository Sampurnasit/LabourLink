const express = require('express');
const ivrService = require('../services/ivrService');
const { getIvrConfig } = require('../services/ivrConfig');

const router = express.Router();

function requireAdmin(req, res, next) {
  const { adminApiKey } = getIvrConfig();
  if (!adminApiKey) {
    console.warn('[IVR Admin] ADMIN_API_KEY is not set; admin routes are unprotected');
    return next();
  }
  const provided = req.get('X-Admin-Key') || req.get('x-admin-key') || req.query.admin_key;
  if (provided !== adminApiKey) {
    return res.status(401).json({ status: 'error', error: 'Unauthorized' });
  }
  next();
}

router.use(requireAdmin);

router.get('/categories', async (req, res) => {
  try {
    const categories = await ivrService.listCategoriesAdmin();
    res.json({ status: 'ok', count: categories.length, categories });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const category = await ivrService.createCategory(req.body || {});
    res.status(201).json({ status: 'ok', category });
  } catch (err) {
    res.status(err.statusCode || 500).json({ status: 'error', error: err.message });
  }
});

router.put('/categories/:id', async (req, res) => {
  try {
    const category = await ivrService.updateCategory(req.params.id, req.body || {});
    res.json({ status: 'ok', category });
  } catch (err) {
    res.status(err.statusCode || 500).json({ status: 'error', error: err.message });
  }
});

router.patch('/categories/:id/deactivate', async (req, res) => {
  try {
    const category = await ivrService.deactivateCategory(req.params.id);
    res.json({ status: 'ok', category });
  } catch (err) {
    res.status(err.statusCode || 500).json({ status: 'error', error: err.message });
  }
});

router.get('/call-logs', async (req, res) => {
  try {
    const logs = await ivrService.listCallLogs({
      limit: req.query.limit,
      offset: req.query.offset
    });
    res.json({ status: 'ok', count: logs.length, logs });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

module.exports = router;

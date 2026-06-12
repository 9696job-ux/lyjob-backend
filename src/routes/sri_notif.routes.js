const express  = require('express');
const router   = express.Router();
const db       = require('../db/connection');
const authMiddleware = require('../middleware/auth');
const sriSvc   = require('../services/sri_notif.service');

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// ── CONFIG ──────────────────────────────────────────────────────────────────

// GET /api/sri-notif/config  → obtener config de la organización
router.get('/config', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    if (!org_id) return res.json({ config: null });
    const [[row]] = await db.query(
      'SELECT * FROM sri_notif_config WHERE organization_id = ?', [org_id]
    );
    res.json({ config: row || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/sri-notif/config  → crear o actualizar config
router.post('/config', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    if (!org_id) return res.status(400).json({ error: 'Sin organización' });
    const { emails_notificacion, horarios, activo } = req.body;
    await db.query(
      `INSERT INTO sri_notif_config (organization_id, emails_notificacion, horarios, activo)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         emails_notificacion = VALUES(emails_notificacion),
         horarios = VALUES(horarios),
         activo = VALUES(activo)`,
      [
        org_id,
        JSON.stringify(emails_notificacion || []),
        JSON.stringify(horarios || ['08:35','12:00','17:00']),
        activo !== false ? 1 : 0
      ]
    );
    const [[updated]] = await db.query(
      'SELECT * FROM sri_notif_config WHERE organization_id = ?', [org_id]
    );
    // Actualizar el scheduler dinámicamente
    sriSvc.updateSchedule(org_id, updated);
    res.json({ ok: true, config: updated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CLIENTES MONITOREADOS ────────────────────────────────────────────────────

router.get('/clientes', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    const [rows] = await db.query(
      'SELECT * FROM sri_notif_clientes WHERE organization_id = ? ORDER BY razon_social',
      [org_id]
    );
    res.json({ clientes: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/clientes', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    const { client_id, ruc, razon_social } = req.body;
    await db.query(
      `INSERT INTO sri_notif_clientes (organization_id, client_id, ruc, razon_social, activo)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE activo=1, razon_social=VALUES(razon_social)`,
      [org_id, client_id, ruc, razon_social]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/clientes/:client_id', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    await db.query(
      'UPDATE sri_notif_clientes SET activo=0 WHERE organization_id=? AND client_id=?',
      [org_id, req.params.client_id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── NOTIFICACIONES ──────────────────────────────────────────────────────────

router.get('/notificaciones', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    const { seccion, ruc, limit = 100 } = req.query;
    let where = 'WHERE organization_id = ?';
    const params = [org_id];
    if (seccion) { where += ' AND seccion = ?'; params.push(seccion); }
    if (ruc)     { where += ' AND ruc = ?';     params.push(ruc); }
    params.push(parseInt(limit));
    const [rows] = await db.query(
      `SELECT * FROM sri_notificaciones ${where} ORDER BY created_at DESC LIMIT ?`,
      params
    );
    res.json({ notificaciones: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── EJECUCIÓN MANUAL ─────────────────────────────────────────────────────────

router.post('/ejecutar', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    const { test_email } = req.body; // Para pruebas con email específico
    res.json({ ok: true, message: 'Revisión iniciada en background' });
    // Ejecutar en background
    sriSvc.revisarNotificaciones(org_id, test_email).catch(console.error);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LOGS ─────────────────────────────────────────────────────────────────────

router.get('/logs', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    const [rows] = await db.query(
      'SELECT * FROM sri_notif_log WHERE organization_id=? ORDER BY created_at DESC LIMIT 50',
      [org_id]
    );
    res.json({ logs: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

// Endpoint auxiliar: listar todos los clientes accesibles para la organización
router.get('/all-clients', async (req, res) => {
  try {
    const user = req.user;
    let where = '';
    const params = [];
    if (user.organization_id) {
      where = 'WHERE organization_id = ? OR organization_id IS NULL';
      params.push(user.organization_id);
    }
    const [rows] = await db.query(
      `SELECT id, razon_social, ruc, status FROM clients ${where} ORDER BY razon_social LIMIT 500`,
      params
    );
    res.json({ clients: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

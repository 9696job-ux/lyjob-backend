const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db     = require('../db/connection');
const auth   = require('../middleware/auth');
const { requireMaestro } = require('../middleware/roles');
const emailSvc = require('../services/email.service');

const FRONT  = process.env.FRONTEND_URL || 'https://lyjob.com';
const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

// All admin routes require auth + maestro
router.use(auth, requireMaestro);

// GET /admin/users — list all users
router.get('/users', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, email, full_name, role, user_type, organization_id, is_org_admin,
              is_active, is_verified, subscription_plan_type, subscription_start,
              subscription_days, last_login, created_date
       FROM users ORDER BY created_date DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /admin/users/:id
router.get('/users/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, email, full_name, role, user_type, organization_id, is_org_admin,
              is_active, is_verified, subscription_plan_type, subscription_start, subscription_days
       FROM users WHERE id = ?`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /admin/users/:id — update any user field
router.patch('/users/:id', async (req, res) => {
  try {
    const allowed = ['full_name', 'role', 'user_type', 'organization_id', 'is_org_admin',
                     'is_active', 'subscription_plan_type', 'subscription_start', 'subscription_days'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nada que actualizar' });
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(`UPDATE users SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.params.id]);
    const [rows] = await db.query(`SELECT id, email, full_name, role, user_type, organization_id, is_active, subscription_plan_type, subscription_days FROM users WHERE id = ?`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /admin/users — create user directly (no email verification needed from admin)
router.post('/users', async (req, res) => {
  try {
    const { email: emailAddr, password, full_name, role, user_type } = req.body;
    if (!emailAddr || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

    const [exist] = await db.query('SELECT id FROM users WHERE email = ?', [emailAddr.toLowerCase().trim()]);
    if (exist.length) return res.status(409).json({ error: 'Email ya registrado' });

    const hash   = await bcrypt.hash(password, ROUNDS);
    const userId = uuid();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, user_type, is_active, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
      [userId, emailAddr.toLowerCase().trim(), hash, full_name || '', role || 'cargador', user_type || 'cargador']
    );

    // Send welcome email
    emailSvc.sendWelcomeVerification(emailAddr, full_name, `${FRONT}/login`).catch(() => {});

    const [rows] = await db.query(`SELECT id, email, full_name, role, user_type FROM users WHERE id = ?`, [userId]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /admin/users/:id
router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /admin/reset-password/:id — force reset for any user
router.post('/reset-password/:id', async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres' });
    const hash = await bcrypt.hash(new_password, ROUNDS);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    await db.query('DELETE FROM refresh_tokens WHERE user_id = ?', [req.params.id]);
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [[users]]   = await db.query('SELECT COUNT(*) as total FROM users');
    const [[active]]  = await db.query("SELECT COUNT(*) as total FROM users WHERE is_active = 1");
    const [[clients]] = await db.query("SELECT COUNT(*) as total FROM clients WHERE status = 'activo'");
    const [[tramites]]= await db.query("SELECT COUNT(*) as total FROM tramites WHERE estado != 'finalizado'");
    const [[proUsers]]= await db.query("SELECT COUNT(*) as total FROM users WHERE subscription_plan_type = 'Pro'");
    res.json({ users: users.total, active_users: active.total, clients: clients.total, active_tramites: tramites.total, pro_users: proUsers.total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

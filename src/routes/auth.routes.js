const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db      = require('../db/connection');
const email   = require('../services/email.service');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;
const FRONT  = process.env.FRONTEND_URL || 'https://lyjob.com';

function makeAccessToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}
function makeRefreshToken() { return uuid() + '-' + uuid(); }

// ─── POST /auth/register ─────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email: emailAddr, password, full_name } = req.body;
    if (!emailAddr || !password) return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    // Check duplicate
    const [exist] = await db.query('SELECT id FROM users WHERE email = ?', [emailAddr.toLowerCase().trim()]);
    if (exist.length) return res.status(409).json({ error: 'Este correo ya está registrado' });

    const hash         = await bcrypt.hash(password, ROUNDS);
    const userId       = uuid();
    const verifyToken  = uuid();

    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, verify_token, role, user_type, is_active, is_verified)
       VALUES (?, ?, ?, ?, ?, 'cargador', 'cargador', 1, 0)`,
      [userId, emailAddr.toLowerCase().trim(), hash, full_name || '', verifyToken]
    );

    // Send verification email
    const verifyUrl = `${FRONT}/verify-email?token=${verifyToken}`;
    await email.sendWelcomeVerification(emailAddr, full_name, verifyUrl).catch(e => console.error('Email error:', e));

    // Notify admin
    const [admins] = await db.query("SELECT email FROM users WHERE role = 'admin' OR user_type = 'maestro' LIMIT 5");
    for (const admin of admins) {
      email.sendAdminNewUser(admin.email, { email: emailAddr, full_name }).catch(() => {});
    }

    res.status(201).json({ message: 'Cuenta creada. Revisa tu correo para verificar tu cuenta.' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /auth/verify-email?token= ───────────────────────────────────────────
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    const [rows] = await db.query('SELECT id FROM users WHERE verify_token = ? AND is_verified = 0', [token]);
    if (!rows.length) return res.status(400).json({ error: 'Token inválido o ya utilizado' });

    await db.query('UPDATE users SET is_verified = 1, verify_token = NULL WHERE id = ?', [rows[0].id]);

    // Redirect to frontend with success flag
    res.redirect(`${FRONT}/login?verified=1`);
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Error al verificar' });
  }
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email: emailAddr, password } = req.body;
    if (!emailAddr || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

    const [rows] = await db.query(
      `SELECT id, email, password_hash, full_name, role, user_type, organization_id,
              is_org_admin, is_active, is_verified, subscription_plan_type, subscription_start, subscription_days
       FROM users WHERE email = ?`,
      [emailAddr.toLowerCase().trim()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const user = rows[0];
    if (!user.is_active) return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta al administrador.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Credenciales incorrectas' });

    if (!user.is_verified) {
      return res.status(403).json({
        error: 'Por favor verifica tu correo electrónico antes de ingresar.',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    // Generate tokens
    const accessToken  = makeAccessToken(user.id);
    const refreshToken = makeRefreshToken();
    const expiresAt    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.query(
      'INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (UUID(), ?, ?, ?)',
      [user.id, refreshToken, expiresAt]
    );
    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    const { password_hash, ...safeUser } = user;
    res.json({ access_token: accessToken, refresh_token: refreshToken, user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token requerido' });

    const [rows] = await db.query(
      'SELECT user_id, expires_at FROM refresh_tokens WHERE token = ?',
      [refresh_token]
    );
    if (!rows.length) return res.status(401).json({ error: 'Refresh token inválido' });
    if (new Date(rows[0].expires_at) < new Date()) {
      await db.query('DELETE FROM refresh_tokens WHERE token = ?', [refresh_token]);
      return res.status(401).json({ error: 'Refresh token expirado' });
    }

    const userId       = rows[0].user_id;
    const newAccess    = makeAccessToken(userId);
    const newRefresh   = makeRefreshToken();
    const expiresAt    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.query('DELETE FROM refresh_tokens WHERE token = ?', [refresh_token]);
    await db.query(
      'INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (UUID(), ?, ?, ?)',
      [userId, newRefresh, expiresAt]
    );

    res.json({ access_token: newAccess, refresh_token: newRefresh });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /auth/forgot-password ──────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email: emailAddr } = req.body;
    if (!emailAddr) return res.status(400).json({ error: 'Email requerido' });

    const [rows] = await db.query('SELECT id, full_name FROM users WHERE email = ?', [emailAddr.toLowerCase().trim()]);
    // Always respond OK to prevent email enumeration
    if (!rows.length) return res.json({ message: 'Si el correo existe, recibirás un enlace.' });

    const resetToken  = uuid();
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      'UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?',
      [resetToken, resetExpiry, rows[0].id]
    );

    const resetUrl = `${FRONT}/reset-password?token=${resetToken}`;
    await email.sendPasswordReset(emailAddr, rows[0].full_name, resetUrl);

    res.json({ message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /auth/reset-password ───────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) return res.status(400).json({ error: 'Token y nueva contraseña requeridos' });
    if (new_password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    const [rows] = await db.query(
      'SELECT id FROM users WHERE reset_token = ? AND reset_expires > NOW()',
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: 'Token inválido o expirado' });

    const hash = await bcrypt.hash(new_password, ROUNDS);
    await db.query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
      [hash, rows[0].id]
    );
    // Invalidate all refresh tokens for security
    await db.query('DELETE FROM refresh_tokens WHERE user_id = ?', [rows[0].id]);

    res.json({ message: 'Contraseña restablecida exitosamente. Ya puedes iniciar sesión.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
const auth = require('../middleware/auth');
router.get('/me', auth, async (req, res) => {
  res.json(req.user);
});

// ─── PATCH /auth/me ───────────────────────────────────────────────────────────
router.patch('/me', auth, async (req, res) => {
  try {
    const allowed = ['full_name', 'organization_id', 'is_org_admin'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nada que actualizar' });

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(`UPDATE users SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.user.id]);

    const [rows] = await db.query(
      'SELECT id, email, full_name, role, user_type, organization_id, is_org_admin, subscription_plan_type, subscription_start, subscription_days FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Update me error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
router.post('/logout', auth, async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      await db.query('DELETE FROM refresh_tokens WHERE token = ? AND user_id = ?', [refresh_token, req.user.id]);
    }
    res.json({ message: 'Sesión cerrada' });
  } catch {
    res.json({ message: 'Sesión cerrada' });
  }
});

// ─── POST /auth/resend-verification ──────────────────────────────────────────
router.post('/resend-verification', async (req, res) => {
  try {
    const { email: emailAddr } = req.body;
    const [rows] = await db.query('SELECT id, full_name, is_verified FROM users WHERE email = ?', [emailAddr?.toLowerCase().trim()]);
    if (!rows.length || rows[0].is_verified) return res.json({ message: 'OK' });

    const verifyToken = uuid();
    await db.query('UPDATE users SET verify_token = ? WHERE id = ?', [verifyToken, rows[0].id]);
    const verifyUrl = `${FRONT}/verify-email?token=${verifyToken}`;
    await email.sendWelcomeVerification(emailAddr, rows[0].full_name, verifyUrl);

    res.json({ message: 'Correo de verificación reenviado' });
  } catch (err) {
    console.error('Resend verify error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;

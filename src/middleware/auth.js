const jwt = require('jsonwebtoken');
const db  = require('../db/connection');

module.exports = async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Verify user still exists and is active
    const [rows] = await db.query(
      'SELECT id, email, full_name, role, user_type, organization_id, is_org_admin, is_active, is_verified, subscription_plan_type, subscription_start, subscription_days FROM users WHERE id = ? AND is_active = 1',
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expirado' });
    return res.status(401).json({ error: 'Token inválido' });
  }
};

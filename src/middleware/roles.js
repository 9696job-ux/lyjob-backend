module.exports = {
  requireMaestro: (req, res, next) => {
    const u = req.user;
    if (u.role === 'admin' || u.user_type === 'maestro') return next();
    return res.status(403).json({ error: 'Solo administradores pueden realizar esta acción' });
  },
  requireVerified: (req, res, next) => {
    if (!req.user.is_verified) return res.status(403).json({ error: 'Verifica tu correo antes de continuar' });
    next();
  },
};

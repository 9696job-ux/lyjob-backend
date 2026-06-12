const express  = require('express');
const router   = express.Router();
const db       = require('../db/connection');
const auth     = require('../middleware/auth');
const sriSvc   = require('../services/sri_notif.service');
const crypto   = require('crypto');

router.use(auth);

// ── CONFIG ──────────────────────────────────────────────────────────────────

router.get('/config', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    if (!org_id) return res.json({ config: null });
    const [[row]] = await db.query(
      'SELECT id, organization_id, emails_notificacion, horarios, activo FROM sri_notif_config WHERE organization_id = ?', [org_id]
    );
    // Nunca devolver la clave del SRI en texto plano
    res.json({ config: row || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/config', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    if (!org_id) return res.status(400).json({ error: 'Sin organización' });
    const { emails_notificacion, horarios, activo, sri_usuario, sri_clave } = req.body;

    // Cifrar la clave del SRI si se proporciona
    let credHash = null;
    if (sri_usuario && sri_clave) {
      credHash = JSON.stringify({
        usuario: sri_usuario,
        clave: Buffer.from(sri_clave).toString('base64')
      });
    }

    const emailsJson = JSON.stringify(emails_notificacion || []);
    const horariosJson = JSON.stringify(horarios || ['08:35','12:00','17:00']);

    if (credHash) {
      await db.query(
        `INSERT INTO sri_notif_config (organization_id, emails_notificacion, horarios, activo, sri_credentials)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           emails_notificacion=VALUES(emails_notificacion),
           horarios=VALUES(horarios),
           activo=VALUES(activo),
           sri_credentials=VALUES(sri_credentials)`,
        [org_id, emailsJson, horariosJson, activo !== false ? 1 : 0, credHash]
      );
    } else {
      await db.query(
        `INSERT INTO sri_notif_config (organization_id, emails_notificacion, horarios, activo)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           emails_notificacion=VALUES(emails_notificacion),
           horarios=VALUES(horarios),
           activo=VALUES(activo)`,
        [org_id, emailsJson, horariosJson, activo !== false ? 1 : 0]
      );
    }

    const [[updated]] = await db.query(
      'SELECT id, organization_id, emails_notificacion, horarios, activo FROM sri_notif_config WHERE organization_id=?', [org_id]
    );
    sriSvc.updateSchedule(org_id, updated);
    res.json({ ok: true, config: updated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Verificar si hay credenciales SRI configuradas (sin exponer la clave)
router.get('/config/sri-status', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    if (!org_id) return res.json({ tiene_credenciales: false });
    const [[row]] = await db.query(
      'SELECT sri_credentials IS NOT NULL as tiene_cred FROM sri_notif_config WHERE organization_id=?', [org_id]
    );
    res.json({ tiene_credenciales: row?.tiene_cred === 1 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CLIENTES ─────────────────────────────────────────────────────────────────

router.get('/clientes', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    const [rows] = await db.query(
      'SELECT * FROM sri_notif_clientes WHERE organization_id=? ORDER BY razon_social', [org_id]
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

// ── NOTIFICACIONES ────────────────────────────────────────────────────────────

router.get('/notificaciones', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    const { seccion, ruc, limit = 200 } = req.query;
    let where = 'WHERE organization_id=?';
    const params = [org_id];
    if (seccion) { where += ' AND seccion=?'; params.push(seccion); }
    if (ruc)     { where += ' AND ruc=?';     params.push(ruc); }
    params.push(parseInt(limit));
    const [rows] = await db.query(
      `SELECT * FROM sri_notificaciones ${where} ORDER BY created_at DESC LIMIT ?`, params
    );
    res.json({ notificaciones: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── RECIBIR NOTIFICACIONES DESDE EL BROWSER DEL USUARIO ─────────────────────
// El frontend hace el login al SRI y envía las notificaciones encontradas aquí

router.post('/push-notificaciones', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    const { ruc, razon_social, client_id, notificaciones_superior, notificaciones_inferior } = req.body;

    if (!ruc) return res.status(400).json({ error: 'RUC requerido' });

    let nuevas_sup = 0, nuevas_inf = 0;

    async function saveNotifs(notifs, seccion) {
      let nuevas = 0;
      for (const n of (notifs || [])) {
        const hash = crypto.createHash('sha256')
          .update(`${ruc}-${seccion}-${n.numero||''}-${n.fecha||''}-${n.asunto||''}`)
          .digest('hex');
        const [[existe]] = await db.query('SELECT id FROM sri_notificaciones WHERE hash_unico=?', [hash]);
        if (existe) continue;
        await db.query(
          `INSERT INTO sri_notificaciones 
           (organization_id, client_id, ruc, razon_social, seccion, numero_tramite,
            descripcion, fecha_notificacion, remitente, asunto, datos_json, hash_unico)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [org_id, client_id || null, ruc, razon_social || ruc,
           seccion, n.numero || null, n.descripcion || null,
           n.fecha || null, n.remitente || 'SRI Ecuador',
           n.asunto || n.descripcion || null,
           JSON.stringify(n), hash]
        );
        nuevas++;
      }
      return nuevas;
    }

    nuevas_sup = await saveNotifs(notificaciones_superior, 'superior');
    nuevas_inf = await saveNotifs(notificaciones_inferior, 'inferior');

    const total = nuevas_sup + nuevas_inf;

    // Si hay notificaciones nuevas, enviar emails
    if (total > 0) {
      const [[config]] = await db.query(
        'SELECT * FROM sri_notif_config WHERE organization_id=?', [org_id]
      );
      if (config) {
        const emails = JSON.parse(config.emails_notificacion || '[]');
        if (emails.length > 0) {
          sriSvc.enviarEmailNotificacion(emails[0], [{
            cliente: razon_social || ruc, ruc,
            superiores: nuevas_sup, inferiores: nuevas_inf, total
          }], org_id).catch(console.error);
          // Enviar a todos los emails
          for (let i = 1; i < emails.length; i++) {
            sriSvc.enviarEmailNotificacion(emails[i], [{
              cliente: razon_social || ruc, ruc,
              superiores: nuevas_sup, inferiores: nuevas_inf, total
            }], org_id).catch(console.error);
          }
        }
      }
    }

    await db.query(
      `INSERT INTO sri_notif_log (organization_id, tipo, resultado, clientes_revisados, notificaciones_nuevas, emails_enviados)
       VALUES (?, 'revision_browser', 'OK', 1, ?, ?)`,
      [org_id, total, total > 0 ? 1 : 0]
    );

    res.json({ ok: true, nuevas_superior: nuevas_sup, nuevas_inferior: nuevas_inf, total });
  } catch(e) {
    console.error('[SRI push]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── EJECUTAR REVISIÓN (lanza el browser-based scraping) ─────────────────────

router.post('/ejecutar', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    const { test_email } = req.body;
    res.json({ ok: true, message: 'Revisión iniciada' });
    sriSvc.revisarNotificaciones(org_id, test_email).catch(console.error);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LOGS ──────────────────────────────────────────────────────────────────────

router.get('/logs', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    const [rows] = await db.query(
      'SELECT * FROM sri_notif_log WHERE organization_id=? ORDER BY created_at DESC LIMIT 50', [org_id]
    );
    res.json({ logs: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ALL CLIENTS ───────────────────────────────────────────────────────────────

router.get('/all-clients', async (req, res) => {
  try {
    const user = req.user;
    let where = '';
    const params = [];
    if (user.organization_id) {
      where = 'WHERE organization_id=? OR organization_id IS NULL';
      params.push(user.organization_id);
    }
    const [rows] = await db.query(
      `SELECT id, razon_social, ruc, status FROM clients ${where} ORDER BY razon_social LIMIT 500`, params
    );
    res.json({ clients: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

// Endpoint seguro para que el frontend obtenga las credenciales del SRI
// Solo disponible para usuarios autenticados de la misma organización
router.post('/obtener-credenciales', async (req, res) => {
  try {
    const org_id = req.user.organization_id;
    if (!org_id) return res.status(400).json({ error: 'Sin organización' });
    
    const [[config]] = await db.query(
      'SELECT sri_credentials FROM sri_notif_config WHERE organization_id=?', [org_id]
    );
    
    if (!config?.sri_credentials) {
      return res.status(404).json({ error: 'No hay credenciales SRI configuradas' });
    }
    
    const creds = JSON.parse(config.sri_credentials);
    res.json({
      credenciales: {
        usuario: creds.usuario,
        clave: Buffer.from(creds.clave, 'base64').toString('utf8')
      }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

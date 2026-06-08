const router = require('express').Router();
const db     = require('../db/connection');
const auth   = require('../middleware/auth');
const { requireMaestro } = require('../middleware/roles');
const emailSvc = require('../services/email.service');
const { differenceInDays } = require('../utils/dates');

// ─── POST /functions/createPayment ───────────────────────────────────────────
router.post('/createPayment', auth, async (req, res) => {
  try {
    const { plan_id } = req.body;
    if (!plan_id) return res.status(400).json({ success: false, error: 'plan_id requerido' });

    const [plans] = await db.query('SELECT * FROM plans WHERE id = ? AND is_active = 1', [plan_id]);
    if (!plans.length) return res.status(404).json({ success: false, error: 'Plan no encontrado' });
    const plan = plans[0];

    const token   = process.env.PAYPHONE_TOKEN;
    const storeId = process.env.PAYPHONE_STORE_ID;
    if (!token || !storeId) return res.status(500).json({ success: false, error: 'PayPhone no configurado' });

    const transactionId  = `ST${Date.now().toString().slice(-10)}`;
    const amountCents    = Math.round(plan.price_per_period * 100);
    const amountNoTax    = Math.round((plan.price_per_period / 1.15) * 100);
    const taxCents       = amountCents - amountNoTax;

    const ppRes = await fetch('https://pay.payphonetodoesposible.com/api/Links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        amount: amountCents, amountWithoutTax: amountNoTax, tax: taxCents,
        currency: 'USD', clientTransactionId: transactionId,
        storeId, reference: `Plan ${plan.plan_name}`,
      }),
    });

    const payUrl = await ppRes.text();
    if (!payUrl || !payUrl.startsWith('http')) {
      return res.status(500).json({ success: false, error: 'Error al crear enlace PayPhone' });
    }

    // Save pending subscription
    await db.query(
      `INSERT INTO user_subscriptions (id, user_id, plan_id, status, start_date, billing_cycle, metadata)
       VALUES (UUID(), ?, ?, 'pending', NOW(), ?, ?)`,
      [req.user.id, plan_id, plan.billing_cycle, JSON.stringify({ transaction_id: transactionId, plan_type: plan.plan_type })]
    );

    res.json({ success: true, payment_url: payUrl, transaction_id: transactionId });
  } catch (err) {
    console.error('createPayment error:', err);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// ─── POST /functions/payphoneWebhook ─────────────────────────────────────────
router.post('/payphoneWebhook', async (req, res) => {
  try {
    const { statusCode, clientTransactionId, transactionId, amount } = req.body;
    if (statusCode !== 1 && statusCode !== '1') return res.json({ success: true, message: 'No aprobado' });

    const [subs] = await db.query(
      "SELECT * FROM user_subscriptions WHERE status = 'pending' AND JSON_EXTRACT(metadata, '$.transaction_id') = ?",
      [clientTransactionId]
    );
    if (!subs.length) return res.status(404).json({ success: false });

    const sub  = subs[0];
    const meta = typeof sub.metadata === 'string' ? JSON.parse(sub.metadata) : sub.metadata;
    const [plans] = await db.query('SELECT * FROM plans WHERE id = ?', [sub.plan_id]);
    if (!plans.length) return res.status(404).json({ success: false });

    const plan     = plans[0];
    const duration = plan.billing_cycle === 'annual' ? 365 : 30;
    const startDate = new Date();
    const endDate   = new Date(startDate);
    endDate.setDate(endDate.getDate() + duration);

    await db.query(
      `UPDATE user_subscriptions SET status='active', start_date=?, end_date=?, metadata=? WHERE id=?`,
      [startDate, endDate, JSON.stringify({ ...meta, payphone_transaction_id: transactionId, payment_confirmed: new Date().toISOString() }), sub.id]
    );
    await db.query(
      `UPDATE users SET subscription_plan_id=?, subscription_plan_type=?, subscription_start=?, subscription_days=? WHERE id=?`,
      [plan.id, plan.plan_type, startDate, duration, sub.user_id]
    );

    // Save payment history
    await db.query(
      `INSERT INTO payment_history (id, user_id, plan_id, transaction_id, payphone_id, amount, status, metadata)
       VALUES (UUID(), ?, ?, ?, ?, ?, 'approved', ?)`,
      [sub.user_id, plan.id, clientTransactionId, transactionId, plan.price_per_period, JSON.stringify(req.body)]
    );

    // Send confirmation email
    const [users] = await db.query('SELECT email, full_name FROM users WHERE id = ?', [sub.user_id]);
    if (users.length) {
      const expires = endDate.toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric' });
      emailSvc.sendSubscriptionConfirmed(users[0].email, users[0].full_name, plan.plan_name, expires).catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    console.error('payphoneWebhook error:', err);
    res.status(500).json({ success: false });
  }
});

// ─── POST /functions/impersonateUser ─────────────────────────────────────────
router.post('/impersonateUser', auth, requireMaestro, async (req, res) => {
  try {
    const { target_email, action } = req.body;
    if (action === 'restore') return res.json({ success: true });
    if (!target_email) return res.status(400).json({ error: 'target_email requerido' });

    const [rows] = await db.query(
      'SELECT id, email, full_name, user_type FROM users WHERE email = ?',
      [target_email.toLowerCase()]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });

    console.log(`[IMPERSONATION] ${req.user.email} → ${target_email}`);
    res.json({
      success: true,
      impersonated_user: rows[0],
      admin_user: { email: req.user.email, full_name: req.user.full_name },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /functions/downloadSriDocuments ────────────────────────────────────
router.post('/downloadSriDocuments', auth, async (req, res) => {
  try {
    const { client_id, document_type, mes, anio } = req.body;
    const [creds] = await db.query(
      'SELECT * FROM sri_credentials WHERE client_id = ? AND is_active = 1 LIMIT 1',
      [client_id]
    );
    if (!creds.length) return res.status(400).json({ success: false, error: 'Credenciales SRI no encontradas' });
    const { ruc, sri_password } = creds[0];

    const sriRes = await fetch(`${process.env.SRI_SERVER_URL}/api/descargar-facturas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruc, clave: sri_password, anio, mes }),
    });

    if (!sriRes.ok) {
      const txt = await sriRes.text();
      return res.status(502).json({ success: false, error: `Error servidor SRI: ${txt}` });
    }
    const data = await sriRes.json();
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /functions/getSriServerStatus ───────────────────────────────────────
router.get('/getSriServerStatus', auth, async (req, res) => {
  try {
    const r = await fetch(`${process.env.SRI_SERVER_URL}/api/status`);
    if (!r.ok) return res.json({ online: false });
    const data = await r.json();
    res.json({ online: true, ...data });
  } catch {
    res.json({ online: false });
  }
});

// ─── POST /functions/getSriJobStatus ─────────────────────────────────────────
router.post('/getSriJobStatus', auth, async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: 'jobId requerido' });
    const r = await fetch(`${process.env.SRI_SERVER_URL}/api/estado/${jobId}`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /functions/enviarAvisosProvidencias ────────────────────────────────
router.post('/enviarAvisosProvidencias', auth, async (req, res) => {
  try {
    const [tramites] = await db.query(
      "SELECT * FROM tramites WHERE estado IN ('ingresado','en_revision')"
    );
    const hoy = new Date();
    const enviados = [];

    for (const tramite of tramites) {
      const providencias = typeof tramite.providencias === 'string'
        ? JSON.parse(tramite.providencias || '[]')
        : (tramite.providencias || []);

      let changed = false;
      for (let i = 0; i < providencias.length; i++) {
        const prov = providencias[i];
        if (prov.estado !== 'pendiente' || !prov.correos_notificacion?.length) continue;

        const dias   = differenceInDays(new Date(prov.fecha_vencimiento), hoy);
        const aviso  = prov.avisar_dias_antes || 5;
        if (dias > aviso) continue;

        const hoyStr     = hoy.toISOString().split('T')[0];
        const ultimoAviso = prov.ultimo_aviso_enviado;
        if (ultimoAviso && ultimoAviso.split('T')[0] === hoyStr) continue;

        for (const correo of prov.correos_notificacion.filter(c => c?.trim())) {
          try {
            await emailSvc.sendProvidenciaAlert(correo, tramite, prov, dias);
            enviados.push({ tramite: tramite.numero_tramite, correo, dias });
          } catch (e) {
            console.error('Error enviando alerta:', e.message);
          }
        }

        providencias[i].ultimo_aviso_enviado = hoy.toISOString();
        if (dias < 0) providencias[i].estado = 'vencida';
        changed = true;
      }

      if (changed) {
        await db.query('UPDATE tramites SET providencias = ? WHERE id = ?', [JSON.stringify(providencias), tramite.id]);
      }
    }

    res.json({ success: true, enviados: enviados.length, detalle: enviados });
  } catch (err) {
    console.error('enviarAvisosProvidencias error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /functions/evaluacionDiaria ────────────────────────────────────────
router.post('/evaluacionDiaria', auth, requireMaestro, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [clientes] = await db.query("SELECT * FROM clients WHERE status = 'activo'");
    const resultados = [];

    for (const cliente of clientes) {
      const [owners] = await db.query('SELECT * FROM users WHERE email = ?', [cliente.created_by]);
      if (!owners.length) continue;
      const owner = owners[0];
      const isPro = owner.subscription_plan_type === 'Pro' || owner.user_type === 'maestro' || owner.role === 'admin';
      if (!isPro) continue;

      const [declaraciones] = await db.query(
        "SELECT * FROM extracted_data WHERE client_id = ? AND tipo = 'iva' AND status = 'completed'",
        [cliente.id]
      );
      if (!declaraciones.length) continue;

      const errores = [];
      for (const decl of declaraciones) {
        const data = typeof decl.extracted_data === 'string' ? JSON.parse(decl.extracted_data) : (decl.extracted_data || {});
        const ventas419    = parseFloat(data['419'] || 0);
        const ivaVentas429 = parseFloat(data['429'] || 0);
        const ivaEsperado  = ventas419 * 0.15;
        if (Math.abs(ivaVentas429 - ivaEsperado) > 1) {
          errores.push({
            tipo: 'incoherencia_iva_ventas', periodo: decl.periodo,
            descripcion: `IVA declarado ($${ivaVentas429.toFixed(2)}) ≠ esperado ($${ivaEsperado.toFixed(2)})`,
            severidad: 'alta', campo_afectado: '429',
          });
        }
      }

      // Save evaluation
      await db.query(
        `INSERT INTO evaluaciones_diarias (id, client_id, fecha, resultados, errores, resumen)
         VALUES (UUID(), ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE resultados=VALUES(resultados), errores=VALUES(errores)`,
        [cliente.id, today, JSON.stringify(declaraciones.map(d => d.periodo)), JSON.stringify(errores), JSON.stringify({ total_errores: errores.length })]
      );
      resultados.push({ cliente: cliente.razon_social, errores: errores.length });
    }
    res.json({ success: true, evaluados: resultados.length, resultados });
  } catch (err) {
    console.error('evaluacionDiaria error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /functions/procesarDocumentoLegal ──────────────────────────────────
router.post('/procesarDocumentoLegal', auth, requireMaestro, async (req, res) => {
  try {
    const { documento_id, contenido } = req.body;
    if (!documento_id) return res.status(400).json({ error: 'documento_id requerido' });

    // Basic article extraction from text
    const articulos = [];
    const lines = (contenido || '').split('\n');
    let artNum = null;
    let artText = '';
    for (const line of lines) {
      const match = line.match(/^Art(?:ículo|iculo)?\.?\s*(\d+[\w\-\.]*)\s*[.-]\s*(.+)/i);
      if (match) {
        if (artNum) articulos.push({ numero: artNum, texto: artText.trim() });
        artNum = match[1]; artText = match[2];
      } else if (artNum) {
        artText += ' ' + line.trim();
      }
    }
    if (artNum) articulos.push({ numero: artNum, texto: artText.trim() });

    await db.query(
      'UPDATE documentos_legales SET articulos = ?, updated_date = NOW() WHERE id = ?',
      [JSON.stringify(articulos), documento_id]
    );
    res.json({ success: true, articulos_extraidos: articulos.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /functions/invoke (compatibilidad con base44.functions.invoke) ──────
router.post('/invoke/:functionName', auth, async (req, res) => {
  try {
    // Forward to the matching named route
    const fn = req.params.functionName;
    const target = `/functions/${fn}`;
    // Re-dispatch by creating a sub-request
    res.redirect(307, target);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

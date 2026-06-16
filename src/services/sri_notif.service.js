/**
 * SRI Notificaciones Service
 * Consulta el portal del SRI para revisar Notificaciones Electrónicas
 * - Sección Superior (parte de arriba)
 * - Sección Inferior (parte de abajo)
 */
const db       = require('../db/connection');
const emailSvc = require('./email.service');
const crypto   = require('crypto');
const { scrapearNotificacionesSRI } = require('./sri_scraper.service');
const https    = require('https');
const cron     = require('node-cron');

// Helper: mysql2 puede devolver columnas JSON ya parseadas (array/object) o como string
function safeJsonParse(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch(e) { return fallback; }
}

// Almacén de jobs activos { org_id: [cronJob, cronJob, ...] }
const activeJobs = {};

/**
 * Consultar las notificaciones electrónicas del SRI para un RUC
 * El SRI tiene un portal web consultable en:
 * https://celservices.sri.gob.ec/jee-aui-servicio-notificaciones-electronicas-web/api/...
 */
async function consultarSRI(ruc) {
  return new Promise((resolve) => {
    // URL del servicio público de notificaciones SRI
    const options = {
      hostname: 'celservices.sri.gob.ec',
      path: `/jee-aui-servicio-notificaciones-electronicas-web/api/v1/notificaciones/buscar?identificacion=${ruc}&tipoIdentificacion=RUC`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-EC,es;q=0.9',
        'Referer': 'https://celservices.sri.gob.ec/',
        'Origin': 'https://celservices.sri.gob.ec'
      },
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: true, data: parsed, raw: data });
        } catch(e) {
          resolve({ ok: false, error: 'Parse error', raw: data.substring(0, 200) });
        }
      });
    });

    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
    req.end();
  });
}

/**
 * Consultar el servicio REST oficial del SRI v2
 */
async function consultarSRIv2(ruc) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'celservices.sri.gob.ec',
      path: `/jee-aui-servicio-notificaciones-electronicas-web/api/v1/notificaciones/consultarPorIdentificacion/${ruc}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ ok: true, status: res.statusCode, data: JSON.parse(data) });
        } catch(e) {
          resolve({ ok: true, status: res.statusCode, raw: data.substring(0, 500) });
        }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
    req.end();
  });
}

/**
 * Generar hash único para una notificación (evitar duplicados)
 */
function generarHash(ruc, seccion, numero, fecha, asunto) {
  const str = `${ruc}-${seccion}-${numero}-${fecha}-${asunto}`.toLowerCase();
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Procesar y guardar notificaciones nuevas
 */
async function procesarNotificaciones(org_id, client_id, ruc, razon_social, notificaciones, seccion) {
  let nuevas = 0;

  for (const notif of (notificaciones || [])) {
    const numero  = notif.numeroTramite || notif.numero || notif.id || '';
    const fecha   = notif.fechaNotificacion || notif.fecha || '';
    const asunto  = notif.asunto || notif.descripcion || notif.tipo || notif.tipo_documento || '';
    const remitente = notif.remitente || notif.entidadOrigen || notif.aplicacion || 'SRI Ecuador';
    const desc    = notif.descripcion || notif.detalle || asunto;

    const hash = generarHash(ruc, seccion, numero, fecha, asunto);

    // Verificar si ya existe
    const [[existe]] = await db.query(
      'SELECT id FROM sri_notificaciones WHERE hash_unico = ?', [hash]
    );
    if (existe) continue;

    // Guardar nueva notificación
    await db.query(
      `INSERT INTO sri_notificaciones 
       (organization_id, client_id, ruc, razon_social, seccion, numero_tramite,
        descripcion, fecha_notificacion, remitente, asunto, datos_json, hash_unico)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [org_id, client_id, ruc, razon_social, seccion, numero,
       desc, fecha, remitente, asunto, JSON.stringify(notif), hash]
    );
    nuevas++;
  }

  return nuevas;
}

/**
 * Revisar notificaciones de todos los clientes configurados para una organización
 */
async function revisarNotificaciones(org_id, test_email = null) {
  console.log(`🔍 [SRI-NOTIF] Iniciando revisión para org: ${org_id}`);

  let clientesRevisados = 0, notificacionesNuevas = 0, emailsEnviados = 0;

  try {
    // Obtener config de la organización
    const [[config]] = await db.query(
      'SELECT * FROM sri_notif_config WHERE organization_id = ? AND activo = 1', [org_id]
    );
    if (!config && !test_email) {
      console.log('⚠️  Sin configuración activa para org:', org_id);
      return;
    }

    // Obtener clientes monitoreados
    const [clientes] = await db.query(
      'SELECT * FROM sri_notif_clientes WHERE organization_id = ? AND activo = 1', [org_id]
    );

    if (!clientes.length) {
      console.log('⚠️  Sin clientes configurados para org:', org_id);
      await logEjecucion(org_id, 'revision', 'Sin clientes configurados', 0, 0, 0);
      return;
    }

    const notifNuevasPorCliente = [];

    for (const cliente of clientes) {
      clientesRevisados++;
      console.log(`  📋 Revisando RUC: ${cliente.ruc} - ${cliente.razon_social}`);

      // Usar credenciales del cliente si tiene, sino las de la organización
      let sriUsuario = cliente.sri_usuario;
      let sriClaveB64 = cliente.sri_clave;

      // Fallback a credenciales de la organización
      if (!sriClaveB64 && config) {
        const orgCreds = safeJsonParse(config.sri_credentials, null);
        if (orgCreds) {
          sriUsuario = orgCreds.usuario;
          sriClaveB64 = orgCreds.clave; // ya en base64
        }
      }

      if (!sriUsuario || !sriClaveB64) {
        console.log(`    ⚠️  Sin credenciales SRI para ${cliente.ruc}, saltando`);
        continue;
      }

      // Scraper real: login en SRI y extraer "Documentos notificados electrónicamente"
      const resScraper = await scrapearNotificacionesSRI(sriUsuario, sriClaveB64);

      console.log(`    Scraper: ${resScraper.ok ? 'OK' : resScraper.error}`);

      let notifSuperiores = [], notifInferiores = [];

      if (resScraper.ok) {
        // Mapear los documentos del SRI real al formato interno
        notifSuperiores = (resScraper.superior || []).map(d => ({
          numeroTramite: d.numero,
          fecha:         d.fecha,
          asunto:        d.tipo_documento,
          descripcion:   `${d.tipo_documento} - ${d.aplicacion} - ${d.oficina}`.trim().replace(/^-|-$/g, '').trim(),
          remitente:     d.aplicacion || 'SRI Ecuador',
        }));
        notifInferiores = (resScraper.inferior || []).map(d => ({
          numeroTramite: d.numero,
          fecha:         d.fecha,
          asunto:        d.tipo_documento,
          descripcion:   `${d.tipo_documento} - ${d.aplicacion} - ${d.oficina}`.trim().replace(/^-|-$/g, '').trim(),
          remitente:     d.aplicacion || 'SRI Ecuador',
        }));
      }

      const nuevasTop = await procesarNotificaciones(
        org_id, cliente.client_id, cliente.ruc, cliente.razon_social, notifSuperiores, 'superior'
      );
      const nuevasBot = await procesarNotificaciones(
        org_id, cliente.client_id, cliente.ruc, cliente.razon_social, notifInferiores, 'inferior'
      );

      const totalNuevas = nuevasTop + nuevasBot;
      notificacionesNuevas += totalNuevas;

      if (totalNuevas > 0) {
        notifNuevasPorCliente.push({
          cliente: cliente.razon_social,
          ruc: cliente.ruc,
          superiores: nuevasTop,
          inferiores: nuevasBot,
          total: totalNuevas
        });
      }

      console.log(`    ✅ ${cliente.ruc}: ${nuevasTop} sup + ${nuevasBot} inf nuevas`);
    }

    // Enviar email si hay notificaciones nuevas
    if (notificacionesNuevas > 0) {
      const emails = test_email
        ? [test_email]
        : (config ? safeJsonParse(config.emails_notificacion, []) : []);

      if (emails.length > 0) {
        for (const email of emails) {
          await enviarEmailNotificacion(email, notifNuevasPorCliente, org_id);
          emailsEnviados++;
        }
      }
    }

    await logEjecucion(org_id, 'revision', 'OK', clientesRevisados, notificacionesNuevas, emailsEnviados);
    console.log(`✅ [SRI-NOTIF] Revisión completa: ${clientesRevisados} clientes, ${notificacionesNuevas} nuevas, ${emailsEnviados} emails`);

  } catch(e) {
    console.error('❌ [SRI-NOTIF] Error:', e.message);
    await logEjecucion(org_id, 'error', e.message, clientesRevisados, notificacionesNuevas, emailsEnviados);
  }

  return { clientesRevisados, notificacionesNuevas, emailsEnviados };
}

/**
 * Enviar email profesional de notificación
 */
async function enviarEmailNotificacion(email, clientesConNotif, org_id) {
  const total = clientesConNotif.reduce((s, c) => s + c.total, 0);
  const ahora = new Date();
  const fechaHora = ahora.toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil',
    dateStyle: 'full',
    timeStyle: 'short'
  });

  const filasClientes = clientesConNotif.map(c => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #E5E3DC;font-weight:600;color:#0F0F0E">${c.cliente}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #E5E3DC;color:#555;font-family:monospace">${c.ruc}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #E5E3DC;text-align:center">
        ${c.superiores > 0 ? `<span style="background:#FFF3CD;color:#856404;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:700">${c.superiores}</span>` : '<span style="color:#aaa">—</span>'}
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #E5E3DC;text-align:center">
        ${c.inferiores > 0 ? `<span style="background:#D1ECF1;color:#0C5460;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:700">${c.inferiores}</span>` : '<span style="color:#aaa">—</span>'}
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #E5E3DC;text-align:center">
        <span style="background:#E5FF47;color:#0F0F0E;padding:2px 10px;border-radius:12px;font-size:13px;font-weight:800">${c.total}</span>
      </td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Nuevas Notificaciones SRI</title>
</head>
<body style="margin:0;padding:0;background:#F7F6F2;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F2;padding:32px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

      <!-- HEADER -->
      <tr><td style="background:#0F0F0E;border-radius:12px 12px 0 0;padding:28px 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td><span style="display:inline-block;background:#E5FF47;border-radius:8px;padding:6px 12px;font-size:15px;font-weight:800;color:#0F0F0E;letter-spacing:-0.3px">✓ LYJOB</span></td>
            <td align="right" style="font-size:12px;color:#888">Sistema Tributario Ecuador 🇪🇨</td>
          </tr>
        </table>
      </td></tr>

      <!-- ALERTA BANNER -->
      <tr><td style="background:#E5FF47;padding:16px 32px;border-left:1px solid #D4EE40;border-right:1px solid #D4EE40">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;font-weight:700;color:#0F0F0E;text-transform:uppercase;letter-spacing:0.5px">
              🔔 ALERTA — Notificaciones Electrónicas SRI
            </td>
            <td align="right" style="font-size:12px;color:#555">${fechaHora}</td>
          </tr>
        </table>
      </td></tr>

      <!-- BODY -->
      <tr><td style="background:#ffffff;padding:36px 32px;border-left:1px solid #E5E3DC;border-right:1px solid #E5E3DC">

        <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#0F0F0E;letter-spacing:-0.5px">
          ${total} Nueva${total > 1 ? 's' : ''} Notificación${total > 1 ? 'es' : ''}
        </h1>
        <p style="margin:0 0 28px;color:#666;font-size:15px;line-height:1.5">
          Se detectaron <strong>${total} notificación${total > 1 ? 'es' : ''} electrónica${total > 1 ? 's' : ''}</strong> 
          nuevas en el portal del SRI para <strong>${clientesConNotif.length} cliente${clientesConNotif.length > 1 ? 's' : ''}</strong>.
          Por favor ingrese al sistema para revisar el detalle.
        </p>

        <!-- TABLA DE CLIENTES -->
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E3DC;border-radius:8px;overflow:hidden;margin-bottom:28px">
          <thead>
            <tr style="background:#F7F6F2">
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px">Cliente</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px">RUC</th>
              <th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:700;color:#856404;text-transform:uppercase;letter-spacing:0.5px">Sección Superior</th>
              <th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:700;color:#0C5460;text-transform:uppercase;letter-spacing:0.5px">Sección Inferior</th>
              <th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:700;color:#0F0F0E;text-transform:uppercase;letter-spacing:0.5px">Total</th>
            </tr>
          </thead>
          <tbody>
            ${filasClientes}
          </tbody>
        </table>

        <!-- INFO SECCIONES -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
          <tr>
            <td width="48%" style="background:#FFF8E1;border-radius:8px;padding:16px;border-left:3px solid #FFC107">
              <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#856404;text-transform:uppercase">📋 Sección Superior</p>
              <p style="margin:0;font-size:13px;color:#555;line-height:1.4">Notificaciones de actos administrativos, resoluciones y comunicaciones oficiales del SRI.</p>
            </td>
            <td width="4%"></td>
            <td width="48%" style="background:#E8F4FD;border-radius:8px;padding:16px;border-left:3px solid #17A2B8">
              <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#0C5460;text-transform:uppercase">📋 Sección Inferior</p>
              <p style="margin:0;font-size:13px;color:#555;line-height:1.4">Notificaciones de trámites, solicitudes y comunicaciones complementarias del SRI.</p>
            </td>
          </tr>
        </table>

        <p style="margin:0;font-size:13px;color:#888;line-height:1.5;border-top:1px solid #E5E3DC;padding-top:20px">
          ⚠️ <strong>Importante:</strong> Revise estas notificaciones a la brevedad posible para evitar vencimiento de plazos legales.
        </p>

      </td></tr>

      <!-- CTA -->
      <tr><td style="background:#ffffff;padding:0 32px 32px;border-left:1px solid #E5E3DC;border-right:1px solid #E5E3DC;text-align:center">
        <a href="https://lyjob.org/notificaciones-sri" 
           style="display:inline-block;background:#0F0F0E;color:#E5FF47;text-decoration:none;padding:14px 36px;border-radius:24px;font-weight:700;font-size:15px;letter-spacing:-0.3px">
          Ver Notificaciones en Lyjob →
        </a>
      </td></tr>

      <!-- FOOTER -->
      <tr><td style="background:#F7F6F2;border-radius:0 0 12px 12px;padding:20px 32px;border:1px solid #E5E3DC;border-top:none">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:11px;color:#999">
              Este es un mensaje automático del Sistema Lyjob.<br/>
              Revisión programada: 08:35 · 12:00 · 17:00 (hora Ecuador)
            </td>
            <td align="right" style="font-size:11px;color:#bbb">lyjob.org</td>
          </tr>
        </table>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  await emailSvc.sendEmail({
    to: email,
    subject: `🔔 [Lyjob] ${total} Nueva${total > 1 ? 's' : ''} Notificación${total > 1 ? 'es' : ''} SRI — ${clientesConNotif.map(c => c.ruc).join(', ')}`,
    html
  });

  // Marcar como enviadas
  await db.query(
    `UPDATE sri_notificaciones SET email_enviado=1, fecha_envio_email=NOW() 
     WHERE organization_id=? AND email_enviado=0`,
    [org_id]
  );
}

async function logEjecucion(org_id, tipo, resultado, clientes, nuevas, emails) {
  try {
    await db.query(
      `INSERT INTO sri_notif_log (organization_id, tipo, resultado, clientes_revisados, notificaciones_nuevas, emails_enviados)
       VALUES (?,?,?,?,?,?)`,
      [org_id, tipo, resultado, clientes, nuevas, emails]
    );
  } catch(e) {}
}

/**
 * Iniciar todos los schedulers de notificaciones SRI
 */
async function initAllSchedulers() {
  console.log('⏰ [SRI-NOTIF] Iniciando schedulers...');
  
  // Crear tablas si no existen
  const createTablesSql = [
    `CREATE TABLE IF NOT EXISTS sri_notif_config (id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),organization_id VARCHAR(36) NOT NULL,emails_notificacion JSON NOT NULL DEFAULT ('[]'),horarios JSON NOT NULL DEFAULT ('["08:35","12:00","17:00"]'),activo TINYINT(1) DEFAULT 1,sri_credentials TEXT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY uq_org (organization_id))`,
    `CREATE TABLE IF NOT EXISTS sri_notif_clientes (id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),config_id VARCHAR(36),organization_id VARCHAR(36) NOT NULL,client_id VARCHAR(36) NOT NULL,ruc VARCHAR(20) NOT NULL,razon_social VARCHAR(500),sri_usuario VARCHAR(20) NULL,sri_clave TEXT NULL,activo TINYINT(1) DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_org_client (organization_id, client_id))`,
    `CREATE TABLE IF NOT EXISTS sri_notificaciones (id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),organization_id VARCHAR(36) NOT NULL,client_id VARCHAR(36),ruc VARCHAR(20) NOT NULL,razon_social VARCHAR(500),seccion VARCHAR(50) NOT NULL,numero_tramite VARCHAR(100),descripcion TEXT,fecha_notificacion VARCHAR(100),remitente VARCHAR(255),asunto TEXT,datos_json LONGTEXT,hash_unico VARCHAR(64),email_enviado TINYINT(1) DEFAULT 0,fecha_envio_email DATETIME,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_hash (hash_unico))`,
    `CREATE TABLE IF NOT EXISTS sri_notif_log (id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),organization_id VARCHAR(36),tipo VARCHAR(50),resultado TEXT,clientes_revisados INT DEFAULT 0,notificaciones_nuevas INT DEFAULT 0,emails_enviados INT DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
  ];
  
  for (const sql of createTablesSql) {
    try { await db.query(sql); } catch(e) { /* ya existe */ }
  }
  
  // Agregar columna sri_credentials si no existe
  try {
    await db.query('ALTER TABLE sri_notif_config ADD COLUMN sri_credentials TEXT NULL');
    console.log('✅ Columna sri_credentials agregada');
  } catch(e) {
    if (!e.message.includes('Duplicate column')) console.log('ℹ️  sri_credentials:', e.message.substring(0,50));
  }

  // Agregar columnas de credenciales por cliente
  for (const alterSql of [
    'ALTER TABLE sri_notif_clientes ADD COLUMN sri_usuario VARCHAR(20) NULL',
    'ALTER TABLE sri_notif_clientes ADD COLUMN sri_clave TEXT NULL'
  ]) {
    try { await db.query(alterSql); } catch(e) { /* ya existe */ }
  }
  
  try {
    const [configs] = await db.query(
      'SELECT * FROM sri_notif_config WHERE activo = 1'
    );
    for (const config of configs) {
      updateSchedule(config.organization_id, config);
    }
    console.log(`✅ [SRI-NOTIF] ${configs.length} schedulers activos`);
  } catch(e) {
    console.log('⚠️  [SRI-NOTIF] Error iniciando schedulers:', e.message);
  }
}

/**
 * Actualizar/crear el schedule para una organización
 */
function updateSchedule(org_id, config) {
  // Cancelar jobs anteriores
  if (activeJobs[org_id]) {
    activeJobs[org_id].forEach(j => j.stop());
    delete activeJobs[org_id];
  }

  if (!config || !config.activo) return;

  const horarios = safeJsonParse(config.horarios, ['08:35','12:00','17:00']);
  const jobs = [];

  for (const hora of horarios) {
    const [h, m] = hora.split(':');
    // Cron: minuto hora * * * (Hora Ecuador = UTC-5)
    const cronExpr = `${m} ${h} * * *`;
    try {
      const job = cron.schedule(cronExpr, () => {
        console.log(`⏰ [SRI-NOTIF] Ejecutando revisión programada ${hora} para org: ${org_id}`);
        revisarNotificaciones(org_id).catch(console.error);
      }, { timezone: 'America/Guayaquil' });
      jobs.push(job);
      console.log(`✅ [SRI-NOTIF] Schedule creado: ${hora} para org ${org_id}`);
    } catch(e) {
      console.log(`❌ [SRI-NOTIF] Error creando schedule ${hora}:`, e.message);
    }
  }

  if (jobs.length > 0) activeJobs[org_id] = jobs;
}

module.exports = {
  revisarNotificaciones,
  updateSchedule,
  initAllSchedulers,
  consultarSRI,
  consultarSRIv2,
  enviarEmailNotificacion
};

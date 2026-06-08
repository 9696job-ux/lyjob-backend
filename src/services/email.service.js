const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false },
});

const FROM = `"${process.env.EMAIL_FROM_NAME || 'Lyjob'}" <${process.env.EMAIL_FROM}>`;

// ─── Plantilla base HTML ──────────────────────────────────────────────────────
function baseTemplate(title, content, cta = null) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F7F6F2;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F2;padding:32px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <!-- HEADER -->
      <tr><td style="background:#0F0F0E;border-radius:12px 12px 0 0;padding:28px 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <span style="display:inline-block;background:#E5FF47;border-radius:8px;padding:6px 12px;font-size:14px;font-weight:700;color:#0F0F0E;letter-spacing:-0.3px">LYJOB</span>
            </td>
            <td align="right" style="font-size:12px;color:#555">Sistema Tributario Ecuador 🇪🇨</td>
          </tr>
        </table>
      </td></tr>
      <!-- BODY -->
      <tr><td style="background:#ffffff;padding:36px 32px;border-left:1px solid #E5E3DC;border-right:1px solid #E5E3DC">
        ${content}
      </td></tr>
      ${cta ? `
      <!-- CTA -->
      <tr><td style="background:#ffffff;padding:0 32px 32px;border-left:1px solid #E5E3DC;border-right:1px solid #E5E3DC;text-align:center">
        <a href="${cta.url}" style="display:inline-block;background:#0F0F0E;color:#E5FF47;text-decoration:none;padding:14px 32px;border-radius:24px;font-weight:700;font-size:15px">${cta.label}</a>
      </td></tr>` : ''}
      <!-- FOOTER -->
      <tr><td style="background:#F7F6F2;border-radius:0 0 12px 12px;border:1px solid #E5E3DC;border-top:none;padding:20px 32px;text-align:center">
        <p style="margin:0;font-size:12px;color:#888">© ${new Date().getFullYear()} Lyjob · Sistema de Análisis Tributario · Ecuador</p>
        <p style="margin:6px 0 0;font-size:11px;color:#aaa">Este correo fue enviado desde <strong>no-reply@lyjob.com</strong></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// ─── Correo de bienvenida / verificación ──────────────────────────────────────
async function sendWelcomeVerification(to, fullName, verifyUrl) {
  const content = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0F0F0E">Bienvenido a Lyjob, ${fullName || 'contador'} 👋</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6">
      Tu cuenta ha sido creada exitosamente. Solo necesitas confirmar tu correo electrónico para comenzar a gestionar declaraciones, trámites y análisis tributarios del SRI.
    </p>
    <div style="background:#F7F6F2;border-radius:10px;padding:20px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.6px;font-weight:600">Tu correo registrado</p>
      <p style="margin:6px 0 0;font-size:16px;font-weight:600;color:#0F0F0E;font-family:monospace">${to}</p>
    </div>
    <p style="margin:0 0 8px;font-size:14px;color:#555">Haz clic en el botón de abajo para verificar tu cuenta:</p>
  `;
  return transporter.sendMail({
    from: FROM,
    to,
    subject: '✅ Confirma tu cuenta en Lyjob',
    html: baseTemplate('Confirma tu cuenta', content, { url: verifyUrl, label: 'Verificar mi cuenta →' }),
  });
}

// ─── Correo de recuperación de contraseña ────────────────────────────────────
async function sendPasswordReset(to, fullName, resetUrl) {
  const content = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0F0F0E">Restablecer contraseña</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6">
      Hola <strong>${fullName || to}</strong>, recibimos una solicitud para restablecer la contraseña de tu cuenta Lyjob.
    </p>
    <div style="background:#FFF7ED;border-left:4px solid #F59E0B;border-radius:0 8px 8px 0;padding:16px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#92400E">⏰ Este enlace expira en <strong>1 hora</strong>. Si no solicitaste esto, ignora este correo.</p>
    </div>
  `;
  return transporter.sendMail({
    from: FROM,
    to,
    subject: '🔑 Restablecer contraseña — Lyjob',
    html: baseTemplate('Restablecer contraseña', content, { url: resetUrl, label: 'Restablecer mi contraseña →' }),
  });
}

// ─── Correo confirmación de pago / suscripción ───────────────────────────────
async function sendSubscriptionConfirmed(to, fullName, planName, expiresDate) {
  const content = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0F0F0E">¡Suscripción activada! 🎉</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6">
      Hola <strong>${fullName || to}</strong>, tu pago fue procesado exitosamente.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E3DC;border-radius:10px;overflow:hidden;margin-bottom:24px">
      <tr><td style="background:#0F0F0E;padding:14px 20px">
        <span style="font-size:18px;font-weight:700;color:#E5FF47">${planName}</span>
      </td></tr>
      <tr><td style="padding:16px 20px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;color:#888;padding:4px 0">Plan activo hasta</td>
            <td align="right" style="font-size:13px;font-weight:600;color:#0F0F0E;font-family:monospace">${expiresDate}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding:4px 0">Estado</td>
            <td align="right"><span style="background:#DCFCE7;color:#166534;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px">ACTIVO</span></td>
          </tr>
        </table>
      </td></tr>
    </table>
    <p style="margin:0;font-size:14px;color:#555">Ahora tienes acceso completo a todas las funciones de tu plan. ¡Comienza a procesar tus declaraciones!</p>
  `;
  return transporter.sendMail({
    from: FROM,
    to,
    subject: `🎉 Tu plan ${planName} está activo — Lyjob`,
    html: baseTemplate('Suscripción activada', content, { url: `${process.env.FRONTEND_URL}/home`, label: 'Ir a mi cuenta →' }),
  });
}

// ─── Correo alerta providencia SRI ───────────────────────────────────────────
async function sendProvidenciaAlert(to, tramite, prov, diasRestantes) {
  const urgencia = diasRestantes <= 1 ? '🔴 URGENTE' : diasRestantes <= 3 ? '⚠️ IMPORTANTE' : '📋 RECORDATORIO';
  const colorBg  = diasRestantes <= 1 ? '#FEE2E2' : diasRestantes <= 3 ? '#FEF3C7' : '#DBEAFE';
  const colorTxt = diasRestantes <= 1 ? '#991B1B' : diasRestantes <= 3 ? '#92400E' : '#1E3A5F';
  const content = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0F0F0E">${urgencia}: Providencia por vencer</h1>
    <div style="background:${colorBg};border-radius:10px;padding:16px 20px;margin-bottom:24px">
      <p style="margin:0;font-size:18px;font-weight:700;color:${colorTxt}">⏰ Quedan ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}</p>
      <p style="margin:6px 0 0;font-size:13px;color:${colorTxt}">Providencia <strong>${prov.numero_providencia}</strong> del trámite <strong>${tramite.numero_tramite}</strong></p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E3DC;border-radius:10px;overflow:hidden;margin-bottom:20px">
      <tr style="background:#F7F6F2"><td style="padding:10px 16px;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.6px" colspan="2">Detalle del trámite</td></tr>
      ${[
        ['Cliente', tramite.cliente_nombre],
        ['RUC', tramite.cliente_ruc],
        ['Nº Trámite', tramite.numero_tramite],
        ['Providencia', prov.numero_providencia],
        ['Asunto', prov.asunto],
        ['Fecha notificación', prov.fecha_notificacion],
        ['Fecha vencimiento', prov.fecha_vencimiento],
      ].map(([k, v]) => `<tr><td style="padding:8px 16px;font-size:13px;color:#888;border-top:1px solid #F0EFE9;width:140px">${k}</td><td style="padding:8px 16px;font-size:13px;font-weight:600;color:#0F0F0E;border-top:1px solid #F0EFE9">${v || '—'}</td></tr>`).join('')}
    </table>
    ${prov.observaciones ? `<div style="background:#F7F6F2;border-radius:8px;padding:14px;font-size:13px;color:#555"><strong>Observaciones:</strong> ${prov.observaciones}</div>` : ''}
  `;
  return transporter.sendMail({
    from: FROM,
    to,
    subject: `${urgencia}: Trámite ${tramite.numero_tramite} — ${diasRestantes}d para vencimiento`,
    html: baseTemplate('Alerta de Providencia SRI', content, { url: `${process.env.FRONTEND_URL}/home`, label: 'Ver en Lyjob →' }),
  });
}

// ─── Correo de notificación al admin cuando se registra un usuario ────────────
async function sendAdminNewUser(adminEmail, newUser) {
  const content = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0F0F0E">Nuevo usuario registrado</h1>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E3DC;border-radius:10px;overflow:hidden">
      ${[
        ['Nombre', newUser.full_name || '(sin nombre)'],
        ['Correo', newUser.email],
        ['Fecha', new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })],
      ].map(([k, v]) => `<tr><td style="padding:10px 16px;font-size:13px;color:#888;border-bottom:1px solid #F0EFE9;width:120px">${k}</td><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#0F0F0E;border-bottom:1px solid #F0EFE9">${v}</td></tr>`).join('')}
    </table>
  `;
  return transporter.sendMail({
    from: FROM,
    to: adminEmail,
    subject: `🆕 Nuevo registro: ${newUser.email}`,
    html: baseTemplate('Nuevo usuario', content, { url: `${process.env.FRONTEND_URL}/home`, label: 'Ver en Admin →' }),
  });
}

module.exports = {
  sendWelcomeVerification,
  sendPasswordReset,
  sendSubscriptionConfirmed,
  sendProvidenciaAlert,
  sendAdminNewUser,
};

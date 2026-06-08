const cron = require('node-cron');
const db   = require('../db/connection');
const emailSvc = require('../services/email.service');
const { differenceInDays } = require('../utils/dates');

function startCronJobs() {
  console.log('⏰ Iniciando tareas programadas...');

  // ─── Diario 8am Ecuador: alertas providencias ─────────────────────────────
  cron.schedule('0 8 * * *', async () => {
    console.log('🔔 [CRON] Enviando alertas de providencias...');
    try {
      const [tramites] = await db.query(
        "SELECT * FROM tramites WHERE estado IN ('ingresado','en_revision')"
      );
      let enviados = 0;
      const hoy = new Date();

      for (const tramite of tramites) {
        const providencias = typeof tramite.providencias === 'string'
          ? JSON.parse(tramite.providencias || '[]')
          : (tramite.providencias || []);

        let changed = false;
        for (let i = 0; i < providencias.length; i++) {
          const prov = providencias[i];
          if (prov.estado !== 'pendiente' || !prov.correos_notificacion?.length) continue;

          const dias  = differenceInDays(new Date(prov.fecha_vencimiento), hoy);
          const aviso = prov.avisar_dias_antes || 5;
          if (dias > aviso) continue;

          const hoyStr = hoy.toISOString().split('T')[0];
          if (prov.ultimo_aviso_enviado?.split('T')[0] === hoyStr) continue;

          for (const correo of prov.correos_notificacion.filter(c => c?.trim())) {
            try {
              await emailSvc.sendProvidenciaAlert(correo, tramite, prov, dias);
              enviados++;
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
      console.log(`  ✅ ${enviados} alertas enviadas`);
    } catch (err) {
      console.error('  ❌ Error en cron providencias:', err.message);
    }
  }, { timezone: 'America/Guayaquil' });

  // ─── Diario 6am Ecuador: actualizar días restantes de trámites ────────────
  cron.schedule('0 6 * * *', async () => {
    console.log('📅 [CRON] Actualizando días restantes de trámites...');
    try {
      const [tramites] = await db.query(
        "SELECT id, fecha_vencimiento FROM tramites WHERE estado IN ('ingresado','en_revision') AND fecha_vencimiento IS NOT NULL"
      );
      const hoy = new Date();
      for (const t of tramites) {
        const dias = differenceInDays(new Date(t.fecha_vencimiento), hoy);
        await db.query('UPDATE tramites SET dias_restantes = ? WHERE id = ?', [dias, t.id]);
      }
      console.log(`  ✅ ${tramites.length} trámites actualizados`);
    } catch (err) {
      console.error('  ❌ Error actualizando trámites:', err.message);
    }
  }, { timezone: 'America/Guayaquil' });

  // ─── Limpieza de tokens expirados — cada domingo 2am ─────────────────────
  cron.schedule('0 2 * * 0', async () => {
    console.log('🧹 [CRON] Limpiando tokens expirados...');
    try {
      const [result] = await db.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
      console.log(`  ✅ ${result.affectedRows} tokens eliminados`);
    } catch (err) {
      console.error('  ❌ Error limpiando tokens:', err.message);
    }
  }, { timezone: 'America/Guayaquil' });

  console.log('✅ Tareas programadas iniciadas');
}

module.exports = { startCronJobs };

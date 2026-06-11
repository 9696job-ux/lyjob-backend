/**
 * MIGRACIÓN COMPLETA Base44 → Railway
 * Descarga todos los módulos de Base44 usando su API interna
 * y los inserta en Railway MySQL
 */
const db = require('./src/db/connection');
const https = require('https');
const crypto = require('crypto');

// Token de Base44 - se pasa como variable de entorno o argumento
const B44_TOKEN = process.env.B44_TOKEN || process.argv[2];
const APP_ID = '692b5deb8859727ee371ea22';

if (!B44_TOKEN) {
  console.error('ERROR: Necesitas pasar el token de Base44');
  console.error('Uso: node migrate_b44_full.js TU_TOKEN');
  process.exit(1);
}

// Función para llamar la API de Base44
function b44Fetch(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'app.base44.com',
      path: `/api/apps/${APP_ID}${path}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${B44_TOKEN}`,
        'Content-Type': 'application/json',
        'Origin': 'https://app.base44.com',
        'Referer': 'https://app.base44.com/'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, data: data.substring(0, 200) });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Mapeo de entidades Base44 → tablas Railway
const ENTITIES = [
  { b44: 'ExtractedData', table: 'extracted_data' },
  { b44: 'RetencionesRecibidas', table: 'retenciones_recibidas' },
  { b44: 'AtsData', table: 'ats_data' },
  { b44: 'EvaluacionDiaria', table: 'evaluacion_diaria' },
  { b44: 'ReconciliacionAts', table: 'reconciliacion_ats' },
  { b44: 'RentaData', table: 'renta_data' },
  { b44: 'RdepData', table: 'rdep_data' },
  { b44: 'ReconciliacionRenta', table: 'reconciliacion_renta' },
  { b44: 'SriCredential', table: 'sri_credentials' },
  { b44: 'SriDocument', table: 'sri_documents' },
  { b44: 'SriDownloadHistory', table: 'sri_download_history' },
  { b44: 'SriSchedule', table: 'sri_schedule' },
  { b44: 'SriXmlReconciliation', table: 'sri_xml_reconciliation' },
  { b44: 'XmlRetencion', table: 'xml_retenciones' },
  { b44: 'Template', table: 'templates_b44' },
  { b44: 'UserSubscription', table: 'user_subscriptions' },
];

async function migrateEntity(entityDef) {
  const { b44, table } = entityDef;
  
  console.log(`\n📥 Descargando ${b44}...`);
  
  // Intentar con el endpoint de records
  const result = await b44Fetch(`/entities/${b44}/records?limit=1000`);
  
  if (result.status !== 200) {
    console.log(`  ⚠️  Status ${result.status} para ${b44} - ${JSON.stringify(result.data).substring(0,100)}`);
    return { entity: b44, count: 0, status: 'error', code: result.status };
  }
  
  const records = Array.isArray(result.data) ? result.data : 
                  (result.data.data || result.data.records || result.data.items || []);
  
  if (!records.length) {
    console.log(`  ℹ️  Sin datos en ${b44}`);
    return { entity: b44, count: 0, status: 'empty' };
  }
  
  console.log(`  ✅ ${records.length} registros encontrados`);
  
  await db.query('SET FOREIGN_KEY_CHECKS=0');
  let ok = 0, errors = 0;
  
  for (const rec of records) {
    try {
      const id = rec.id || rec._id || crypto.randomUUID();
      const client_id = rec.client_id || rec.clientId || rec.client || null;
      const datos_json = JSON.stringify(rec);
      
      await db.query(
        `INSERT INTO ${table} (id, client_id, datos_json) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE datos_json=VALUES(datos_json), client_id=COALESCE(VALUES(client_id), client_id)`,
        [id, client_id, datos_json]
      );
      ok++;
    } catch(e) {
      errors++;
      if (errors <= 3) console.log(`  ❌ Error: ${e.message.substring(0,80)}`);
    }
  }
  
  await db.query('SET FOREIGN_KEY_CHECKS=1');
  console.log(`  💾 Insertados: ${ok}/${records.length} (errores: ${errors})`);
  return { entity: b44, count: ok, status: 'ok' };
}

async function main() {
  console.log('🚀 MIGRACIÓN COMPLETA Base44 → Railway');
  console.log('=====================================');
  
  // Verificar token
  const authTest = await b44Fetch('/entities/Client/records?limit=1');
  console.log(`Token test: Status ${authTest.status}`);
  
  if (authTest.status === 403) {
    console.log('❌ Token sin permisos de app. Intentando con endpoint alternativo...');
  }
  
  const results = [];
  for (const entity of ENTITIES) {
    const result = await migrateEntity(entity);
    results.push(result);
  }
  
  console.log('\n📊 RESUMEN MIGRACIÓN:');
  console.log('====================');
  let total = 0;
  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : r.status === 'empty' ? '⚪' : '❌';
    console.log(`${icon} ${r.entity}: ${r.count} registros`);
    total += r.count;
  }
  console.log(`\nTOTAL MIGRADO: ${total} registros`);
  process.exit(0);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});

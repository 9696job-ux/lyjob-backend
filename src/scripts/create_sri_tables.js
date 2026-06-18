const db = require('../db/connection');
async function run() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS sri_notif_config (id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),organization_id VARCHAR(36) NOT NULL,emails_notificacion JSON NOT NULL DEFAULT ('[]'),horarios JSON NOT NULL DEFAULT ('["08:35","12:00","17:00"]'),activo TINYINT(1) DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY uq_org (organization_id))`,
    `CREATE TABLE IF NOT EXISTS sri_notif_clientes (id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),config_id VARCHAR(36),organization_id VARCHAR(36) NOT NULL,client_id VARCHAR(36) NOT NULL,ruc VARCHAR(20) NOT NULL,razon_social VARCHAR(500),activo TINYINT(1) DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_org_client (organization_id, client_id))`,
    `CREATE TABLE IF NOT EXISTS sri_notificaciones (id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),organization_id VARCHAR(36) NOT NULL,client_id VARCHAR(36),ruc VARCHAR(20) NOT NULL,razon_social VARCHAR(500),seccion VARCHAR(50) NOT NULL,numero_tramite VARCHAR(255),descripcion TEXT,fecha_notificacion VARCHAR(100),remitente VARCHAR(255),asunto TEXT,datos_json LONGTEXT,hash_unico VARCHAR(64),email_enviado TINYINT(1) DEFAULT 0,fecha_envio_email DATETIME,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_hash (hash_unico))`,
    `CREATE TABLE IF NOT EXISTS sri_notif_log (id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),organization_id VARCHAR(36),tipo VARCHAR(50),resultado TEXT,clientes_revisados INT DEFAULT 0,notificaciones_nuevas INT DEFAULT 0,emails_enviados INT DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
  ];
  for (const sql of tables) {
    const name = sql.match(/TABLE IF NOT EXISTS (\w+)/)[1];
    try { await db.query(sql); console.log('OK:', name); }
    catch(e) { console.log('ERR:', name, e.message); }
  }
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });

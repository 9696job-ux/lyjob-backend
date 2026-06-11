const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// Crear todas las tablas de módulos
router.post('/create-tables', async (req, res) => {
  if (req.headers['x-migrate-secret'] !== 'b44_migration_2026') return res.status(403).json({error:'forbidden'});
  
  const tables = [
    `CREATE TABLE IF NOT EXISTS extracted_data (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      file_name VARCHAR(500),
      file_url TEXT,
      periodo VARCHAR(50),
      tipo VARCHAR(50),
      status VARCHAR(50) DEFAULT 'procesado',
      datos_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id),
      INDEX idx_periodo (periodo)
    )`,
    `CREATE TABLE IF NOT EXISTS retenciones_recibidas (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      numero_retencion VARCHAR(100),
      proveedor VARCHAR(500),
      ruc_proveedor VARCHAR(20),
      fecha DATE,
      base_imponible DECIMAL(15,2),
      porcentaje_iva DECIMAL(5,2),
      valor_retenido DECIMAL(15,2),
      periodo VARCHAR(50),
      datos_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS ats_data (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      periodo VARCHAR(50),
      tipo VARCHAR(50),
      datos_json LONGTEXT,
      status VARCHAR(50) DEFAULT 'pendiente',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS evaluacion_diaria (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      fecha DATE,
      tipo VARCHAR(100),
      descripcion TEXT,
      estado VARCHAR(50),
      datos_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS reconciliacion_ats (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      periodo VARCHAR(50),
      datos_json LONGTEXT,
      status VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS renta_data (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      anio VARCHAR(10),
      datos_json LONGTEXT,
      status VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS rdep_data (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      anio VARCHAR(10),
      datos_json LONGTEXT,
      status VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS reconciliacion_renta (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      anio VARCHAR(10),
      datos_json LONGTEXT,
      status VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sri_credentials (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      ruc VARCHAR(20),
      clave_sri VARCHAR(500),
      status VARCHAR(50),
      datos_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sri_documents (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      tipo_documento VARCHAR(100),
      numero VARCHAR(100),
      fecha DATE,
      emisor VARCHAR(500),
      ruc_emisor VARCHAR(20),
      monto DECIMAL(15,2),
      file_url TEXT,
      datos_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sri_download_history (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      fecha_descarga DATETIME,
      tipo VARCHAR(100),
      cantidad INT DEFAULT 0,
      datos_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sri_schedule (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      tipo VARCHAR(100),
      frecuencia VARCHAR(50),
      activo TINYINT(1) DEFAULT 1,
      datos_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sri_xml_reconciliation (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      periodo VARCHAR(50),
      datos_json LONGTEXT,
      status VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS xml_retenciones (
      id VARCHAR(36) PRIMARY KEY,
      client_id VARCHAR(36),
      numero VARCHAR(100),
      file_url TEXT,
      periodo VARCHAR(50),
      datos_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client (client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS templates (
      id VARCHAR(36) PRIMARY KEY,
      nombre VARCHAR(255),
      tipo VARCHAR(100),
      contenido LONGTEXT,
      datos_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_subscriptions (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36),
      plan VARCHAR(100),
      status VARCHAR(50),
      fecha_inicio DATE,
      fecha_fin DATE,
      datos_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id)
    )`
  ];

  await db.query('SET FOREIGN_KEY_CHECKS=0');
  let ok = 0;
  const errors = [];
  for (const sql of tables) {
    try {
      await db.query(sql);
      ok++;
    } catch(e) {
      errors.push(e.message.substring(0,100));
    }
  }
  await db.query('SET FOREIGN_KEY_CHECKS=1');
  res.json({ tablas_creadas: ok, total: tables.length, errors });
});

// Insertar datos de un módulo
router.post('/insert/:tabla', async (req, res) => {
  if (req.headers['x-migrate-secret'] !== 'b44_migration_2026') return res.status(403).json({error:'forbidden'});
  
  const { tabla } = req.params;
  const { records } = req.body;
  
  const ALLOWED = ['extracted_data','retenciones_recibidas','ats_data','evaluacion_diaria',
    'reconciliacion_ats','renta_data','rdep_data','reconciliacion_renta','sri_credentials',
    'sri_documents','sri_download_history','sri_schedule','sri_xml_reconciliation',
    'xml_retenciones','templates','user_subscriptions'];
  
  if (!ALLOWED.includes(tabla)) return res.status(400).json({error:'tabla no permitida'});
  if (!records || !records.length) return res.json({insertados:0});

  await db.query('SET FOREIGN_KEY_CHECKS=0');
  let ok = 0, errors = 0;
  
  for (const rec of records) {
    try {
      const id = rec.id || rec._id || require('crypto').randomUUID();
      const datos_json = JSON.stringify(rec);
      const client_id = rec.client_id || rec.clientId || rec.client || null;
      
      await db.query(
        `INSERT INTO ${tabla} (id, client_id, datos_json) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE datos_json=VALUES(datos_json), client_id=VALUES(client_id)`,
        [id, client_id, datos_json]
      );
      ok++;
    } catch(e) {
      errors++;
    }
  }
  
  await db.query('SET FOREIGN_KEY_CHECKS=1');
  res.json({ insertados: ok, errores: errors, total: records.length });
});

// Ver estado de migración
router.get('/status', async (req, res) => {
  if (req.headers['x-migrate-secret'] !== 'b44_migration_2026') return res.status(403).json({error:'forbidden'});
  
  const tables = ['users','clients','extracted_data','retenciones_recibidas','ats_data',
    'evaluacion_diaria','reconciliacion_ats','renta_data','rdep_data','sri_documents',
    'sri_credentials','xml_retenciones','templates','user_subscriptions'];
  
  const counts = {};
  for (const t of tables) {
    try {
      const [[row]] = await db.query(`SELECT COUNT(*) as n FROM ${t}`);
      counts[t] = row.n;
    } catch(e) {
      counts[t] = 'NO EXISTE';
    }
  }
  res.json(counts);
});

module.exports = router;

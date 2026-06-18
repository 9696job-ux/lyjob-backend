const db = require('./connection');

const migrations = [

// ─── USUARIOS ────────────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(36)  PRIMARY KEY DEFAULT (UUID()),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255),
  role          ENUM('admin','maestro','cargador','viewer') DEFAULT 'cargador',
  user_type     ENUM('maestro','cargador','viewer') DEFAULT 'cargador',
  organization_id VARCHAR(36),
  is_org_admin  TINYINT(1)   DEFAULT 0,
  is_active     TINYINT(1)   DEFAULT 1,
  is_verified   TINYINT(1)   DEFAULT 0,
  verify_token  VARCHAR(255),
  reset_token   VARCHAR(255),
  reset_expires DATETIME,
  subscription_plan_id   VARCHAR(36),
  subscription_plan_type VARCHAR(50),
  subscription_start     DATETIME,
  subscription_days      INT DEFAULT 0,
  last_login    DATETIME,
  created_date  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_date  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_org (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

// ─── TOKENS REFRESH ──────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         VARCHAR(36)  PRIMARY KEY DEFAULT (UUID()),
  user_id    VARCHAR(36)  NOT NULL,
  token      VARCHAR(512) NOT NULL UNIQUE,
  expires_at DATETIME     NOT NULL,
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_token (token),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── ORGANIZACIONES ──────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS organizations (
  id           VARCHAR(36)  PRIMARY KEY DEFAULT (UUID()),
  nombre       VARCHAR(255) NOT NULL,
  ruc          VARCHAR(20),
  codigo       VARCHAR(20) UNIQUE,
  created_by   VARCHAR(255),
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

// ─── PERMISOS DE USUARIO ─────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS user_permissions (
  id               VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_email       VARCHAR(255) NOT NULL,
  enabled_modules  JSON,
  created_date     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_email (user_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── CLIENTES ────────────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS clients (
  id              VARCHAR(36)  PRIMARY KEY DEFAULT (UUID()),
  razon_social    VARCHAR(255) NOT NULL,
  ruc             VARCHAR(20)  NOT NULL,
  status          ENUM('activo','inactivo') DEFAULT 'activo',
  organization_id VARCHAR(36),
  created_by      VARCHAR(255),
  created_date    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_org (organization_id),
  INDEX idx_created_by (created_by),
  INDEX idx_ruc (ruc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

// ─── PLANES ──────────────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS plans (
  id               VARCHAR(36)  PRIMARY KEY DEFAULT (UUID()),
  plan_name        VARCHAR(100) NOT NULL,
  plan_type        ENUM('Shark','Pro') NOT NULL,
  price_per_period DECIMAL(10,2) NOT NULL,
  billing_cycle    ENUM('monthly','annual') NOT NULL,
  is_active        TINYINT(1) DEFAULT 1,
  features         JSON,
  created_date     DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

// ─── SUSCRIPCIONES ───────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS user_subscriptions (
  id            VARCHAR(36)  PRIMARY KEY DEFAULT (UUID()),
  user_id       VARCHAR(36)  NOT NULL,
  plan_id       VARCHAR(36)  NOT NULL,
  status        ENUM('pending','active','cancelled','expired') DEFAULT 'pending',
  start_date    DATETIME,
  end_date      DATETIME,
  billing_cycle VARCHAR(20),
  metadata      JSON,
  created_date  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_status (status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── DATOS EXTRAÍDOS IVA ─────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS extracted_data (
  id             VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id      VARCHAR(36) NOT NULL,
  tipo           VARCHAR(20) DEFAULT 'iva',
  periodo        VARCHAR(20),
  status         ENUM('pending','processing','completed','error') DEFAULT 'pending',
  extracted_data LONGTEXT,
  file_name      VARCHAR(255),
  created_by     VARCHAR(255),
  created_date   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  INDEX idx_periodo (periodo),
  INDEX idx_status (status),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── DATOS RENTA ─────────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS renta_data (
  id             VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id      VARCHAR(36) NOT NULL,
  periodo        VARCHAR(20),
  status         ENUM('pending','completed','error') DEFAULT 'pending',
  extracted_data LONGTEXT,
  file_name      VARCHAR(255),
  created_by     VARCHAR(255),
  created_date   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── DATOS RDEP ──────────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS rdep_data (
  id             VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id      VARCHAR(36) NOT NULL,
  periodo        VARCHAR(20),
  extracted_data LONGTEXT,
  file_name      VARCHAR(255),
  created_by     VARCHAR(255),
  created_date   DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── RETENCIONES XML ─────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS xml_retenciones (
  id             VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id      VARCHAR(36) NOT NULL,
  periodo        VARCHAR(20),
  tipo           VARCHAR(50),
  xml_data       LONGTEXT,
  resumen        LONGTEXT,
  file_name      VARCHAR(255),
  created_by     VARCHAR(255),
  created_date   DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── DATOS ATS ───────────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS ats_data (
  id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id    VARCHAR(36) NOT NULL,
  periodo      VARCHAR(20),
  anio         INT,
  xml_data     LONGTEXT,
  parsed_data  LONGTEXT,
  file_name    VARCHAR(255),
  created_by   VARCHAR(255),
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── RECONCILIACIÓN ATS ──────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS reconciliacion_ats (
  id             VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id      VARCHAR(36) NOT NULL,
  periodo        VARCHAR(20),
  diferencias    LONGTEXT,
  resumen        LONGTEXT,
  status         VARCHAR(20),
  created_date   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── RECONCILIACIÓN RENTA ────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS reconciliacion_renta (
  id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id    VARCHAR(36) NOT NULL,
  periodo      VARCHAR(20),
  diferencias  LONGTEXT,
  resumen      LONGTEXT,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── RETENCIONES RECIBIDAS ───────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS retenciones_recibidas (
  id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id    VARCHAR(36) NOT NULL,
  periodo      VARCHAR(20),
  data         LONGTEXT,
  resumen      LONGTEXT,
  created_by   VARCHAR(255),
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── TRÁMITES SRI ────────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS tramites (
  id                    VARCHAR(36)  PRIMARY KEY DEFAULT (UUID()),
  numero_tramite        VARCHAR(255) NOT NULL,
  cliente_nombre        VARCHAR(255) NOT NULL,
  cliente_ruc           VARCHAR(20)  NOT NULL,
  tipo_tramite          VARCHAR(100),
  fecha_presentacion    DATE,
  fecha_vencimiento     DATE,
  fecha_resolucion      DATE,
  fecha_notificacion    DATE,
  estado                ENUM('ingresado','en_revision','finalizado') DEFAULT 'ingresado',
  plazo_dias            INT,
  dias_restantes        INT,
  monto_total_solicitado DECIMAL(14,2) DEFAULT 0,
  monto_aprobado        DECIMAL(14,2),
  numero_resolucion     VARCHAR(100),
  observaciones         TEXT,
  providencias          LONGTEXT,
  acciones_realizadas   LONGTEXT,
  organization_id       VARCHAR(36),
  created_by            VARCHAR(255),
  created_date          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_org (organization_id),
  INDEX idx_estado (estado),
  INDEX idx_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

// ─── DETALLE DEVOLUCIONES ────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS devolucion_detalles (
  id               VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tramite_id       VARCHAR(36) NOT NULL,
  tipo_devolucion  VARCHAR(100),
  periodo          VARCHAR(50),
  anio             INT,
  periodo_hasta    VARCHAR(50),
  anio_hasta       INT,
  monto_solicitado DECIMAL(14,2) DEFAULT 0,
  forma_devolucion VARCHAR(50),
  created_date     DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tramite (tramite_id),
  FOREIGN KEY (tramite_id) REFERENCES tramites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── CREDENCIALES SRI ────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS sri_credentials (
  id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id    VARCHAR(36) NOT NULL,
  ruc          VARCHAR(20),
  sri_username VARCHAR(255),
  sri_password VARCHAR(255),
  is_active    TINYINT(1) DEFAULT 1,
  created_by   VARCHAR(255),
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_client_user (client_id, sri_username),
  INDEX idx_client (client_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── DOCUMENTOS SRI ──────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS sri_documents (
  id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id    VARCHAR(36) NOT NULL,
  tipo         VARCHAR(50),
  periodo      VARCHAR(20),
  anio         INT,
  mes          INT,
  data         LONGTEXT,
  job_id       VARCHAR(100),
  status       VARCHAR(30) DEFAULT 'pending',
  created_by   VARCHAR(255),
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── HISTORIAL DESCARGAS SRI ─────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS sri_download_history (
  id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id    VARCHAR(36) NOT NULL,
  job_id       VARCHAR(100),
  tipo         VARCHAR(50),
  periodo      VARCHAR(20),
  status       VARCHAR(30),
  resultado    LONGTEXT,
  created_by   VARCHAR(255),
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  INDEX idx_job (job_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── DOCUMENTOS LEGALES ──────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS documentos_legales (
  id              VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  titulo          VARCHAR(255),
  tipo            VARCHAR(100),
  categoria       VARCHAR(100),
  contenido       LONGTEXT,
  resumen         TEXT,
  articulos       LONGTEXT,
  fecha_vigencia  DATE,
  numero_registro VARCHAR(100),
  estado          VARCHAR(50) DEFAULT 'vigente',
  metadata        LONGTEXT,
  created_by      VARCHAR(255),
  created_date    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tipo (tipo),
  INDEX idx_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

// ─── VERSIONES DOCUMENTO ─────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS version_documentos (
  id              VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  documento_id    VARCHAR(36) NOT NULL,
  version_numero  INT,
  contenido       LONGTEXT,
  cambios         TEXT,
  created_by      VARCHAR(255),
  created_date    DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_doc (documento_id),
  FOREIGN KEY (documento_id) REFERENCES documentos_legales(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── PERMISOS LEGALES ────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS permisos_legales (
  id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_email   VARCHAR(255) NOT NULL,
  documento_id VARCHAR(36),
  puede_ver    TINYINT(1) DEFAULT 1,
  puede_editar TINYINT(1) DEFAULT 0,
  puede_borrar TINYINT(1) DEFAULT 0,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_doc (user_email, documento_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── EVALUACIONES DIARIAS ────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS evaluaciones_diarias (
  id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id    VARCHAR(36) NOT NULL,
  fecha        DATE,
  resultados   LONGTEXT,
  errores      LONGTEXT,
  resumen      LONGTEXT,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  INDEX idx_fecha (fecha),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── FERIADOS CONFIG ─────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS feriado_config (
  id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  fecha        DATE NOT NULL UNIQUE,
  nombre       VARCHAR(255),
  activo       TINYINT(1) DEFAULT 1,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── STATUS MÓDULOS ──────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS module_status (
  id                  VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  module_id           VARCHAR(100) NOT NULL UNIQUE,
  is_active           TINYINT(1) DEFAULT 1,
  maintenance_message TEXT,
  updated_date        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── HISTORIAL PAGOS ─────────────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS payment_history (
  id                  VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id             VARCHAR(36) NOT NULL,
  plan_id             VARCHAR(36),
  transaction_id      VARCHAR(100),
  payphone_id         VARCHAR(100),
  amount              DECIMAL(10,2),
  status              ENUM('pending','approved','rejected','error') DEFAULT 'pending',
  payment_method      VARCHAR(50),
  metadata            LONGTEXT,
  created_date        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_transaction (transaction_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// ─── RECONCILIACIÓN XML SRI ──────────────────────────────────────────────────
`CREATE TABLE IF NOT EXISTS sri_xml_reconciliation (
  id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id    VARCHAR(36) NOT NULL,
  periodo      VARCHAR(20),
  diferencias  LONGTEXT,
  resumen      LONGTEXT,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

];

async function migrate() {
  console.log('🚀 Iniciando migración de base de datos...\n');
  let success = 0;
  for (let i = 0; i < migrations.length; i++) {
    const sql = migrations[i];
    const tableName = (sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/) || [])[1];
    try {
      await db.query(sql);
      console.log(`  ✅ Tabla "${tableName}" lista`);
      success++;
    } catch (err) {
      console.error(`  ❌ Error en tabla "${tableName}":`, err.message);
    }
  }
  console.log(`\n🎉 Migración completada: ${success}/${migrations.length} tablas`);
  process.exit(0);
}

migrate();

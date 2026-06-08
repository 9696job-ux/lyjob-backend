/**
 * CRUD genérico para todas las entidades.
 * Cada entidad define su tabla, campos permitidos y reglas de acceso.
 */
const router   = require('express').Router();
const db       = require('../db/connection');
const auth     = require('../middleware/auth');
const { requireMaestro } = require('../middleware/roles');
const { v4: uuid } = require('uuid');

// Helper: parse JSON fields from DB rows
function parseJsonFields(rows, fields) {
  return rows.map(row => {
    const out = { ...row };
    for (const f of fields) {
      if (out[f] && typeof out[f] === 'string') {
        try { out[f] = JSON.parse(out[f]); } catch { /* leave as string */ }
      }
    }
    return out;
  });
}

// Helper: stringify JSON fields for DB insert/update
function stringifyJsonFields(data, fields) {
  const out = { ...data };
  for (const f of fields) {
    if (out[f] !== undefined && typeof out[f] !== 'string') {
      out[f] = JSON.stringify(out[f]);
    }
  }
  return out;
}

// ─── ENTITY DEFINITIONS ───────────────────────────────────────────────────────
const ENTITIES = {
  Client: {
    table: 'clients',
    jsonFields: [],
    userFilter: (user) => {
      if (user.role === 'admin' || user.user_type === 'maestro') return {};
      if (user.organization_id) return { organization_id: user.organization_id };
      return { created_by: user.email };
    },
    onCreate: (user) => ({ created_by: user.email }),
  },
  Organization: {
    table: 'organizations',
    jsonFields: [],
    userFilter: () => ({}), // all can read
    onCreate: (user) => ({ created_by: user.email }),
  },
  Plan: {
    table: 'plans',
    jsonFields: ['features'],
    userFilter: () => ({ is_active: 1 }),
    readonly: true, // only maestro can write
  },
  UserSubscription: {
    table: 'user_subscriptions',
    jsonFields: ['metadata'],
    userFilter: (user) => ({ user_id: user.id }),
    onCreate: (user) => ({ user_id: user.id }),
  },
  ExtractedData: {
    table: 'extracted_data',
    jsonFields: ['extracted_data'],
    userFilter: (user) => {
      if (user.role === 'admin' || user.user_type === 'maestro') return {};
      return {};  // filtered by client_id param
    },
    onCreate: (user) => ({ created_by: user.email }),
  },
  RentaData: {
    table: 'renta_data',
    jsonFields: ['extracted_data'],
    userFilter: () => ({}),
    onCreate: (user) => ({ created_by: user.email }),
  },
  RdepData: {
    table: 'rdep_data',
    jsonFields: ['extracted_data'],
    userFilter: () => ({}),
    onCreate: (user) => ({ created_by: user.email }),
  },
  XmlRetencion: {
    table: 'xml_retenciones',
    jsonFields: ['xml_data', 'resumen'],
    userFilter: () => ({}),
    onCreate: (user) => ({ created_by: user.email }),
  },
  AtsData: {
    table: 'ats_data',
    jsonFields: ['xml_data', 'parsed_data'],
    userFilter: () => ({}),
    onCreate: (user) => ({ created_by: user.email }),
  },
  ReconciliacionAts: {
    table: 'reconciliacion_ats',
    jsonFields: ['diferencias', 'resumen'],
    userFilter: () => ({}),
    onCreate: () => ({}),
  },
  ReconciliacionRenta: {
    table: 'reconciliacion_renta',
    jsonFields: ['diferencias', 'resumen'],
    userFilter: () => ({}),
    onCreate: () => ({}),
  },
  RetencionesRecibidas: {
    table: 'retenciones_recibidas',
    jsonFields: ['data', 'resumen'],
    userFilter: () => ({}),
    onCreate: (user) => ({ created_by: user.email }),
  },
  Tramite: {
    table: 'tramites',
    jsonFields: ['providencias', 'acciones_realizadas'],
    userFilter: (user) => {
      if (user.role === 'admin' || user.user_type === 'maestro') return {};
      if (user.organization_id) return { organization_id: user.organization_id };
      return { created_by: user.email };
    },
    onCreate: (user) => ({ created_by: user.email }),
  },
  DevolucionDetalle: {
    table: 'devolucion_detalles',
    jsonFields: [],
    userFilter: () => ({}),
    onCreate: () => ({}),
  },
  SriCredential: {
    table: 'sri_credentials',
    jsonFields: [],
    userFilter: (user) => {
      if (user.role === 'admin' || user.user_type === 'maestro') return {};
      return { created_by: user.email };
    },
    onCreate: (user) => ({ created_by: user.email }),
  },
  SriDocument: {
    table: 'sri_documents',
    jsonFields: ['data'],
    userFilter: () => ({}),
    onCreate: (user) => ({ created_by: user.email }),
  },
  SriDownloadHistory: {
    table: 'sri_download_history',
    jsonFields: ['resultado'],
    userFilter: () => ({}),
    onCreate: (user) => ({ created_by: user.email }),
  },
  DocumentoLegal: {
    table: 'documentos_legales',
    jsonFields: ['articulos', 'metadata'],
    userFilter: () => ({}),
    onCreate: (user) => ({ created_by: user.email }),
  },
  VersionDocumento: {
    table: 'version_documentos',
    jsonFields: [],
    userFilter: () => ({}),
    onCreate: (user) => ({ created_by: user.email }),
  },
  PermisosLegales: {
    table: 'permisos_legales',
    jsonFields: [],
    userFilter: () => ({}),
    onCreate: () => ({}),
  },
  UserPermissions: {
    table: 'user_permissions',
    jsonFields: ['enabled_modules'],
    userFilter: () => ({}),
    onCreate: () => ({}),
  },
  EvaluacionDiaria: {
    table: 'evaluaciones_diarias',
    jsonFields: ['resultados', 'errores', 'resumen'],
    userFilter: () => ({}),
    onCreate: () => ({}),
  },
  FeriadoConfig: {
    table: 'feriado_config',
    jsonFields: [],
    userFilter: () => ({}),
    readonly: false,
  },
  ModuleStatus: {
    table: 'module_status',
    jsonFields: [],
    userFilter: () => ({}),
    readonly: true,
  },
  SriXmlReconciliation: {
    table: 'sri_xml_reconciliation',
    jsonFields: ['diferencias', 'resumen'],
    userFilter: () => ({}),
    onCreate: () => ({}),
  },
  User: {
    table: 'users',
    jsonFields: [],
    userFilter: (user) => {
      if (user.role === 'admin' || user.user_type === 'maestro') return {};
      return { organization_id: user.organization_id };
    },
    safeFields: ['id', 'email', 'full_name', 'role', 'user_type', 'organization_id', 'is_org_admin', 'is_active', 'is_verified', 'subscription_plan_type', 'subscription_start', 'subscription_days', 'last_login', 'created_date'],
    maestroOnly: false,
  },
};

// ─── ROUTE FACTORY ────────────────────────────────────────────────────────────
function buildWhere(filters) {
  if (!filters || !Object.keys(filters).length) return { clause: '', values: [] };
  const keys = Object.keys(filters).filter(k => filters[k] !== undefined);
  if (!keys.length) return { clause: '', values: [] };
  const clause = 'WHERE ' + keys.map(k => {
    if (Array.isArray(filters[k])) return `${k} IN (${filters[k].map(() => '?').join(',')})`;
    return `${k} = ?`;
  }).join(' AND ');
  const values = keys.flatMap(k => Array.isArray(filters[k]) ? filters[k] : [filters[k]]);
  return { clause, values };
}

for (const [entityName, def] of Object.entries(ENTITIES)) {
  const base = `/entities/${entityName}`;

  // LIST
  router.get(base, auth, async (req, res) => {
    try {
      const userFilter = def.userFilter ? def.userFilter(req.user) : {};
      const reqFilter  = req.query.filter ? JSON.parse(req.query.filter) : {};
      const combined   = { ...userFilter, ...reqFilter };
      const { clause, values } = buildWhere(combined);

      let orderBy = '';
      if (req.query.sort) {
        const sortField = req.query.sort.replace(/^-/, '');
        const sortDir   = req.query.sort.startsWith('-') ? 'DESC' : 'ASC';
        orderBy = ` ORDER BY ${sortField} ${sortDir}`;
      } else {
        orderBy = ' ORDER BY created_date DESC';
      }

      const cols = def.safeFields ? def.safeFields.join(',') : '*';
      const [rows] = await db.query(`SELECT ${cols} FROM ${def.table} ${clause}${orderBy} LIMIT 500`, values);
      res.json(parseJsonFields(rows, def.jsonFields));
    } catch (err) {
      console.error(`GET ${base} error:`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET BY ID
  router.get(`${base}/:id`, auth, async (req, res) => {
    try {
      const cols = def.safeFields ? def.safeFields.join(',') : '*';
      const [rows] = await db.query(`SELECT ${cols} FROM ${def.table} WHERE id = ? LIMIT 1`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
      res.json(parseJsonFields(rows, def.jsonFields)[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // CREATE
  router.post(base, auth, async (req, res) => {
    try {
      if (def.readonly) {
        const u = req.user;
        if (u.role !== 'admin' && u.user_type !== 'maestro') return res.status(403).json({ error: 'Solo administradores' });
      }
      const extras  = def.onCreate ? def.onCreate(req.user) : {};
      const payload  = stringifyJsonFields({ ...req.body, ...extras }, def.jsonFields);
      const id       = payload.id || uuid();
      payload.id     = id;

      // Build dynamic INSERT
      const keys   = Object.keys(payload);
      const vals   = Object.values(payload);
      const placeholders = keys.map(() => '?').join(',');
      await db.query(
        `INSERT INTO ${def.table} (${keys.join(',')}) VALUES (${placeholders})`,
        vals
      );
      const [rows] = await db.query(`SELECT * FROM ${def.table} WHERE id = ?`, [id]);
      res.status(201).json(parseJsonFields(rows, def.jsonFields)[0]);
    } catch (err) {
      console.error(`POST ${base} error:`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // UPDATE
  router.patch(`${base}/:id`, auth, async (req, res) => {
    try {
      if (def.readonly) {
        const u = req.user;
        if (u.role !== 'admin' && u.user_type !== 'maestro') return res.status(403).json({ error: 'Solo administradores' });
      }
      const payload   = stringifyJsonFields(req.body, def.jsonFields);
      delete payload.id;
      const keys      = Object.keys(payload);
      if (!keys.length) return res.status(400).json({ error: 'Nada que actualizar' });
      const setClauses = keys.map(k => `${k} = ?`).join(', ');
      await db.query(`UPDATE ${def.table} SET ${setClauses} WHERE id = ?`, [...Object.values(payload), req.params.id]);
      const [rows] = await db.query(`SELECT * FROM ${def.table} WHERE id = ?`, [req.params.id]);
      res.json(parseJsonFields(rows, def.jsonFields)[0]);
    } catch (err) {
      console.error(`PATCH ${base}/:id error:`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE
  router.delete(`${base}/:id`, auth, async (req, res) => {
    try {
      await db.query(`DELETE FROM ${def.table} WHERE id = ?`, [req.params.id]);
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // FILTER (POST with body)
  router.post(`${base}/filter`, auth, async (req, res) => {
    try {
      const userFilter = def.userFilter ? def.userFilter(req.user) : {};
      const combined   = { ...userFilter, ...req.body };
      const { clause, values } = buildWhere(combined);
      const cols = def.safeFields ? def.safeFields.join(',') : '*';

      let orderBy = req.query.sort
        ? ` ORDER BY ${req.query.sort.replace(/^-/, '')} ${req.query.sort.startsWith('-') ? 'DESC' : 'ASC'}`
        : ' ORDER BY created_date DESC';

      const [rows] = await db.query(`SELECT ${cols} FROM ${def.table} ${clause}${orderBy} LIMIT 500`, values);
      res.json(parseJsonFields(rows, def.jsonFields));
    } catch (err) {
      console.error(`POST ${base}/filter error:`, err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = router;

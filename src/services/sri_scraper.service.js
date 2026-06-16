/**
 * Scraper real del SRI — "Documentos notificados electrónicamente"
 * Manejo manual de cookies (sin wrapper incompatible con httpsAgent)
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const https   = require('https');

const BASE_URL   = 'https://srienlinea.sri.gob.ec';
const LOGIN_URL  = `${BASE_URL}/sri-en-linea/`;

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-EC,es;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

// ─── Manejo manual de cookies ──────────────────────────────────────────────
function parseCookies(setCookieHeaders) {
  const cookies = {};
  if (!setCookieHeaders) return cookies;
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const h of list) {
    const part = h.split(';')[0].trim();
    const idx = part.indexOf('=');
    if (idx > 0) {
      cookies[part.substring(0, idx).trim()] = part.substring(idx + 1).trim();
    }
  }
  return cookies;
}

function cookieString(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function mergeCookies(existing, newCookies) {
  return { ...existing, ...newCookies };
}

// ─── HTTP request con manejo de redirects y cookies ───────────────────────
async function httpGet(url, cookies = {}, extraHeaders = {}) {
  const resp = await axios.get(url, {
    httpsAgent: agent,
    maxRedirects: 0,
    validateStatus: s => s < 400 || s === 302 || s === 301,
    headers: {
      ...BASE_HEADERS,
      ...extraHeaders,
      ...(Object.keys(cookies).length > 0 ? { Cookie: cookieString(cookies) } : {}),
    },
    decompress: true,
  });
  const newCookies = parseCookies(resp.headers['set-cookie']);
  return { status: resp.status, data: resp.data, headers: resp.headers, cookies: mergeCookies(cookies, newCookies) };
}

async function httpPost(url, body, cookies = {}, extraHeaders = {}) {
  const resp = await axios.post(url, body, {
    httpsAgent: agent,
    maxRedirects: 0,
    validateStatus: s => s < 400 || s === 302 || s === 301,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...extraHeaders,
      ...(Object.keys(cookies).length > 0 ? { Cookie: cookieString(cookies) } : {}),
    },
    decompress: true,
  });
  const newCookies = parseCookies(resp.headers['set-cookie']);
  return { status: resp.status, data: resp.data, headers: resp.headers, cookies: mergeCookies(cookies, newCookies) };
}

// Seguir redirects manualmente (necesario para capturar cookies en cada salto)
async function seguirRedirects(url, cookies = {}, maxRedirects = 10) {
  let currentUrl = url;
  let currentCookies = { ...cookies };
  let lastResp = null;

  for (let i = 0; i < maxRedirects; i++) {
    const resp = await httpGet(currentUrl, currentCookies, { Referer: currentUrl });
    currentCookies = mergeCookies(currentCookies, resp.cookies);
    lastResp = resp;

    if (resp.status === 301 || resp.status === 302) {
      let location = resp.headers['location'] || '';
      if (location.startsWith('/')) location = BASE_URL + location;
      else if (!location.startsWith('http')) location = new URL(location, currentUrl).href;
      currentUrl = location;
    } else {
      break;
    }
  }
  return { ...lastResp, cookies: currentCookies, finalUrl: currentUrl };
}

// ─── Login en el SRI con Keycloak ─────────────────────────────────────────
async function loginSRI(ruc, clave) {
  let cookies = {};

  // PASO 1: Ir a la URL directa del auth de Keycloak
  // (más confiable que pasar por el portal que puede tener redirects variables)
  const keycloakAuthUrl = `${BASE_URL}/auth/realms/Internet/protocol/openid-connect/auth` +
    `?client_id=app-portal-internet` +
    `&redirect_uri=${encodeURIComponent(BASE_URL + '/sri-en-linea/')}` +
    `&response_type=code&scope=openid`;

  console.log(`    → GET Keycloak auth URL`);
  const resp0 = await seguirRedirects(keycloakAuthUrl, cookies);
  cookies = resp0.cookies;
  let loginPageUrl = resp0.finalUrl;
  let loginHtml = resp0.data || '';
  
  // Si la URL directa de Keycloak no devuelve el form, probar via el portal
  let $ = cheerio.load(loginHtml);
  let formAction = $('form#kc-form-login').attr('action') || '';
  
  if (!formAction) {
    // Intentar via el portal principal
    console.log(`    → Keycloak directo no retornó form, probando via portal...`);
    const respPortal = await seguirRedirects(LOGIN_URL, cookies);
    cookies = respPortal.cookies;
    loginPageUrl = respPortal.finalUrl;
    loginHtml = respPortal.data || '';
    $ = cheerio.load(loginHtml);
    formAction = $('form#kc-form-login').attr('action') || $('form[action*="login-actions"]').attr('action') || '';
  }

  console.log(`    → Login page: ${loginPageUrl.substring(0, 80)}`);
  console.log(`    → formAction encontrado: ${formAction ? 'SÍ' : 'NO'} (${formAction.substring(0, 60)})`);

  // PASO 2: Verificar que tenemos el form
  if (!formAction) {
    // Debug: ver qué HTML llegó
    console.log(`    ⚠️  HTML recibido (500 chars): ${loginHtml.replace(/\s+/g,' ').substring(0, 500)}`);
    return { ok: false, error: 'No se encontró el form de login del SRI', cookies };
  }

  if (formAction.startsWith('/')) formAction = BASE_URL + formAction;
  console.log(`    → Form action: ${formAction.substring(0, 80)}`);

  // PASO 3: POST al form de Keycloak
  const params = new URLSearchParams();
  params.append('username', ruc);
  params.append('password', clave);
  params.append('credentialId', '');

  const resp2 = await httpPost(formAction, params.toString(), cookies, {
    'Referer': loginPageUrl,
    'Origin': 'https://srienlinea.sri.gob.ec',
  });
  cookies = resp2.cookies;

  // PASO 4: Seguir redirects post-login (Keycloak → portal SRI)
  if (resp2.status === 302 || resp2.status === 301) {
    let redirectUrl = resp2.headers['location'] || '';
    if (redirectUrl.startsWith('/')) redirectUrl = BASE_URL + redirectUrl;
    console.log(`    → Post-login redirect: ${redirectUrl.substring(0, 80)}`);
    const resp3 = await seguirRedirects(redirectUrl, cookies);
    cookies = resp3.cookies;

    // Verificar si el login fue exitoso (no debe mostrar form de login de nuevo)
    const finalHtml = resp3.data || '';
    if (finalHtml.includes('kc-form-login') || finalHtml.includes('Clave incorrecta') || finalHtml.includes('Invalid credentials')) {
      return { ok: false, error: 'Credenciales SRI incorrectas o login fallido', cookies };
    }
  } else {
    // Verificar si el HTML de resp2 tiene error
    const resp2Html = resp2.data || '';
    if (resp2Html.includes('Clave incorrecta') || resp2Html.includes('Invalid credentials') || resp2Html.includes('kc-form-login')) {
      return { ok: false, error: 'Credenciales SRI incorrectas', cookies };
    }
  }

  console.log(`    ✅ Login SRI exitoso`);
  return { ok: true, cookies };
}

// ─── Parsear documentos de la página JSF ──────────────────────────────────
function parsearPaginaNotificaciones(html) {
  const $ = cheerio.load(html);
  const tablasDocs = [];

  // Buscar todas las tablas con filas de datos
  $('table').each((i, table) => {
    const rows = [];
    $(table).find('tr').each((j, row) => {
      const tds = [];
      $(row).find('td').each((k, td) => {
        tds.push($(td).text().replace(/\s+/g, ' ').trim());
      });
      // Filas válidas: al menos 4 celdas con contenido en la primera
      if (tds.length >= 4 && tds[0] && tds[0].length > 2) {
        rows.push(tds);
      }
    });
    if (rows.length > 0) tablasDocs.push(rows);
  });

  // 2 tablas en la página: primera = tabla superior, segunda = tabla inferior
  function mapRow(r) {
    return {
      tipo_documento: r[0] || '',
      aplicacion:     r[1] || '',
      oficina:        r[2] || '',
      numero:         r[3] || '',
      fecha:          r[4] || '',
      fecha_descarga: r[6] || '',
    };
  }

  const superior = (tablasDocs[0] || []).map(mapRow).filter(d => d.numero || d.fecha);
  const inferior = (tablasDocs[1] || []).map(mapRow).filter(d => d.numero || d.fecha);

  return { superior, inferior };
}

// ─── Función principal exportada ───────────────────────────────────────────
async function scrapearNotificacionesSRI(ruc, claveBase64) {
  const clave = Buffer.from(claveBase64, 'base64').toString('utf8');
  console.log(`  🔐 [SCRAPER] RUC: ${ruc}`);

  try {
    // LOGIN
    const loginResult = await loginSRI(ruc, clave);
    if (!loginResult.ok) {
      return { ok: false, error: loginResult.error, superior: [], inferior: [] };
    }
    const cookies = loginResult.cookies;

    // NAVEGAR A DOCUMENTOS NOTIFICADOS ELECTRÓNICAMENTE
    // La URL real incluye parámetros del menú lateral (contextoMPT, pathMPT, etc.)
    const notifUrl = `${BASE_URL}/gestion-documentos-internet/pages/materializacion.xhtml` +
      `?contextoMPT=${encodeURIComponent(BASE_URL + '/tuportal-internet')}` +
      `&pathMPT=${encodeURIComponent('Trámites y Notificaciones / Notificaciones')}` +
      `&actualMPT=${encodeURIComponent('Documentos notificados electrónicamente ')}` +
      `&linkMPT=${encodeURIComponent('/gestion-documentos-internet/pages/materializacion.xhtml?')}` +
      `&esFavorito=S`;

    console.log(`    → GET documentos notificados electrónicamente`);
    const respNotif = await httpGet(notifUrl, cookies, {
      'Referer': `${BASE_URL}/sri-en-linea/`,
    });
    const notifHtml = respNotif.data || '';

    if (!notifHtml || notifHtml.includes('kc-form-login')) {
      return { ok: false, error: 'Sesión inválida al acceder a notificaciones', superior: [], inferior: [] };
    }

    const tieneContenido = notifHtml.includes('Consulta de Documentos') ||
                           notifHtml.includes('materializacion') ||
                           notifHtml.includes('rich-table') ||
                           notifHtml.includes('notificad');

    if (!tieneContenido) {
      // Debug: mostrar primeros chars del HTML
      console.log(`    ⚠️  HTML inesperado: ${notifHtml.substring(0, 300)}`);
      return { ok: false, error: 'Página de notificaciones no reconocida', superior: [], inferior: [] };
    }

    const docs = parsearPaginaNotificaciones(notifHtml);
    console.log(`    📋 ${docs.superior.length} docs superiores, ${docs.inferior.length} inferiores`);

    return { ok: true, superior: docs.superior, inferior: docs.inferior };

  } catch(e) {
    console.error(`    ❌ [SCRAPER] Error:`, e.message);
    return { ok: false, error: e.message, superior: [], inferior: [] };
  }
}

module.exports = { scrapearNotificacionesSRI, parsearPaginaNotificaciones };

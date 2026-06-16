/**
 * Scraper real del SRI con Puppeteer (headless Chromium)
 * El SRI usa SPA Angular + Keycloak — requiere browser real para el login
 */

const puppeteer = require('puppeteer-core');
const chromiumPkg = require('@sparticuz/chromium');
const chromium = chromiumPkg.default || chromiumPkg;

const BASE_URL  = 'https://srienlinea.sri.gob.ec';
const NOTIF_URL = `${BASE_URL}/gestion-documentos-internet/pages/materializacion.xhtml` +
  `?contextoMPT=${encodeURIComponent(BASE_URL + '/tuportal-internet')}` +
  `&pathMPT=${encodeURIComponent('Trámites y Notificaciones / Notificaciones')}` +
  `&actualMPT=${encodeURIComponent('Documentos notificados electrónicamente ')}` +
  `&linkMPT=${encodeURIComponent('/gestion-documentos-internet/pages/materializacion.xhtml?')}` +
  `&esFavorito=S`;

async function scrapearNotificacionesSRI(ruc, claveBase64) {
  const clave = Buffer.from(claveBase64, 'base64').toString('utf8');
  console.log(`  🔐 [SCRAPER] Iniciando Puppeteer para RUC: ${ruc}`);

  let browser;
  try {
    // @sparticuz/chromium puede tener args como función o array
    const chromiumArgs = typeof chromium.args === 'function' ? chromium.args() : (chromium.args || []);
    const execPath = typeof chromium.executablePath === 'function' 
      ? await chromium.executablePath() 
      : chromium.executablePath;
    
    const launchArgs = [
      ...(Array.isArray(chromiumArgs) ? chromiumArgs : []),
      '--no-sandbox',
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--ignore-certificate-errors',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,800',
      '--start-maximized',
      '--lang=es-EC',
    ];
    
    console.log(`    → Chromium path: ${execPath}`);
    
    browser = await puppeteer.launch({
      args: launchArgs,
      defaultViewport: { width: 1280, height: 800 },
      executablePath: execPath,
      headless: true,
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    await page.setDefaultTimeout(45000);

    // Anti-detección headless: ocultar que es Puppeteer
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-EC,es;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    });
    // Eliminar propiedades que delatan que es headless
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['es-EC', 'es'] });
      window.chrome = { runtime: {} };
    });

    // Ir directo a Keycloak (ver abajo)de la SPA

    // Hacer clic en "Iniciar sesión" o navegar al login
    console.log(`    → Esperando form de login...`);
    // Ir directo a la URL de Keycloak que tiene el form HTML estático
    // (el portal SRI es una SPA Angular — no tiene form HTML sin ejecutar JS)
    const LOGIN_SELECTOR = 'input[name="username"], #username, input[name="identificacion"], #identificacion';
    const PASS_SELECTOR  = 'input[name="password"], #password, input[name="clave"], #clave, input[type="password"]';
    const BTN_SELECTOR   = 'button[type="submit"], input[type="submit"], #kc-login, .pf-c-button[type="submit"]';

    // URL real que usa el portal SRI (capturada de las network requests del browser)
    // client_id=app-sri-claves-angular (NO app-portal-internet)
    const kcUrl = `${BASE_URL}/auth/realms/Internet/protocol/openid-connect/auth` +
      `?client_id=app-sri-claves-angular` +
      `&redirect_uri=${encodeURIComponent(BASE_URL + '/sri-en-linea/acceso/identificacion')}` +
      `&response_mode=fragment` +
      `&response_type=code&scope=openid&prompt=login`;

    console.log(`    → Navegando a login Keycloak del SRI...`);
    await page.goto(kcUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    console.log(`    → Esperando form de login...`);
    try {
      await page.waitForSelector(LOGIN_SELECTOR, { timeout: 20000 });
    } catch(e) {
      // Ver qué URL tenemos y qué HTML
      const url = page.url();
      const html = await page.content();
      console.log(`    ⚠️ Form no encontrado. URL: ${url.substring(0,80)}`);
      console.log(`    ⚠️ HTML: ${html.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').substring(0,200)}`);
      return { ok: false, error: 'No se encontró el form de login del SRI', superior: [], inferior: [] };
    }

    // Llenar formulario de login
    console.log(`    → Ingresando credenciales...`);
    await page.evaluate(() => {
      const userField = document.querySelector('input[name="username"], #username');
      const passField = document.querySelector('input[name="password"], #password');
      if (userField) userField.value = '';
      if (passField) passField.value = '';
    });

    const usernameEl = await page.$(LOGIN_SELECTOR);
    const passwordEl = await page.$(PASS_SELECTOR);
    if (usernameEl) await usernameEl.type(ruc, { delay: 50 });
    if (passwordEl) await passwordEl.type(clave, { delay: 50 });

    // Submit
    console.log(`    → Enviando login...`);
    const submitBtn = await page.$(BTN_SELECTOR);
    if (!submitBtn) {
      return { ok: false, error: 'No se encontró botón de login', superior: [], inferior: [] };
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}),
      submitBtn.click(),
    ]);
    // Esperar que Angular complete el auth code exchange (procesa el #code en el fragment)
    // El redirect lleva a /acceso/identificacion#code=xxx&session_state=xxx
    // Angular hace el token exchange y luego redirige al portal autenticado
    console.log(`    → Esperando que Angular complete el auth exchange...`);
    await new Promise(r => setTimeout(r, 4000));

    // Verificar si hubo error de credenciales
    const loginCheckContent = await page.content();
    const loginCheckUrl = page.url();
    console.log(`    → URL post-login: ${loginCheckUrl.substring(0, 80)}`);
    
    if (loginCheckContent.includes('Clave incorrecta') || loginCheckContent.includes('Invalid credentials') || loginCheckContent.includes('nombre de usuario incorrecto')) {
      return { ok: false, error: 'Credenciales SRI incorrectas', superior: [], inferior: [] };
    }
    
    // Si sigue en la página de login (error de creds), fallar
    if (loginCheckUrl.includes('realms/Internet') && !loginCheckUrl.includes('#')) {
      return { ok: false, error: 'Login falló - sigue en Keycloak', superior: [], inferior: [] };
    }

    console.log(`    ✅ Login exitoso`);

    // Esperar que el SPA Angular inicialice la sesión completamente
    console.log(`    → Inicializando sesión en portal SRI...`);
    await page.goto(`${BASE_URL}/sri-en-linea/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));

    // Navegar a la sección de Trámites via el portal para establecer la sesión JSF
    // El portal SRI tiene un iframe/redirect al sistema JSF cuando se navega al menú
    console.log(`    → Navegando al menú Trámites y Notificaciones...`);
    const tramitesUrl = `${BASE_URL}/tuportal-internet/opciones.jsf`;
    await page.goto(tramitesUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    // Verificar si estamos en el portal JSF autenticado
    const portalHtml = await page.content();
    const portalUrl = page.url();
    console.log(`    → Portal URL: ${portalUrl.substring(0,80)}`);
    const enPortal = portalHtml.includes('Tr') && !portalHtml.includes('kc-form-login');
    console.log(`    → En portal autenticado: ${enPortal}`);

    // Navegar a Documentos notificados electrónicamente
    console.log(`    → Navegando a documentos notificados...`);
    await page.goto(NOTIF_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 6000)); // JSF necesita tiempo para cargar la tabla

    // Esperar que cargue la tabla
    try {
      await page.waitForSelector('table', { timeout: 20000 });
    } catch(e) {
      console.log(`    ⚠️  Tabla no encontrada, esperando más...`);
      await new Promise(r => setTimeout(r, 5000));
    }

    const html = await page.content();
    
    // Verificar sesión: si hay form de login real (no solo el texto del menú del portal)
    const hayFormLogin = html.includes('<form') && (html.includes('kc-form-login') || html.includes('id="password"'));
    if (hayFormLogin) {
      return { ok: false, error: 'Sesión perdida al navegar a notificaciones', superior: [], inferior: [] };
    }
    
    // Debug: reportar si la página tiene contenido de notificaciones
    const hasTable = html.includes('<table');
    const hasNotif = html.includes('Consulta de Documentos') || html.includes('materializacion') || html.includes('notificad');
    console.log(`    → Página notif: hasTable=${hasTable} hasNotif=${hasNotif} url=${page.url().substring(0,60)}`);
    if (!hasTable) {
      console.log(`    ⚠️  HTML snippet: ${html.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').substring(0,300)}`);
    }

    // Parsear las tablas
    const docs = await page.evaluate(() => {
      const tablas = [];
      document.querySelectorAll('table').forEach(table => {
        const rows = [];
        table.querySelectorAll('tr').forEach(row => {
          const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.replace(/\s+/g, ' ').trim());
          if (cells.length >= 4 && cells[0]) rows.push(cells);
        });
        if (rows.length > 0) tablas.push(rows);
      });
      return tablas;
    });

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

    const superior = (docs[0] || []).map(mapRow).filter(d => d.numero || d.fecha);
    const inferior = (docs[1] || []).map(mapRow).filter(d => d.numero || d.fecha);

    console.log(`    📋 ${superior.length} docs superiores, ${inferior.length} inferiores`);
    return { ok: true, superior, inferior };

  } catch(e) {
    console.error(`    ❌ [SCRAPER] Error:`, e.message);
    return { ok: false, error: e.message, superior: [], inferior: [] };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function parsearPaginaNotificaciones(html) {
  // Fallback para uso sin Puppeteer (no aplica para SRI pero mantenemos la interfaz)
  return { superior: [], inferior: [] };
}

module.exports = { scrapearNotificacionesSRI, parsearPaginaNotificaciones };

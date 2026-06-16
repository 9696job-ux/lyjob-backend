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
      '--single-process',
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

    // Ir al portal del SRI
    console.log(`    → Navegando al portal SRI...`);
    await page.goto(`${BASE_URL}/sri-en-linea/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000)); // dar tiempo al JS de la SPA

    // Hacer clic en "Iniciar sesión" o navegar al login
    console.log(`    → Esperando form de login...`);
    // Selector universal para el form de login del SRI (portal clásico o Keycloak)
    const LOGIN_SELECTOR = 'input[name="username"], #username, input[name="identificacion"], #identificacion';
    const PASS_SELECTOR  = 'input[name="password"], #password, input[name="clave"], #clave, input[type="password"]';
    const BTN_SELECTOR   = 'button[type="submit"], input[type="submit"], #kc-login, .pf-c-button[type="submit"]';

    let formFound = false;
    try {
      await page.waitForSelector(LOGIN_SELECTOR, { timeout: 10000 });
      formFound = true;
    } catch(e) {
      // La SPA puede necesitar tiempo para cargar el form de login
      // Buscar y hacer clic en el botón "Iniciar sesión"
      try {
        const loginBtn = await page.$('a[href*="login"], button:has-text("Iniciar"), .iniciar-sesion');
        if (loginBtn) {
          await loginBtn.click();
          await page.waitForSelector(LOGIN_SELECTOR, { timeout: 10000 });
          formFound = true;
        }
      } catch(e2) {}
    }

    if (!formFound) {
      // Último recurso: ir directamente a Keycloak con los parámetros del SRI
      const kcUrl = `${BASE_URL}/auth/realms/Internet/protocol/openid-connect/auth` +
        `?client_id=app-portal-internet` +
        `&redirect_uri=${encodeURIComponent(BASE_URL + '/sri-en-linea/')}` +
        `&response_type=code&scope=openid&prompt=login`;
      await page.goto(kcUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector(LOGIN_SELECTOR, { timeout: 15000 });
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
    // Esperar un poco más para asegurar que la sesión se establece
    await new Promise(r => setTimeout(r, 2000));

    // Verificar login exitoso
    const currentUrl = page.url();
    const pageContent = await page.content();
    
    if (pageContent.includes('Clave incorrecta') || pageContent.includes('Invalid credentials') || pageContent.includes('nombre de usuario incorrecto')) {
      return { ok: false, error: 'Credenciales SRI incorrectas', superior: [], inferior: [] };
    }

    console.log(`    ✅ Login exitoso, URL: ${currentUrl.substring(0, 80)}`);

    // Navegar a Documentos notificados electrónicamente
    console.log(`    → Navegando a documentos notificados...`);
    await page.goto(NOTIF_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000)); // esperar que JSF cargue la tabla

    // Esperar que cargue la tabla
    try {
      await page.waitForSelector('table', { timeout: 20000 });
    } catch(e) {
      console.log(`    ⚠️  Tabla no encontrada, esperando más...`);
      await new Promise(r => setTimeout(r, 5000));
    }

    const html = await page.content();
    
    if (html.includes('Iniciar sesi') || html.includes('kc-form-login')) {
      return { ok: false, error: 'Sesión perdida al navegar a notificaciones', superior: [], inferior: [] };
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

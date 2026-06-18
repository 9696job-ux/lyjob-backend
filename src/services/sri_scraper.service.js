/**
 * Scraper real del SRI con Puppeteer (headless Chromium)
 * El SRI usa SPA Angular + Keycloak — requiere browser real para el login
 */

const puppeteer = require('puppeteer-core');
const chromiumPkg = require('@sparticuz/chromium');
const chromium = chromiumPkg.default || chromiumPkg;

const BASE_URL  = 'https://srienlinea.sri.gob.ec';
// URL exacta capturada del browser real del SRI (encoding latin1, & al inicio)
const NOTIF_URL = `${BASE_URL}/gestion-documentos-internet/pages/materializacion.xhtml` +
  `?&contextoMPT=${BASE_URL}/tuportal-internet` +
  `&pathMPT=Tr%E1mites%20y%20Notificaciones%20%2F%20Notificaciones` +
  `&actualMPT=Documentos%20notificados%20electr%F3nicamente%20` +
  `&linkMPT=%2Fgestion-documentos-internet%2Fpages%2Fmaterializacion.xhtml%3F` +
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
    // Selectores exactos del form de Keycloak del SRI (verificados via diagnóstico):
    // - Input RUC: input[name="usuario"] (id="usuario") — NO "username"
    // - Input Clave: input[name="password"] (id="password")
    // - Botón Submit: input#kc-login (type="submit")
    const LOGIN_SELECTOR = '#usuario, input[name="usuario"], input[name="username"], #username';
    const PASS_SELECTOR  = '#password, input[name="password"], input[type="password"]';
    const BTN_SELECTOR   = '#kc-login, input[type="submit"], button[type="submit"]';

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
      await page.waitForSelector(LOGIN_SELECTOR, { timeout: 30000 });
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

    // El portal JSF del SRI tiene su propio sistema de login separado del Angular SPA.
    // Hacemos login también en el portal JSF/clásico usando la misma URL de login de Keycloak
    // pero con el client_id del portal JSF: tuportal-internet
    console.log(`    → Haciendo login en portal JSF clásico del SRI...`);
    // Sin prompt=login para usar la sesión SSO de Keycloak ya establecida
    const kcUrlJSF = `${BASE_URL}/auth/realms/Internet/protocol/openid-connect/auth` +
      `?client_id=app-tuportal-internet` +
      `&redirect_uri=${encodeURIComponent(BASE_URL + '/tuportal-internet/')}` +
      `&response_type=code&scope=openid`;
    
    await page.goto(kcUrlJSF, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));
    
    // Verificar si nos pide login de nuevo (selectores reales del SRI: #usuario, #password, #kc-login)
    const jsfLoginHtml = await page.content();
    const jsfLoginUrl = page.url();
    console.log(`    → JSF login URL: ${jsfLoginUrl.substring(0,80)}`);
    
    if (jsfLoginHtml.includes('id="usuario"') || jsfLoginHtml.includes('name="usuario"')) {
      // Necesita login manual con los selectores exactos del SRI
      console.log(`    → Ingresando credenciales en portal JSF...`);
      const u2 = await page.$('#usuario, input[name="usuario"]');
      const p2 = await page.$('#password, input[type="password"]');
      const b2 = await page.$('#kc-login, input[type="submit"]');
      if (u2) await u2.type(ruc, { delay: 25 });
      if (p2) await p2.type(clave, { delay: 25 });
      if (b2) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {}),
          b2.click()
        ]);
        await new Promise(r => setTimeout(r, 5000));
      }
    } else {
      // Keycloak auto-loggeó via SSO — esperar redirect
      await new Promise(r => setTimeout(r, 5000));
    }
    
    const jsfPortalUrl = page.url();
    console.log(`    → Portal JSF URL final: ${jsfPortalUrl.substring(0,80)}`);

    // PASO 4: Flujo real del SRI para acceder a Documentos Notificados Electrónicamente
    // Cuando el usuario hace clic en ese menú, el portal hace:
    //   1. accederAplicacion.jspa?redireccion=142&idGrupo=139  → establece sesión JSF
    //   2. materializacion.xhtml?&contextoMPT=...               → carga la tabla
    console.log(`    → Accediendo a aplicación de notificaciones (redireccion=142)...`);
    try {
      const ACCEDER_URL = `${BASE_URL}/tuportal-internet/accederAplicacion.jspa?redireccion=142&idGrupo=139`;
      await page.goto(ACCEDER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
      console.log(`    → accederAplicacion URL: ${page.url().substring(0, 80)}`);
      
      console.log(`    → Navegando a documentos notificados...`);
      await page.goto(NOTIF_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise(r => setTimeout(r, 8000));
    } catch(e) {
      console.log(`    → Error: ${e.message.substring(0,60)}, fallback directo...`);
      await page.goto(NOTIF_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise(r => setTimeout(r, 8000));
    }

    // Esperar que cargue la tabla
    try {
      await page.waitForSelector('table', { timeout: 20000 });
    } catch(e) {
      console.log(`    ⚠️  Tabla no encontrada, esperando más...`);
      await new Promise(r => setTimeout(r, 5000));
    }

    const html = await page.content();
    
    // Verificar sesión: si hay form de login real (no solo el texto del menú del portal)
    // Debug detallado de la página de notificaciones
    const hayFormLogin = html.includes('kc-form-login') || (html.includes('id="password"') && html.includes('id="usuario"'));
    const notifUrl2 = page.url();
    console.log(`    → NOTIF page URL: ${notifUrl2.substring(0,100)}`);
    console.log(`    → HTML size: ${html.length} chars, hasFormLogin: ${hayFormLogin}`);
    console.log(`    → HTML text: ${html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').substring(0,300)}`);
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

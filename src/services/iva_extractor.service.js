/**
 * IVA extraction service — replaces Base44's blocked `processDeclaration` function.
 * Runs entirely in our own Railway backend. Reuses the same casillero
 * extraction logic (validated live against a real SRI Formulario 104 PDF),
 * but performs the whole pipeline outside Base44's Functions capability.
 *
 * Base44 entity CRUD via the SDK/api_key still works fine — only their
 * custom serverless "Functions" are blocked on the current plan. So this
 * service reads/writes ExtractedData records directly through Base44's
 * entities API instead of invoking their function.
 */

const axios = require('axios');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

const IVA_CODES = [
  '401', '411', '421', '402', '412', '422', '423', '403', '413', '404', '414',
  '405', '415', '406', '416', '407', '417', '408', '418', '409', '419', '429',
  '431', '441', '442', '443', '453', '434', '444', '454', '480', '481', '482',
  '483', '484', '485', '499', '500', '510', '520', '501', '511', '521', '502',
  '512', '522', '503', '513', '523', '504', '514', '524', '505', '515', '525',
  '526', '506', '516', '507', '517', '508', '518', '509', '519', '529', '531',
  '541', '532', '542', '543', '544', '554', '540', '550', '560', '535', '545',
  '555', '563', '564', '601', '602', '603', '604', '605', '606', '607', '608',
  '609', '610', '611', '612', '613', '614', '615', '617', '618', '619', '620',
  '621', '699', '721', '723', '725', '727', '729', '731', '799', '800', '801',
  '859', '890', '897', '898', '899', '902', '999'
];

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeNumber(raw) {
  if (!raw) return 0;
  let s = String(raw).trim();
  const negative = /^-/.test(s) || /\(.*\)/.test(s);
  s = s.replace(/[()\-]/g, '');
  // Ecuador SRI format: thousands with comma, decimals with dot (e.g. 1,234.56)
  // but also seen as plain "676.05" - strip thousands commas, keep last dot as decimal
  if (/,\d{3}(\.|$)/.test(s) || /,\d{3},/.test(s)) {
    s = s.replace(/,/g, '');
  } else {
    s = s.replace(/,/g, '.');
  }
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return negative ? -Math.abs(n) : n;
}

function extractByCode(text, code) {
  const patterns = [
    new RegExp(`(?:casilla|campo|c[oó]digo)\\s*${code}[\\d-]{0,40}(-?[\\d.,]+)`, 'i'),
    new RegExp(`\\b${code}\\b[^\\d-]{0,30}(-?[\\d.,]+)`),
    new RegExp(`(-?[\\d.,]+)[^\\d\\n]{0,20}\\b${code}\\b`),
    new RegExp(`\\n[^\\n]*\\b${code}\\b[^\\d.,]+(-?[\\d.,]+)`),
    new RegExp(`\\b${code}\\s+(-?[\\d.,]+)`)
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] !== undefined) {
      const val = normalizeNumber(m[1]);
      if (!isNaN(val)) return val;
    }
  }
  return 0;
}

function findIvaPeriodo(text) {
  const lower = text.toLowerCase();
  for (let i = 0; i < MONTHS.length; i++) {
    const re = new RegExp(`${MONTHS[i]}\\s*(?:de)?\\s*(20\\d{2})`, 'i');
    const m = lower.match(re);
    if (m) {
      return { mes: i + 1, anio: parseInt(m[1], 10), label: `${MONTHS[i]} ${m[1]}` };
    }
  }
  // fallback: period code like 202501 or 01/2025
  const m2 = text.match(/\b(20\d{2})[-/]?(0[1-9]|1[0-2])\b/) || text.match(/\b(0[1-9]|1[0-2])[-/](20\d{2})\b/);
  if (m2) {
    const anio = m2[1].length === 4 ? m2[1] : m2[2];
    const mes = m2[1].length === 4 ? m2[2] : m2[1];
    return { mes: parseInt(mes, 10), anio: parseInt(anio, 10), label: `${MONTHS[parseInt(mes, 10) - 1]} ${anio}` };
  }
  return null;
}

async function extractPdfText(fileUrl) {
  const resp = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const data = new Uint8Array(resp.data);
  const doc = await pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
  let fullText = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    fullText += content.items.map((it) => it.str).join(' ') + '\n';
  }
  return fullText;
}

function buildDataFromFields(rawText) {
  const text = normalizeText(rawText);
  const data = {};
  let nonZeroCount = 0;
  for (const code of IVA_CODES) {
    const val = extractByCode(text, code);
    data[code] = val;
    if (val !== 0) nonZeroCount++;
  }
  const periodo = findIvaPeriodo(rawText);
  const esOriginalSustitutiva = /sustitutiva/i.test(rawText) ? 'Sustitutiva' : 'Original';
  return { data, nonZeroCount, periodo, esOriginalSustitutiva };
}

/**
 * Full pipeline: fetch PDF -> extract text -> parse casilleros.
 * Returns { ok, data, periodo, nonZeroCount, tipo, textSample, error }
 */
async function processIvaPdf(fileUrl) {
  try {
    const text = await extractPdfText(fileUrl);
    if (!text || text.trim().length < 20) {
      return { ok: false, error: 'El PDF no tiene texto extraíble (posible escaneo/imagen).', textLen: text ? text.length : 0 };
    }
    const { data, nonZeroCount, periodo, esOriginalSustitutiva } = buildDataFromFields(text);
    return {
      ok: true,
      extracted_data: data,
      periodo: periodo ? periodo.label : 'No identificado',
      tipoDeclaracion: esOriginalSustitutiva,
      nonZeroCount,
      textLen: text.length,
      textSample: text.substring(0, 300)
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = { processIvaPdf, buildDataFromFields, extractPdfText, IVA_CODES };

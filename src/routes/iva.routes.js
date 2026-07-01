const express = require('express');
const router = express.Router();
const { processIvaPdf } = require('../services/iva_extractor.service');
const { getExtractedData, listPendingExtractedData, updateExtractedData } = require('../services/base44_client.service');

// Simple shared-secret guard (same pattern used by the other manual-trigger endpoints in this repo)
function checkSecret(req, res, next) {
  const secret = req.headers['x-iva-secret'] || req.query.secret;
  if (secret !== (process.env.IVA_PROCESS_SECRET || 'lyjob_iva_2026')) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  next();
}

// Process one specific ExtractedData record by id (reads file_url from Base44, extracts, writes result back to Base44)
router.post('/process/:id', checkSecret, async (req, res) => {
  const { id } = req.params;
  try {
    const record = await getExtractedData(id);
    if (!record || !record.file_url) {
      return res.status(404).json({ ok: false, error: 'record not found or missing file_url' });
    }
    const result = await processIvaPdf(record.file_url);
    if (!result.ok) {
      await updateExtractedData(id, { status: 'error', observaciones: result.error || 'Error desconocido en extracción' });
      return res.json({ ok: false, id, error: result.error });
    }
    await updateExtractedData(id, {
      status: 'completed',
      periodo: result.periodo,
      extracted_data: result.extracted_data,
      observaciones: `Tipo: ${result.tipoDeclaracion}. Casilleros con valor: ${result.nonZeroCount}/117.`
    });
    return res.json({ ok: true, id, periodo: result.periodo, nonZeroCount: result.nonZeroCount });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// Find every ExtractedData record stuck in status=processing and process them all, sequentially.
router.post('/process-pending', checkSecret, async (req, res) => {
  const pending = await listPendingExtractedData(200);
  if (pending && pending.error) {
    return res.status(500).json({ ok: false, error: 'list failed: ' + pending.error });
  }
  const results = [];
  for (const rec of pending) {
    try {
      if (!rec.file_url) { results.push({ id: rec.id, ok: false, error: 'no file_url' }); continue; }
      const result = await processIvaPdf(rec.file_url);
      if (!result.ok) {
        await updateExtractedData(rec.id, { status: 'error', observaciones: result.error || 'Error en extracción' });
        results.push({ id: rec.id, ok: false, error: result.error });
      } else {
        await updateExtractedData(rec.id, {
          status: 'completed',
          periodo: result.periodo,
          extracted_data: result.extracted_data,
          observaciones: `Tipo: ${result.tipoDeclaracion}. Casilleros con valor: ${result.nonZeroCount}/117.`
        });
        results.push({ id: rec.id, ok: true, periodo: result.periodo, nonZeroCount: result.nonZeroCount });
      }
    } catch (err) {
      results.push({ id: rec.id, ok: false, error: err.message || String(err) });
    }
  }
  res.json({ ok: true, total: pending.length, results });
});

// Diagnostic: just extract and return the parsed data WITHOUT writing anything back (for testing/verification)
router.post('/dry-run', checkSecret, async (req, res) => {
  const { file_url } = req.body;
  if (!file_url) return res.status(400).json({ ok: false, error: 'file_url required' });
  const result = await processIvaPdf(file_url);
  res.json(result);
});

module.exports = router;

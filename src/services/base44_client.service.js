/**
 * Minimal Base44 entities client. Base44's custom serverless "Functions"
 * are blocked on this workspace's plan, but entity CRUD via the SDK/api_key
 * still works — this is how we read pending ExtractedData records and
 * write the extraction results back, entirely from our own backend.
 */

const BASE44_APP_ID = process.env.BASE44_APP_ID || '692b5deb8859727ee371ea22';
const BASE44_API_KEY = process.env.BASE44_API_KEY || 'de49b4bcf17c4dc08b7cbbd714ab48fb';

let sdkClientPromise = null;

async function getClient() {
  if (!sdkClientPromise) {
    sdkClientPromise = (async () => {
      const { createClient } = await import('@base44/sdk');
      return createClient({
        appId: BASE44_APP_ID,
        headers: { api_key: BASE44_API_KEY }
      });
    })();
  }
  return sdkClientPromise;
}

async function getExtractedData(recordId) {
  const b44 = await getClient();
  return b44.entities.ExtractedData.get(recordId);
}

async function listPendingExtractedData(limit = 50) {
  const b44 = await getClient();
  try {
    const rows = await b44.entities.ExtractedData.filter({ status: 'processing' }, '-created_date', limit);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

async function updateExtractedData(recordId, patch) {
  const b44 = await getClient();
  return b44.entities.ExtractedData.update(recordId, patch);
}

module.exports = { getClient, getExtractedData, listPendingExtractedData, updateExtractedData };

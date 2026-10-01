import { timingSafeEqual } from 'node:crypto';
import { assistantInstructions } from '../lib/assistant-instructions.mjs';

const MAX_SDP_BYTES = 128_000;

function json(response, status, payload) {
  response.status(status).setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  return response.json(payload);
}

function sameSecret(candidate, expected) {
  if (typeof candidate !== 'string' || !expected) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isAllowedOrigin(request) {
  let origin;
  try { origin = new URL(request.headers.origin || ''); } catch { return false; }
  const productionHosts = new Set([
    'promoters-openai-poc.vercel.app',
    process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL
  ].filter(Boolean).map(value => value.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase()));
  if (process.env.NODE_ENV === 'production') return origin.protocol === 'https:' && productionHosts.has(origin.hostname.toLowerCase());
  const requestHost = String(request.headers.host || '').split(':')[0].toLowerCase();
  return origin.hostname.toLowerCase() === requestHost;
}

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return json(response, 405, { error: 'Επιτρέπεται μόνο POST.' });
  }
  if (!isAllowedOrigin(request)) return json(response, 403, { error: 'Το αίτημα πρέπει να ξεκινήσει από τη σελίδα της δοκιμής.' });
  if (!sameSecret(request.headers['x-poc-access-code'], process.env.POC_ACCESS_CODE)) return json(response, 401, { error: 'Ο κωδικός δοκιμής δεν είναι σωστός.' });
  if (!process.env.OPENAI_API_KEY) return json(response, 503, { error: 'Το OpenAI project key δεν έχει ρυθμιστεί στο Vercel.' });
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/sdp')) return json(response, 415, { error: 'Αναμενόταν SDP προσφορά WebRTC.' });

  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_SDP_BYTES) return json(response, 413, { error: 'Το αίτημα είναι μεγαλύτερο από το επιτρεπόμενο όριο.' });
      chunks.push(chunk);
    }
    const sdp = Buffer.concat(chunks).toString('utf8');
    const upstream = await fetch('https://api.openai.com/v1/live/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          model: 'gpt-live-1',
          instructions: assistantInstructions,
          delegation: { type: 'client' },
          audio: { output: { voice: 'marin' } }
        },
        transport: { type: 'webrtc', sdp }
      }),
      signal: AbortSignal.timeout(45_000)
    });
    const body = await upstream.text();
    if (!upstream.ok) {
      let message = 'Το OpenAI GPT-Live API δεν δημιούργησε συνεδρία.';
      try { message = JSON.parse(body).error?.message || message; } catch {}
      return json(response, upstream.status, { error: message });
    }

    let session;
    try { session = JSON.parse(body); } catch {
      console.error('[api/live-session] Expected a JSON session response', { status: upstream.status, contentType: upstream.headers.get('content-type') });
      return json(response, 502, { error: 'Το GPT-Live επέστρεψε μη αναμενόμενη απάντηση. Δεν ξεκίνησε η συνεδρία· έλεγξε το deployment και ξαναδοκίμασε.' });
    }
    if (!session?.session?.id || !session?.transport?.sdp) {
      console.error('[api/live-session] Incomplete GPT-Live session response', { status: upstream.status, hasSession: Boolean(session?.session?.id), hasSdp: Boolean(session?.transport?.sdp) });
      return json(response, 502, { error: 'Η απάντηση του GPT-Live δεν περιείχε τα στοιχεία σύνδεσης WebRTC.' });
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return response.status(201).json(session);
  } catch (error) {
    console.error('[api/live-session] Session creation failed', { name: error?.name || 'Error', message: error?.message || String(error) });
    const message = error.name === 'TimeoutError' ? 'Έληξε το χρονικό όριο σύνδεσης GPT-Live.' : 'Αποτυχία δημιουργίας συνεδρίας GPT-Live. Έλεγξε τη σύνδεση και ξαναδοκίμασε.';
    return json(response, 502, { error: message });
  }
}

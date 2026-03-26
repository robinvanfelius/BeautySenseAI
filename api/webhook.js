// Stripe Webhook — handmatige signature verificatie via Node.js crypto
const crypto = require('crypto');

// Raw body lezen (Vercel levert de stream onbewerkt voor niet-JSON routes)
const getRawBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

// Stripe signature verificatie zonder npm pakket
function verifyStripeSignature(rawBody, header, secret) {
  if (!header) return false;

  const parts     = header.split(',');
  const timestamp = (parts.find(p => p.startsWith('t=')) || '').slice(2);
  const signatures = parts
    .filter(p => p.startsWith('v1='))
    .map(p => p.slice(3));

  if (!timestamp || signatures.length === 0) return false;

  const payload     = `${timestamp}.${rawBody}`;
  const expected    = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  return signatures.some(sig =>
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL          = process.env.SUPABASE_URL;
  const SUPABASE_SVCKEY       = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ── Raw body + signature check ───────────────────────────
  const rawBody = await getRawBody(req);
  const sig     = req.headers['stripe-signature'];

  if (STRIPE_WEBHOOK_SECRET) {
    const valid = verifyStripeSignature(rawBody.toString(), sig, STRIPE_WEBHOOK_SECRET);
    if (!valid) {
      console.error('[webhook] Ongeldige signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } else {
    console.warn('[webhook] STRIPE_WEBHOOK_SECRET niet ingesteld — signature check overgeslagen');
  }

  // ── Event parsen ─────────────────────────────────────────
  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  console.log('[webhook] event:', event.type);

  // ── checkout.session.completed → upgrade naar premium ────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId  = session.metadata?.user_id;
    console.log('[webhook] checkout completed, user_id:', userId);

    if (userId) await setUserPremium(userId, true, SUPABASE_URL, SUPABASE_SVCKEY);
  }

  // ── Abonnement beëindigd → terug naar gratis ─────────────
  if (
    event.type === 'customer.subscription.deleted' ||
    event.type === 'customer.subscription.paused'
  ) {
    const sub    = event.data.object;
    const userId = sub.metadata?.user_id;
    console.log('[webhook] subscription ended, user_id:', userId);

    if (userId) await setUserPremium(userId, false, SUPABASE_URL, SUPABASE_SVCKEY);
  }

  return res.status(200).json({ received: true });
};

// ── Supabase premium update (service role = bypass RLS) ───
async function setUserPremium(userId, isPremium, supabaseUrl, serviceKey) {
  if (!supabaseUrl || !serviceKey) {
    console.warn('[webhook] Supabase service key ontbreekt — premium update overgeslagen');
    return;
  }

  const r = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'apikey':        serviceKey,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify({ user_id: userId, is_premium: isPremium }),
  });

  console.log('[webhook] Supabase update status:', r.status, 'premium:', isPremium);
}

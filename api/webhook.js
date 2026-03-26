const Stripe = require('stripe');

// Vercel levert de raw body als Buffer via req body-reader
const getRawBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe          = Stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret   = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL    = process.env.SUPABASE_URL;
  const SUPABASE_SVCKEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ── Stripe signature verificatie ────────────────────────
  const sig     = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ── Events verwerken ────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId  = session.metadata?.user_id;

    if (userId && SUPABASE_URL && SUPABASE_SVCKEY) {
      await setUserPremium(userId, true, SUPABASE_URL, SUPABASE_SVCKEY);
    }
  }

  // Abonnement geannuleerd / verlopen → terug naar gratis
  if (
    event.type === 'customer.subscription.deleted' ||
    event.type === 'customer.subscription.paused'
  ) {
    const subscription = event.data.object;
    const userId = subscription.metadata?.user_id;

    if (userId && SUPABASE_URL && SUPABASE_SVCKEY) {
      await setUserPremium(userId, false, SUPABASE_URL, SUPABASE_SVCKEY);
    }
  }

  return res.status(200).json({ received: true });
};

// ── Supabase premium toggle (service role = bypass RLS) ──
async function setUserPremium(userId, isPremium, supabaseUrl, serviceKey) {
  await fetch(`${supabaseUrl}/rest/v1/profiles`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'apikey':        serviceKey,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify({ user_id: userId, is_premium: isPremium }),
  });
}

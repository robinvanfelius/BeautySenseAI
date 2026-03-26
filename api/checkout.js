// Stripe Checkout via REST API — geen npm pakket nodig
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
  const STRIPE_KEY    = process.env.STRIPE_SECRET_KEY;
  const PRICE_ID      = process.env.STRIPE_PRICE_ID;

  // ── Env check ────────────────────────────────────────────
  console.log('[checkout] env:', {
    hasStripeKey:    !!STRIPE_KEY,
    stripeKeyPrefix: STRIPE_KEY?.slice(0, 8),
    hasPriceId:      !!PRICE_ID,
    priceIdPrefix:   PRICE_ID?.slice(0, 6),
  });

  if (!STRIPE_KEY) return res.status(500).json({ error: 'STRIPE_SECRET_KEY ontbreekt in Vercel env' });
  if (!PRICE_ID)   return res.status(500).json({ error: 'STRIPE_PRICE_ID ontbreekt in Vercel env' });

  // ── Auth check ───────────────────────────────────────────
  const jwt = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!jwt) return res.status(401).json({ error: 'not_authenticated' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${jwt}`, 'apikey': SUPABASE_ANON }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'invalid_token' });
  const user = await userRes.json();
  console.log('[checkout] user:', user.id, user.email);

  // ── Stripe Checkout Session via REST ─────────────────────
  const origin = req.headers.origin || `https://${req.headers.host}`;

  const params = new URLSearchParams({
    mode:                              'subscription',
    'payment_method_types[]':          'card',
    customer_email:                     user.email,
    'metadata[user_id]':               user.id,
    'line_items[0][price]':            PRICE_ID,
    'line_items[0][quantity]':         '1',
    'subscription_data[metadata][user_id]': user.id,
    success_url: `${origin}?upgraded=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${origin}?cancelled=true`,
  });

  console.log('[checkout] calling Stripe API...');

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_KEY}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await stripeRes.json();
  console.log('[checkout] Stripe status:', stripeRes.status, data.error?.message || 'OK');

  if (!stripeRes.ok) {
    return res.status(stripeRes.status).json({
      error:   data.error?.type    || 'stripe_error',
      message: data.error?.message || 'Stripe fout',
    });
  }

  return res.status(200).json({ url: data.url });
};

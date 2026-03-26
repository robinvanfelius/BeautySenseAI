const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // ── Env check ────────────────────────────────────────────
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
  const STRIPE_KEY    = process.env.STRIPE_SECRET_KEY;
  const PRICE_ID      = process.env.STRIPE_PRICE_ID;

  console.log('[checkout] env check:', {
    hasSupabaseUrl:  !!SUPABASE_URL,
    hasSupabaseAnon: !!SUPABASE_ANON,
    hasStripeKey:    !!STRIPE_KEY,
    stripeKeyPrefix: STRIPE_KEY?.slice(0, 7),   // sk_test of sk_live
    hasPriceId:      !!PRICE_ID,
    priceIdPrefix:   PRICE_ID?.slice(0, 6),     // price_
  });

  if (!STRIPE_KEY) return res.status(500).json({ error: 'STRIPE_SECRET_KEY ontbreekt' });
  if (!PRICE_ID)   return res.status(500).json({ error: 'STRIPE_PRICE_ID ontbreekt' });

  const stripe = Stripe(STRIPE_KEY);

  // ── Auth check ──────────────────────────────────────────
  const jwt = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!jwt) return res.status(401).json({ error: 'not_authenticated' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${jwt}`, 'apikey': SUPABASE_ANON }
  });

  console.log('[checkout] supabase auth status:', userRes.status);
  if (!userRes.ok) return res.status(401).json({ error: 'invalid_token' });

  const user = await userRes.json();
  console.log('[checkout] user:', user.id, user.email);

  // ── Stripe Checkout Session ──────────────────────────────
  const origin = req.headers.origin || `https://${req.headers.host}`;
  console.log('[checkout] origin:', origin);

  try {
    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      customer_email:       user.email,
      metadata:             { user_id: user.id },
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: `${origin}?upgraded=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}?cancelled=true`,
      subscription_data: { metadata: { user_id: user.id } },
    });

    console.log('[checkout] session created:', session.id);
    return res.status(200).json({ url: session.url });

  } catch (stripeErr) {
    console.error('[checkout] Stripe error:', stripeErr.type, stripeErr.message);
    return res.status(500).json({
      error:   stripeErr.type,
      message: stripeErr.message,
    });
  }
};

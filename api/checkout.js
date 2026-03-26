const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
  const stripe        = Stripe(process.env.STRIPE_SECRET_KEY);

  // ── Auth check ──────────────────────────────────────────
  const jwt = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!jwt) return res.status(401).json({ error: 'not_authenticated' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${jwt}`, 'apikey': SUPABASE_ANON }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'invalid_token' });

  const user = await userRes.json();

  // ── Create Stripe Checkout Session ──────────────────────
  const origin = req.headers.origin || `https://${req.headers.host}`;

  const session = await stripe.checkout.sessions.create({
    mode:                 'subscription',
    payment_method_types: ['card'],
    customer_email:       user.email,
    metadata:             { user_id: user.id },
    line_items: [{
      price:    process.env.STRIPE_PRICE_ID,
      quantity: 1,
    }],
    success_url: `${origin}?upgraded=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${origin}?cancelled=true`,
    subscription_data: {
      metadata: { user_id: user.id },
    },
  });

  return res.status(200).json({ url: session.url });
};

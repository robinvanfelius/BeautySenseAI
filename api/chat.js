const FREE_LIMIT = 5;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  // ── Auth ─────────────────────────────────────────────────
  const jwt = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!jwt) {
    return res.status(401).json({ error: 'not_authenticated' });
  }

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${jwt}`, 'apikey': SUPABASE_ANON }
  });
  if (!userRes.ok) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const user   = await userRes.json();
  const userId = user.id;

  // ── Premium check ────────────────────────────────────────
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=is_premium`,
    { headers: { 'Authorization': `Bearer ${jwt}`, 'apikey': SUPABASE_ANON } }
  );
  const profiles  = profileRes.ok ? await profileRes.json() : [];
  const isPremium = profiles[0]?.is_premium || false;

  // ── Usage check (free users only) ───────────────────────
  if (!isPremium) {
    const today = new Date().toISOString().split('T')[0];
    const usageRes = await fetch(
      `${SUPABASE_URL}/rest/v1/questions?user_id=eq.${userId}&created_at=gte.${today}T00:00:00&select=id`,
      { headers: { 'Authorization': `Bearer ${jwt}`, 'apikey': SUPABASE_ANON } }
    );
    const used  = usageRes.ok ? await usageRes.json() : [];
    const count = Array.isArray(used) ? used.length : 0;

    if (count >= FREE_LIMIT) {
      return res.status(429).json({
        error: 'limit_reached',
        used:  count,
        limit: FREE_LIMIT
      });
    }

    // Record this question
    await fetch(`${SUPABASE_URL}/rest/v1/questions`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'apikey':        SUPABASE_ANON,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ user_id: userId })
    });
  }

  // ── Anthropic API ────────────────────────────────────────
  const { model, max_tokens, system, messages } = req.body;

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens, system, messages }),
  });

  const data = await anthropicRes.json();
  if (!anthropicRes.ok) return res.status(anthropicRes.status).json(data);
  return res.status(200).json(data);
};

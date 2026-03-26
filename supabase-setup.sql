-- ================================================
-- BeautySense.AI — Supabase database setup
-- Voer dit uit in de Supabase SQL editor
-- ================================================

-- 1. Profielen (premium status)
CREATE TABLE IF NOT EXISTS profiles (
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Eigen profiel lezen"    ON profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Eigen profiel updaten"  ON profiles FOR UPDATE USING (auth.uid() = user_id);

-- 2. Vragen log (voor dagelijkse limiet)
CREATE TABLE IF NOT EXISTS questions (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Eigen vragen lezen"     ON questions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Eigen vragen toevoegen" ON questions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 3. Automatisch profiel aanmaken bij registratie
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

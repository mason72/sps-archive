-- 004: User profiles for account branding & settings
-- Stores photographer metadata that persists across events

CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  business_name TEXT,
  bio TEXT,
  logo_url TEXT,
  website TEXT,
  phone TEXT,
  location TEXT,
  branding JSONB NOT NULL DEFAULT '{}',
  gallery_defaults JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Branding JSONB shape:
-- {
--   "primaryColor": "#1C1917",
--   "secondaryColor": "#78716C",
--   "accentColor": "#10B981",
--   "backgroundColor": "#FFFFFF",
--   "logoPlacement": "left" | "center",
--   "fontFamily": "playfair" | "inter" | ...
-- }

-- Gallery defaults JSONB shape (same as EventSettings):
-- {
--   "cover": { "layout": "center" },
--   "typography": { ... },
--   "color": { ... },
--   "grid": { ... }
-- }

-- RLS: users can only read/write their own profile
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role (Inngest, admin) has full access
CREATE POLICY "Service role full access to user_profiles"
  ON user_profiles FOR ALL
  USING (auth.role() = 'service_role');

-- Auto-create profile on user signup (via trigger)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();

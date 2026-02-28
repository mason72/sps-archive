-- ============================================================
-- SPS Prism — RLS Policies + user_id on events
-- ============================================================

-- Add user_id to events
ALTER TABLE events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);

-- ────────────────────────────────────────────
-- Events: Owner CRUD
-- ────────────────────────────────────────────
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own events"
  ON events FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create events"
  ON events FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own events"
  ON events FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own events"
  ON events FOR DELETE USING (auth.uid() = user_id);

-- ────────────────────────────────────────────
-- Images: Via event ownership
-- ────────────────────────────────────────────
ALTER TABLE images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view images of own events"
  ON images FOR SELECT
  USING (event_id IN (SELECT id FROM events WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert images to own events"
  ON images FOR INSERT
  WITH CHECK (event_id IN (SELECT id FROM events WHERE user_id = auth.uid()));

CREATE POLICY "Users can update images of own events"
  ON images FOR UPDATE
  USING (event_id IN (SELECT id FROM events WHERE user_id = auth.uid()));

-- Service role (Inngest) can also manage images
CREATE POLICY "Service role manages images"
  ON images FOR ALL
  USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────
-- Stacks: Via event ownership
-- ────────────────────────────────────────────
ALTER TABLE stacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage stacks of own events"
  ON stacks FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE user_id = auth.uid()));

CREATE POLICY "Service role manages stacks"
  ON stacks FOR ALL
  USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────
-- Sections: Via event ownership
-- ────────────────────────────────────────────
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage sections of own events"
  ON sections FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE user_id = auth.uid()));

CREATE POLICY "Service role manages sections"
  ON sections FOR ALL
  USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────
-- Section images: Via section ownership
-- ────────────────────────────────────────────
ALTER TABLE section_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage section_images"
  ON section_images FOR ALL
  USING (section_id IN (
    SELECT id FROM sections WHERE event_id IN (
      SELECT id FROM events WHERE user_id = auth.uid()
    )
  ));

CREATE POLICY "Service role manages section_images"
  ON section_images FOR ALL
  USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────
-- Shares: Owner CRUD + public read for active
-- ────────────────────────────────────────────
ALTER TABLE shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage shares of own events"
  ON shares FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE user_id = auth.uid()));

CREATE POLICY "Anyone can read active shares"
  ON shares FOR SELECT
  USING (is_active = true);

-- ────────────────────────────────────────────
-- Favorites: Public insert on active shares, owner read
-- ────────────────────────────────────────────
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can add favorites on active shares"
  ON favorites FOR INSERT
  WITH CHECK (share_id IN (SELECT id FROM shares WHERE is_active = true AND allow_favorites = true));

CREATE POLICY "Anyone can view favorites"
  ON favorites FOR SELECT
  USING (true);

CREATE POLICY "Anyone can delete own favorites"
  ON favorites FOR DELETE
  USING (true);

-- ────────────────────────────────────────────
-- Faces + Persons: Via event ownership
-- ────────────────────────────────────────────
ALTER TABLE faces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view faces of own events"
  ON faces FOR ALL
  USING (image_id IN (
    SELECT id FROM images WHERE event_id IN (
      SELECT id FROM events WHERE user_id = auth.uid()
    )
  ));

CREATE POLICY "Service role manages faces"
  ON faces FOR ALL
  USING (auth.role() = 'service_role');

ALTER TABLE persons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view persons of own events"
  ON persons FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE user_id = auth.uid()));

CREATE POLICY "Service role manages persons"
  ON persons FOR ALL
  USING (auth.role() = 'service_role');

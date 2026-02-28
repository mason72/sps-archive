-- ============================================================
-- Event Templates — Save and reuse event configurations
-- ============================================================

CREATE TABLE IF NOT EXISTS event_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  event_type TEXT,
  settings JSONB DEFAULT '{}',
  sections JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE event_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own templates" ON event_templates
  FOR ALL USING (user_id = auth.uid());

COMMENT ON TABLE event_templates IS 'Saved event configurations for quick creation';

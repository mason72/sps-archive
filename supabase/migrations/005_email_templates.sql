-- 005: Email templates & send history
-- Stores reusable email templates per photographer and logs sends

CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE email_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
  recipients JSONB NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own templates"
  ON email_templates FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to email_templates"
  ON email_templates FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users can view own sends"
  ON email_sends FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sends"
  ON email_sends FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to email_sends"
  ON email_sends FOR ALL
  USING (auth.role() = 'service_role');

-- Index for fast lookups
CREATE INDEX idx_email_templates_user ON email_templates(user_id);
CREATE INDEX idx_email_sends_user ON email_sends(user_id);
CREATE INDEX idx_email_sends_event ON email_sends(event_id);

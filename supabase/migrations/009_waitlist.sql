-- Waitlist table for closed beta signups
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  company TEXT,
  how_heard TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Allow anonymous inserts (public waitlist form) but no reads
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access on waitlist"
  ON waitlist FOR ALL
  USING (auth.role() = 'service_role');

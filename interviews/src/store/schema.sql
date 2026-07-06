PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pseudonym TEXT NOT NULL UNIQUE,
  profile TEXT NOT NULL CHECK (profile IN ('A','B','C')),
  source TEXT NOT NULL DEFAULT '',
  screener TEXT NOT NULL DEFAULT '{}',
  linkedin_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','done','transcribed','coded','reviewed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transcripts (
  interview_id INTEGER PRIMARY KEY REFERENCES interviews(id),
  filename TEXT NOT NULL,
  raw TEXT NOT NULL,
  turns TEXT NOT NULL, -- JSON Turn[]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id INTEGER NOT NULL REFERENCES interviews(id),
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  quote TEXT NOT NULL,
  turn_ref INTEGER NOT NULL,
  confidence REAL,
  state TEXT NOT NULL DEFAULT 'ai_suggested'
    CHECK (state IN ('ai_suggested','confirmed','rejected','edited','manual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_codes_interview ON codes(interview_id);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id INTEGER NOT NULL REFERENCES interviews(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_interview ON notes(interview_id);

CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

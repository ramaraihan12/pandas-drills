-- Classes, students and what they submitted. Only hashes of secrets are stored.
-- Nothing here holds an IP address, an email, a user agent or a full name on purpose.

CREATE TABLE classes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  teacher_key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_classes_expires ON classes (expires_at);

CREATE TABLE students (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  nickname_norm TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  UNIQUE (class_id, nickname_norm)
);

CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- the report groups by (student, exercise) inside one class
CREATE INDEX idx_submissions_report ON submissions (class_id, student_id, exercise_id, created_at);
-- the per-student hourly limit
CREATE INDEX idx_submissions_student_time ON submissions (student_id, created_at);

-- how many classes were created on each UTC day (the global daily cap)
CREATE TABLE daily_counters (
  day TEXT PRIMARY KEY,
  classes_created INTEGER NOT NULL
);

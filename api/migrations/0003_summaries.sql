-- Summary rows so the teacher report never has to read every submission, a switch to close
-- joining, and counters for the site-wide daily cap and the per-class cap.

ALTER TABLE classes ADD COLUMN joining_open INTEGER NOT NULL DEFAULT 1;
ALTER TABLE classes ADD COLUMN submissions_stored INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_counters ADD COLUMN submissions INTEGER NOT NULL DEFAULT 0;

-- one row per (class, student, exercise), updated in the same batch as each submission.
-- fail_kinds is a bit mask over SUBMISSION_KINDS (bit i = kind i failed at least once), so
-- "how many students hit this kind" is a count of cells, with no extra rows.
CREATE TABLE student_exercise (
  class_id TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  first_pass_at INTEGER,
  tries_to_pass INTEGER,
  first_pass_hash TEXT,
  last_kind TEXT NOT NULL,
  last_at INTEGER NOT NULL,
  fail_kinds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (class_id, student_id, exercise_id)
) WITHOUT ROWID;

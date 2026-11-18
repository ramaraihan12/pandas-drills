-- A hash of the normalised code of each submission, so the teacher view can point at
-- students whose first passing code looks the same. Older rows keep NULL.

ALTER TABLE submissions ADD COLUMN code_hash TEXT;

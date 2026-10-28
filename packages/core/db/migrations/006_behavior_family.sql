-- Behavioral test families (MVP §9): each finding from a family records which one produced it.
-- NULL for findings from other checks (detectors, form rules, batches, traces).
ALTER TABLE findings ADD COLUMN IF NOT EXISTS family text;

-- Optional owner-declared framework/library (e.g. "next.js"), used only to fetch documentation for
-- fix briefs. Oddhound never guesses a stack from how a site looks.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS stack text NOT NULL DEFAULT '';

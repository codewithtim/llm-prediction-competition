-- Update stale Gemini model ID to current version
UPDATE `competitors`
SET `model` = 'google/gemini-2.5-flash',
    `config` = '{"model":"google/gemini-2.5-flash"}'
WHERE `id` = 'wt-gemini-flash';

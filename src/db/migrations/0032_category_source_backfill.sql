-- Provenance from the sentinel confidences the code wrote before this column:
-- 100 = the user's pick, 95 = keyword, 1 = rule; any other value on a
-- categorized row came from the LLM. NULL confidence stays unknown. Only rows
-- not yet backfilled are touched, so a re-run changes nothing.
UPDATE `transactions` SET `category_source` = CASE
    WHEN `confidence` = 100 THEN 'user'
    WHEN `confidence` = 95 THEN 'keyword'
    WHEN `confidence` = 1 THEN 'rule'
    ELSE 'llm'
  END
WHERE `category_id` IS NOT NULL
  AND `confidence` IS NOT NULL
  AND `category_source` IS NULL;

-- Carry dismissals made under the old engine (rows in `insights` with
-- `dismissed_at`) over to their keys, so they stay hidden after the upgrade.
-- `recurring_increase` keys include the latest charge, which the old rows
-- don't hold; those may show once more. Re-entrant: INSERT OR IGNORE.
INSERT OR IGNORE INTO `insight_dismissals` (`user_id`, `insight_key`, `dismissed_at`)
SELECT `user_id`, `insight_key`, max(`dismissed_at`)
FROM (
  SELECT
    `user_id`,
    `dismissed_at`,
    CASE `kind`
      WHEN 'needs_review' THEN 'needs_review'
      WHEN 'on_track' THEN 'on_track:' || strftime('%Y-%m', `created_at` / 1000, 'unixepoch')
      WHEN 'overspend' THEN 'overspend:' || `entity_id` || ':' || strftime('%Y-%m', `created_at` / 1000, 'unixepoch')
      WHEN 'low_balance' THEN 'low_balance:' || `entity_id`
      WHEN 'goal_near' THEN 'goal_near:' || `entity_id`
    END AS `insight_key`
  FROM `insights`
  WHERE `dismissed_at` IS NOT NULL
)
WHERE `insight_key` IS NOT NULL
GROUP BY `user_id`, `insight_key`;

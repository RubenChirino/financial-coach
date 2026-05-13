-- Add Bizum as a category if it doesn't already exist.
INSERT INTO categories (slug, name_es, name_en, icon, color, is_system, sort_order)
SELECT 'bizum', 'Bizum', 'Bizum', 'Smartphone', '#00b8c4', 1,
       (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories)
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'bizum');

--> statement-breakpoint

-- Add a "contains bizum" rule pointing at the new category.
INSERT INTO category_rules (match_pattern, match_type, category_id, priority)
SELECT 'bizum', 'contains', id, 5
FROM categories
WHERE slug = 'bizum'
AND NOT EXISTS (
  SELECT 1 FROM category_rules
  WHERE match_pattern = 'bizum'
  AND   match_type    = 'contains'
);

--> statement-breakpoint

-- Retro-categorize all existing uncategorized transactions that contain
-- "bizum" (case-insensitive) in merchant name or raw description.
UPDATE transactions
SET    category_id  = (SELECT id FROM categories WHERE slug = 'bizum'),
       needs_review = 0
WHERE  category_id IS NULL
AND   (lower(merchant_name)    LIKE '%bizum%'
    OR lower(raw_description)  LIKE '%bizum%');

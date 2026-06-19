-- Per-user data isolation: add an owner (`user_id`) to every table that holds
-- user data, and split per-user budgets out of the shared `categories` table.
--
-- New `user_id` columns are added with `DEFAULT 0` (NOT NULL). SQLite forbids
-- adding a NOT NULL column without a default to a populated table, and it also
-- forbids an added column carrying a REFERENCES clause with a non-NULL default
-- — so these columns have no DB-level FK (the Drizzle schema still declares the
-- relation). `0` is never a real user id, so any row not yet claimed by the
-- ownership backfill (scripts/backfill-ownership.ts) is invisible to everyone:
-- fail-safe rather than fail-open.
ALTER TABLE `requisitions` ADD `user_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `user_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `user_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `user_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_subscriptions` ADD `user_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `goals` ADD `user_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `insights` ADD `user_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `advisor_conversations` ADD `user_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `travel_city_labels` ADD `user_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `transactions_user_date_idx` ON `transactions` (`user_id`,`booking_date`);--> statement-breakpoint
CREATE INDEX `insights_user_idx` ON `insights` (`user_id`);--> statement-breakpoint
-- A trip key is unique only within a user, not globally.
DROP INDEX `travel_city_labels_trip_key_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `travel_city_labels_user_trip_uniq` ON `travel_city_labels` (`user_id`,`trip_key`);--> statement-breakpoint
-- Per-user budgets, split out of categories.budget_monthly_cents (which stays
-- as a deprecated column until the backfill migrates its values here).
CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`monthly_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_user_cat_uniq` ON `budgets` (`user_id`,`category_id`);

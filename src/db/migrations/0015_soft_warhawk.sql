ALTER TABLE `category_rules` ADD `user_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `category_rules` ADD `created_by` text DEFAULT 'system' NOT NULL;--> statement-breakpoint
CREATE INDEX `category_rules_user_idx` ON `category_rules` (`user_id`);
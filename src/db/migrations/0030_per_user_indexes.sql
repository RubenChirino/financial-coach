CREATE INDEX IF NOT EXISTS `accounts_user_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `advisor_conversations_user_updated_idx` ON `advisor_conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `goals_user_idx` ON `goals` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `import_batches_user_created_idx` ON `import_batches` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `requisitions_user_idx` ON `requisitions` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `transactions_user_review_idx` ON `transactions` (`user_id`,`needs_review`);
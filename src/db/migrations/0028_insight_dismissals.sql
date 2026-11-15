CREATE TABLE IF NOT EXISTS `insight_dismissals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`insight_key` text NOT NULL,
	`dismissed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `insight_dismissals_user_key_uniq` ON `insight_dismissals` (`user_id`,`insight_key`);
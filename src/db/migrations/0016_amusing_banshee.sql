CREATE TABLE `balance_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`balance_cents` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`captured_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `balance_history_user_captured_idx` ON `balance_history` (`user_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `balance_history_account_idx` ON `balance_history` (`account_id`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `kind` text DEFAULT 'bank' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `is_manual` integer DEFAULT false NOT NULL;
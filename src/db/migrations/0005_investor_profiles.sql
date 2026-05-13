CREATE TABLE `investor_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`age_range` text NOT NULL,
	`horizon` text NOT NULL,
	`risk_tolerance` text NOT NULL,
	`emergency_fund_months` text NOT NULL,
	`dependents` text NOT NULL,
	`primary_goal` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investor_profiles_user_id_unique` ON `investor_profiles` (`user_id`);
CREATE TABLE `city_countries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`city_key` text NOT NULL,
	`city_label` text,
	`country_code` text,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `city_countries_city_key_unique` ON `city_countries` (`city_key`);--> statement-breakpoint
ALTER TABLE `users` ADD `home_city` text;--> statement-breakpoint
ALTER TABLE `users` ADD `home_country` text;
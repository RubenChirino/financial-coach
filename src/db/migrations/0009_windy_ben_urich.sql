CREATE TABLE `travel_city_labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_key` text NOT NULL,
	`city` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `travel_city_labels_trip_key_unique` ON `travel_city_labels` (`trip_key`);
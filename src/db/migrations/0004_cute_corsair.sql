CREATE TABLE `insights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`dismissed_at` integer,
	`entity_id` integer,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`action_label` text NOT NULL,
	`action_href` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `insights_kind_entity_idx` ON `insights` (`kind`,`entity_id`);--> statement-breakpoint
CREATE INDEX `insights_dismissed_idx` ON `insights` (`dismissed_at`);
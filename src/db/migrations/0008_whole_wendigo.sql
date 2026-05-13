-- Phase 2: OAuth support
--
-- Adds OAuth identity columns to `users` and makes the PIN-related columns
-- nullable so the same table can hold both PIN-authenticated users (local
-- mode) and OAuth-authenticated users (hosted mode).
--
-- SQLite cannot ALTER COLUMN to change a NOT NULL constraint, so we recreate
-- the table. The encryption_salt stays NOT NULL — both modes need it.

PRAGMA defer_foreign_keys=ON;--> statement-breakpoint

CREATE TABLE `__new_users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `pin_hash` text,
  `pin_salt` text,
  `encryption_salt` text NOT NULL,
  `email` text,
  `email_verified_at` integer,
  `name` text,
  `image` text,
  `language` text DEFAULT 'es' NOT NULL,
  `currency` text DEFAULT 'EUR' NOT NULL,
  `llm_provider` text DEFAULT 'ollama' NOT NULL,
  `llm_model` text DEFAULT 'qwen2.5:14b-instruct-q4_K_M' NOT NULL,
  `cloud_llm_consent_at` integer,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint

INSERT INTO `__new_users` (
  `id`, `pin_hash`, `pin_salt`, `encryption_salt`,
  `language`, `currency`, `llm_provider`, `llm_model`,
  `cloud_llm_consent_at`, `created_at`, `updated_at`
)
SELECT
  `id`, `pin_hash`, `pin_salt`, `encryption_salt`,
  `language`, `currency`, `llm_provider`, `llm_model`,
  `cloud_llm_consent_at`, `created_at`, `updated_at`
FROM `users`;--> statement-breakpoint

DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint

CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);

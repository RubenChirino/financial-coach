CREATE UNIQUE INDEX IF NOT EXISTS `transactions_account_external_uniq` ON `transactions` (`account_id`,`gocardless_transaction_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `transactions_gocardless_transaction_id_unique`;

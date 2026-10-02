ALTER TABLE `grants` ADD `issued_by` text;--> statement-breakpoint
ALTER TABLE `grants` ADD `request_key` text;--> statement-breakpoint
ALTER TABLE `grants` ADD `request_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `grants_issuer_request` ON `grants` (`issued_by`,`request_key`);
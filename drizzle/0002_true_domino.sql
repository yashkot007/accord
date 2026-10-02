ALTER TABLE `changes` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `changes` ADD `request_key` text;--> statement-breakpoint
ALTER TABLE `changes` ADD `request_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `changes_sender_request` ON `changes` (`from_agent`,`request_key`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `request_key` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `request_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_sender_request` ON `tasks` (`from_agent`,`request_key`);
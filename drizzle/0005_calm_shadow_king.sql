CREATE TABLE `context_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`change_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`adopted` text,
	`note` text,
	`actor_id` text,
	`channel` text NOT NULL,
	`source_id` text,
	`source_version` integer,
	`source_status` text,
	`request_key` text,
	`request_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `context_decisions_version` ON `context_decisions` (`change_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `context_decisions_request` ON `context_decisions` (`change_id`,`request_key`);
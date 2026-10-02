CREATE TABLE `task_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`feedback` text NOT NULL,
	`actor_id` text,
	`agent_id` text,
	`channel` text NOT NULL,
	`request_key` text,
	`request_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_updates_version` ON `task_updates` (`task_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_updates_request` ON `task_updates` (`task_id`,`request_key`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `version` integer DEFAULT 0 NOT NULL;
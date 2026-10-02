CREATE TABLE `host_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`agent_id` text,
	`purpose` text NOT NULL,
	`service` text NOT NULL,
	`status` text NOT NULL,
	`room_id` text,
	`outcome` text,
	`request_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `host_visits_owner_updated` ON `host_visits` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `host_visits_request` ON `host_visits` (`owner_id`,`request_key`);
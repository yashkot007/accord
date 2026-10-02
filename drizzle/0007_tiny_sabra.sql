CREATE TABLE `creation_requests` (
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`actor_id`, `action`, `request_key`)
);
--> statement-breakpoint
ALTER TABLE `invites` ADD `created_by` text;
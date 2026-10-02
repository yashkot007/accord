CREATE TABLE `membership_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`membership_key` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`space_version` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_changes_request` ON `membership_changes` (`actor_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `membership_changes_target` ON `membership_changes` (`space_id`,`target_user_id`,`space_version`);--> statement-breakpoint
ALTER TABLE `invites` ADD `issued_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `membership_key` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `spaces` ADD `membership_version` integer DEFAULT 0 NOT NULL;
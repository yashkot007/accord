CREATE TABLE `provider_connections` (
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`connection_id` text NOT NULL,
	`credential` text,
	`account_label` text,
	`status` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `provider`)
);
--> statement-breakpoint
CREATE TABLE `provider_import_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`content` text NOT NULL,
	`source_id` text,
	`shared_space_id` text,
	`request_hash` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_drafts_owner` ON `provider_import_drafts` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `provider_oauth_flows` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`details` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_oauth_owner` ON `provider_oauth_flows` (`owner_id`,`provider`,`created_at`);
ALTER TABLE `sources` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `updated_at` text;
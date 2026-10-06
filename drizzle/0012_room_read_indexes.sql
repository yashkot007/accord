DROP INDEX `agents_owner`;--> statement-breakpoint
CREATE INDEX `agents_owner` ON `agents` (`owner_id`,`id`);--> statement-breakpoint
DROP INDEX `changes_space`;--> statement-breakpoint
CREATE INDEX `changes_space` ON `changes` (`space_id`,`created_at`,`id`);--> statement-breakpoint
DROP INDEX `events_space_time`;--> statement-breakpoint
CREATE INDEX `events_space_time` ON `events` (`space_id`,`created_at`,`id`);--> statement-breakpoint
DROP INDEX `grants_space`;--> statement-breakpoint
CREATE INDEX `grants_space` ON `grants` (`space_id`,`created_at`,`id`);--> statement-breakpoint
DROP INDEX `sources_space`;--> statement-breakpoint
CREATE INDEX `sources_space` ON `sources` (`space_id`,`created_at`,`id`);--> statement-breakpoint
DROP INDEX `tasks_space`;--> statement-breakpoint
CREATE INDEX `tasks_space` ON `tasks` (`space_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `space_agents_profile_rooms` ON `space_agents` (`agent_id`,`space_id`);
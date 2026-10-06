DROP INDEX `members_user`;--> statement-breakpoint
CREATE INDEX `members_user` ON `members` (`user_id`,`space_id`);--> statement-breakpoint
ALTER TABLE `spaces` ADD `context_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER context_revision_changes_insert AFTER INSERT ON changes BEGIN UPDATE spaces SET context_revision=context_revision+1 WHERE id=NEW.space_id; END;
--> statement-breakpoint
CREATE TRIGGER context_revision_changes_update AFTER UPDATE ON changes BEGIN UPDATE spaces SET context_revision=context_revision+1 WHERE id=NEW.space_id OR id=OLD.space_id; END;
--> statement-breakpoint
CREATE TRIGGER context_revision_changes_delete AFTER DELETE ON changes BEGIN UPDATE spaces SET context_revision=context_revision+1 WHERE id=OLD.space_id; END;
--> statement-breakpoint
CREATE TRIGGER context_revision_sources_insert AFTER INSERT ON sources BEGIN UPDATE spaces SET context_revision=context_revision+1 WHERE id=NEW.space_id; END;
--> statement-breakpoint
CREATE TRIGGER context_revision_sources_update AFTER UPDATE ON sources BEGIN UPDATE spaces SET context_revision=context_revision+1 WHERE id=NEW.space_id OR id=OLD.space_id; END;
--> statement-breakpoint
CREATE TRIGGER context_revision_sources_delete AFTER DELETE ON sources BEGIN UPDATE spaces SET context_revision=context_revision+1 WHERE id=OLD.space_id; END;

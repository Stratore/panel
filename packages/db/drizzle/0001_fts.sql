-- Full-text search over articles (SPEC § 7.4, § 8 /search). External-content FTS5 table kept in
-- sync with `items` by triggers; `remove_diacritics 2` makes search accent-insensitive.
CREATE VIRTUAL TABLE `items_fts` USING fts5(
  `title`,
  `summary`,
  content = 'items',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `items_fts_ai` AFTER INSERT ON `items` BEGIN
  INSERT INTO `items_fts` (`rowid`, `title`, `summary`) VALUES (new.`id`, new.`title`, new.`summary`);
END;
--> statement-breakpoint
CREATE TRIGGER `items_fts_ad` AFTER DELETE ON `items` BEGIN
  INSERT INTO `items_fts` (`items_fts`, `rowid`, `title`, `summary`) VALUES ('delete', old.`id`, old.`title`, old.`summary`);
END;
--> statement-breakpoint
CREATE TRIGGER `items_fts_au` AFTER UPDATE OF `title`, `summary` ON `items` BEGIN
  INSERT INTO `items_fts` (`items_fts`, `rowid`, `title`, `summary`) VALUES ('delete', old.`id`, old.`title`, old.`summary`);
  INSERT INTO `items_fts` (`rowid`, `title`, `summary`) VALUES (new.`id`, new.`title`, new.`summary`);
END;

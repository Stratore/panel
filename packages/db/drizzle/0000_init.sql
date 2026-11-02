CREATE TABLE `alerts_sent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dedupe_key` text NOT NULL,
	`channel` text NOT NULL,
	`payload_hash` text NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_sent_dedupe_idx` ON `alerts_sent` (`dedupe_key`,`channel`);--> statement-breakpoint
CREATE INDEX `alerts_sent_sent_idx` ON `alerts_sent` (`sent_at`);--> statement-breakpoint
CREATE TABLE `breaches` (
	`name` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`domain` text DEFAULT '' NOT NULL,
	`accounts` integer NOT NULL,
	`data_classes_json` text DEFAULT '[]' NOT NULL,
	`breach_date` text NOT NULL,
	`added_date` integer NOT NULL,
	`is_verified` integer NOT NULL,
	`is_sensitive` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `breaches_added_idx` ON `breaches` (`added_date`);--> statement-breakpoint
CREATE TABLE `cves` (
	`cve_id` text PRIMARY KEY NOT NULL,
	`description_en` text DEFAULT '' NOT NULL,
	`cvss` real,
	`cvss_version` text,
	`vector` text,
	`severity` text,
	`ghsa_severity` text,
	`epss` real,
	`epss_percentile` real,
	`epss_date` text,
	`kev` integer DEFAULT false NOT NULL,
	`kev_added` text,
	`kev_due` text,
	`kev_ransomware` integer DEFAULT false NOT NULL,
	`cwe` text,
	`cwe_name` text,
	`product` text,
	`affected_json` text DEFAULT '[]' NOT NULL,
	`cpes_json` text DEFAULT '[]' NOT NULL,
	`fixed_versions` text,
	`references_json` text DEFAULT '[]' NOT NULL,
	`has_public_exploit` integer DEFAULT false NOT NULL,
	`published` integer,
	`modified` integer,
	`priority` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cves_priority_idx` ON `cves` (`priority`);--> statement-breakpoint
CREATE INDEX `cves_published_idx` ON `cves` (`published`);--> statement-breakpoint
CREATE INDEX `cves_kev_idx` ON `cves` (`kev`);--> statement-breakpoint
CREATE TABLE `fetch_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`http_status` integer,
	`items_new` integer DEFAULT 0 NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`error` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fetch_runs_source_started_idx` ON `fetch_runs` (`source_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `item_cves` (
	`item_id` integer NOT NULL,
	`cve_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `cve_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cve_id`) REFERENCES `cves`(`cve_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_cves_cve_idx` ON `item_cves` (`cve_id`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`url_hash` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`lang` text NOT NULL,
	`author` text,
	`published_at` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`category` text NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`cluster_id` text,
	`rank_score` real DEFAULT 0 NOT NULL,
	`hn_points` integer,
	`extra_json` text,
	`summary_status` text DEFAULT 'none' NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_url_hash_idx` ON `items` (`url_hash`);--> statement-breakpoint
CREATE INDEX `items_published_idx` ON `items` (`published_at`);--> statement-breakpoint
CREATE INDEX `items_category_published_idx` ON `items` (`category`,`published_at`);--> statement-breakpoint
CREATE INDEX `items_cluster_idx` ON `items` (`cluster_id`);--> statement-breakpoint
CREATE TABLE `prefs` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product` text NOT NULL,
	`version` text NOT NULL,
	`is_security` integer DEFAULT false NOT NULL,
	`url` text NOT NULL,
	`published_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `releases_product_version_idx` ON `releases` (`product`,`version`);--> statement-breakpoint
CREATE INDEX `releases_published_idx` ON `releases` (`published_at`);--> statement-breakpoint
CREATE TABLE `repo_stars` (
	`full_name` text NOT NULL,
	`day` text NOT NULL,
	`stars` integer NOT NULL,
	PRIMARY KEY(`full_name`, `day`),
	FOREIGN KEY (`full_name`) REFERENCES `repos`(`full_name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`full_name` text PRIMARY KEY NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`language` text,
	`url` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`ua_hash` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`group` text NOT NULL,
	`kind` text NOT NULL,
	`adapter` text NOT NULL,
	`url` text NOT NULL,
	`lang` text NOT NULL,
	`category_default` text,
	`product` text,
	`schedule` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`is_custom` integer DEFAULT false NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`etag` text,
	`last_modified` text,
	`health` text DEFAULT 'unknown' NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`passphrase_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`keywords_json` text NOT NULL,
	`cpe_patterns_json` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL
);

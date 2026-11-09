CREATE TABLE `alert_queue` (
	`dedupe_key` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`queued_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alert_queue_queued_idx` ON `alert_queue` (`queued_at`);
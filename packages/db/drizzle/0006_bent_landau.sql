DROP INDEX "ad_events_ad_id_type_idx";--> statement-breakpoint
DELETE FROM "ad_events"
WHERE "id" IN (
	SELECT "id"
	FROM (
		SELECT
			"id",
			row_number() OVER (
				PARTITION BY "ad_id", "type"
				ORDER BY "created_at", "id"
			) AS "duplicate_number"
		FROM "ad_events"
	) AS "ranked_events"
	WHERE "duplicate_number" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "ad_events_ad_id_type_idx" ON "ad_events" USING btree ("ad_id","type");

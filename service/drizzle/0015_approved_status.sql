ALTER TABLE "plan_events" DROP CONSTRAINT "plan_events_status";--> statement-breakpoint
ALTER TABLE "plan_events" ADD CONSTRAINT "plan_events_status" CHECK ("plan_events"."status" in (
        'draft', 'awaiting_review', 'awaiting_signature', 'approved', 'submitted',
        'confirmed', 'failed', 'expired', 'blocked', 'superseded', 'cancelled'
      ));
-- Weave migration verification queries.
-- Run this against source and target and compare results.

select 'application_review_decisions' as table_name, count(*)::bigint as row_count from public.application_review_decisions
union all select 'ashby_application_stage_history', count(*)::bigint from public.ashby_application_stage_history
union all select 'ashby_applications', count(*)::bigint from public.ashby_applications
union all select 'ashby_candidates', count(*)::bigint from public.ashby_candidates
union all select 'ashby_hiring_metadata', count(*)::bigint from public.ashby_hiring_metadata
union all select 'ashby_interview_stages', count(*)::bigint from public.ashby_interview_stages
union all select 'ashby_jobs', count(*)::bigint from public.ashby_jobs
union all select 'ashby_sync_runs', count(*)::bigint from public.ashby_sync_runs
union all select 'ashby_sync_state', count(*)::bigint from public.ashby_sync_state
union all select 'ashby_webhook_events', count(*)::bigint from public.ashby_webhook_events
union all select 'candidate_communications', count(*)::bigint from public.candidate_communications
union all select 'candidate_evaluations', count(*)::bigint from public.candidate_evaluations
union all select 'email_stage_rules', count(*)::bigint from public.email_stage_rules
union all select 'email_templates', count(*)::bigint from public.email_templates
union all select 'email_workflow_test_candidates', count(*)::bigint from public.email_workflow_test_candidates
union all select 'email_workflow_test_events', count(*)::bigint from public.email_workflow_test_events
union all select 'gmail_inbox_connections', count(*)::bigint from public.gmail_inbox_connections
union all select 'gmail_sync_runs', count(*)::bigint from public.gmail_sync_runs
union all select 'ingestion_presented_information', count(*)::bigint from public.ingestion_presented_information
union all select 'rubric_dimensions', count(*)::bigint from public.rubric_dimensions
union all select 'rubric_score_levels', count(*)::bigint from public.rubric_score_levels
union all select 'rubric_settings', count(*)::bigint from public.rubric_settings
union all select 'target_ingestions', count(*)::bigint from public.target_ingestions
union all select 'target_page_publish_notification_settings', count(*)::bigint from public.target_page_publish_notification_settings
union all select 'target_page_publish_notifications', count(*)::bigint from public.target_page_publish_notifications
order by table_name;

select
  'ashby_applications_missing_candidate' as check_name,
  count(*)::bigint as violation_count
from public.ashby_applications a
left join public.ashby_candidates c on c.ashby_candidate_id = a.ashby_candidate_id
where a.ashby_candidate_id is not null and c.ashby_candidate_id is null
union all
select
  'ashby_applications_missing_job',
  count(*)::bigint
from public.ashby_applications a
left join public.ashby_jobs j on j.ashby_job_id = a.ashby_job_id
where a.ashby_job_id is not null and j.ashby_job_id is null
union all
select
  'ashby_application_stage_history_missing_application',
  count(*)::bigint
from public.ashby_application_stage_history h
left join public.ashby_applications a on a.ashby_application_id = h.ashby_application_id
where h.ashby_application_id is not null and a.ashby_application_id is null
union all
select
  'application_review_decisions_missing_application',
  count(*)::bigint
from public.application_review_decisions d
left join public.ashby_applications a on a.ashby_application_id = d.ashby_application_id
where d.ashby_application_id is not null and a.ashby_application_id is null
union all
select
  'candidate_communications_missing_gmail_connection',
  count(*)::bigint
from public.candidate_communications cc
left join public.gmail_inbox_connections gc on gc.id = cc.gmail_connection_id
where cc.gmail_connection_id is not null and gc.id is null
union all
select
  'candidate_communications_missing_application',
  count(*)::bigint
from public.candidate_communications cc
left join public.ashby_applications a on a.ashby_application_id = cc.linked_ashby_application_id
where cc.linked_ashby_application_id is not null and a.ashby_application_id is null
union all
select
  'candidate_communications_missing_candidate',
  count(*)::bigint
from public.candidate_communications cc
left join public.ashby_candidates c on c.ashby_candidate_id = cc.linked_ashby_candidate_id
where cc.linked_ashby_candidate_id is not null and c.ashby_candidate_id is null
union all
select
  'candidate_communications_missing_job',
  count(*)::bigint
from public.candidate_communications cc
left join public.ashby_jobs j on j.ashby_job_id = cc.linked_ashby_job_id
where cc.linked_ashby_job_id is not null and j.ashby_job_id is null
union all
select
  'candidate_evaluations_missing_application',
  count(*)::bigint
from public.candidate_evaluations ce
left join public.ashby_applications a on a.ashby_application_id = ce.ashby_application_id
where ce.ashby_application_id is not null and a.ashby_application_id is null
union all
select
  'candidate_evaluations_missing_candidate',
  count(*)::bigint
from public.candidate_evaluations ce
left join public.ashby_candidates c on c.ashby_candidate_id = ce.ashby_candidate_id
where ce.ashby_candidate_id is not null and c.ashby_candidate_id is null
union all
select
  'candidate_evaluations_missing_job',
  count(*)::bigint
from public.candidate_evaluations ce
left join public.ashby_jobs j on j.ashby_job_id = ce.ashby_job_id
where ce.ashby_job_id is not null and j.ashby_job_id is null
union all
select
  'email_stage_rules_missing_template',
  count(*)::bigint
from public.email_stage_rules esr
left join public.email_templates et on et.id = esr.template_id
where esr.template_id is not null and et.id is null
union all
select
  'email_workflow_test_events_missing_candidate',
  count(*)::bigint
from public.email_workflow_test_events ewte
left join public.email_workflow_test_candidates ewtc on ewtc.id = ewte.test_candidate_id
where ewte.test_candidate_id is not null and ewtc.id is null
union all
select
  'email_workflow_test_events_missing_template',
  count(*)::bigint
from public.email_workflow_test_events ewte
left join public.email_templates et on et.id = ewte.template_id
where ewte.template_id is not null and et.id is null
union all
select
  'gmail_sync_runs_missing_connection',
  count(*)::bigint
from public.gmail_sync_runs gsr
left join public.gmail_inbox_connections gc on gc.id = gsr.gmail_connection_id
where gsr.gmail_connection_id is not null and gc.id is null
union all
select
  'rubric_score_levels_missing_dimension',
  count(*)::bigint
from public.rubric_score_levels rsl
left join public.rubric_dimensions rd on rd.key = rsl.dimension_key
where rd.key is null
union all
select
  'ingestion_presented_information_missing_target_ingestion',
  count(*)::bigint
from public.ingestion_presented_information ipi
left join public.target_ingestions ti on ti.id = ipi.target_ingestion_id
where ipi.target_ingestion_id is not null and ti.id is null
union all
select
  'target_page_publish_notifications_missing_presented_information',
  count(*)::bigint
from public.target_page_publish_notifications n
left join public.ingestion_presented_information ipi on ipi.id = n.presented_information_id
where n.presented_information_id is not null and ipi.id is null
union all
select
  'target_page_publish_notifications_missing_target_ingestion',
  count(*)::bigint
from public.target_page_publish_notifications n
left join public.target_ingestions ti on ti.id = n.target_ingestion_id
where n.target_ingestion_id is not null and ti.id is null
order by check_name;

select
  'ashby_candidates' as table_name,
  max(ashby_updated_at) as max_source_updated_at
from public.ashby_candidates
union all
select
  'ashby_applications',
  max(ashby_updated_at)
from public.ashby_applications
union all
select
  'ashby_webhook_events',
  max(created_at)
from public.ashby_webhook_events
union all
select
  'gmail_sync_runs',
  max(created_at)
from public.gmail_sync_runs
union all
select
  'candidate_communications',
  max(gmail_internal_date)
from public.candidate_communications
order by table_name;

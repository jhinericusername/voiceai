-- Weave Supabase -> Puddle AWS candidate evaluation outbound hook.
--
-- Apply this file only after the AWS ingress endpoint is deployed and the
-- matching webhook secret has been written to AWS Secrets Manager and Supabase
-- Vault. Do not apply during normal application deploys.

create extension if not exists pg_net with schema public;
create extension if not exists supabase_vault with schema vault;

create or replace function public.puddle_candidate_evaluation_webhook_v1_for_record(
  evaluation_row public.candidate_evaluations,
  operation_name text
)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  webhook_url text;
  webhook_secret text;
  event_id text;
begin
  select decrypted_secret
    into webhook_url
    from vault.decrypted_secrets
    where name = 'puddle_weave_candidate_evaluation_webhook_url'
    limit 1;

  select decrypted_secret
    into webhook_secret
    from vault.decrypted_secrets
    where name = 'puddle_weave_candidate_evaluation_webhook_secret'
    limit 1;

  if webhook_url is null then
    raise exception 'puddle_weave_candidate_evaluation_webhook_url must be set in Supabase Vault';
  end if;

  if webhook_secret is null then
    raise exception 'puddle_weave_candidate_evaluation_webhook_secret must be set in Supabase Vault';
  end if;

  event_id := gen_random_uuid()::text;

  perform net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-puddle-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'eventId', event_id,
      'source', 'weave_supabase_candidate_evaluation',
      'operation', operation_name,
      'record', to_jsonb(evaluation_row)
    ),
    timeout_milliseconds := 5000
  );

  return;
end;
$$;

create or replace function public.puddle_candidate_evaluation_webhook_v1()
returns trigger
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
begin
  perform public.puddle_candidate_evaluation_webhook_v1_for_record(new, tg_op);
  return new;
end;
$$;

drop trigger if exists puddle_candidate_evaluation_webhook_v1 on public.candidate_evaluations;

create trigger puddle_candidate_evaluation_webhook_v1
after insert or update on public.candidate_evaluations
for each row
execute function public.puddle_candidate_evaluation_webhook_v1();

create or replace function public.puddle_backfill_candidate_evaluations_v1(batch_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  sent_count integer := 0;
  evaluation_row public.candidate_evaluations%rowtype;
begin
  for evaluation_row in
    select *
    from public.candidate_evaluations
    where ashby_application_id is not null
      and ashby_candidate_id is not null
      and ashby_job_id is not null
    order by updated_at nulls last, created_at nulls last, id
    limit batch_limit
  loop
    perform public.puddle_candidate_evaluation_webhook_v1_for_record(evaluation_row, 'UPDATE');
    sent_count := sent_count + 1;
  end loop;

  return sent_count;
end;
$$;

-- SECURITY DEFINER functions in public are executable by PUBLIC by default.
-- These functions are internal trigger/backfill entry points, so remove direct
-- app-role execution. Operators should run the backfill from an approved SQL
-- session with an owner/service role instead of granting anon/authenticated.
revoke execute on function public.puddle_candidate_evaluation_webhook_v1_for_record(public.candidate_evaluations, text)
  from public, anon, authenticated;
revoke execute on function public.puddle_candidate_evaluation_webhook_v1()
  from public, anon, authenticated;
revoke execute on function public.puddle_backfill_candidate_evaluations_v1(integer)
  from public, anon, authenticated;

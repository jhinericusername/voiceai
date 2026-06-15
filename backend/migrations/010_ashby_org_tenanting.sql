-- 010_ashby_org_tenanting.sql - make Ashby integrations WorkOS-organization scoped.

DROP INDEX IF EXISTS ashby_company_integrations_email_domain_idx;

CREATE INDEX IF NOT EXISTS ashby_company_integrations_email_domain_lookup_idx
  ON ashby_company_integrations(email_domain);

# ================================================================
# clone-prod-to-dev.ps1
#
# Copies the LIVE Levisa database (schema + ALL data, including auth
# users so the same logins work) into the separate DEV project used by
# the `develop` branch / Vercel Preview.
#
# PROD IS ONLY READ (pg_dump). Nothing is ever written to prod.
#
# Follows Supabase's "migrate between projects" method:
#   roles.sql  -> custom roles
#   schema.sql -> public schema (tables, views, functions, triggers, RLS)
#   data.sql   -> all rows (public + auth users + storage metadata),
#                 loaded with triggers OFF (session_replication_role =
#                 replica) so no fake notifications / audit rows /
#                 advance numbers are generated during the copy.
# Then re-creates custom triggers on auth.* (e.g. on_auth_user_created),
# which the schema dump does not include, and compares row counts.
#
# PREREQUISITES
#   - Docker Desktop running (supabase db dump uses it)
#   - Supabase CLI, psql (both already installed on this machine)
#   - Two user environment variables (Dashboard -> Connect -> Session pooler):
#       LEVISA_PROD_DB_URL   e.g. postgresql://postgres.<prodref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres
#       LEVISA_DEV_DB_URL    same, for the dev project
#
# USAGE
#   .\scripts\clone-prod-to-dev.ps1            # first copy into an EMPTY dev project
#   .\scripts\clone-prod-to-dev.ps1 -Reset     # refresh: wipes DEV public schema + auth users first
#   add -Yes to skip the confirmation prompt
#
# Dump files land in .dbclone\<timestamp>\ (git-ignored - they contain real data).
# ================================================================

param(
    [switch]$Reset,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$PROD_REF_EXPECTED = 'fhmdtbvpjqftwsbdihcu'

function Get-EnvVar([string]$name) {
    $v = [Environment]::GetEnvironmentVariable($name, 'Process')
    if (-not $v) { $v = [Environment]::GetEnvironmentVariable($name, 'User') }
    return $v
}

function Get-ProjectRef([string]$url) {
    if ($url -match 'postgres\.([a-z0-9]{20})[:@]') { return $Matches[1] }
    if ($url -match 'db\.([a-z0-9]{20})\.supabase\.co') { return $Matches[1] }
    return $null
}

function Assert-Ok([string]$step) {
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: $step (exit code $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
}

# ── Connection strings + safety guards ──────────────────────────
$PROD = Get-EnvVar 'LEVISA_PROD_DB_URL'
$DEV  = Get-EnvVar 'LEVISA_DEV_DB_URL'
if (-not $PROD -or -not $DEV) {
    Write-Host 'Set LEVISA_PROD_DB_URL and LEVISA_DEV_DB_URL first (see header).' -ForegroundColor Red
    exit 1
}

$prodRef = Get-ProjectRef $PROD
$devRef  = Get-ProjectRef $DEV
if (-not $prodRef -or -not $devRef) {
    Write-Host 'Could not read the project ref from one of the URLs. Use the Session pooler / direct connection string from the dashboard.' -ForegroundColor Red
    exit 1
}
if ($prodRef -ne $PROD_REF_EXPECTED) {
    Write-Host "LEVISA_PROD_DB_URL points at '$prodRef', expected the live project '$PROD_REF_EXPECTED'." -ForegroundColor Red
    exit 1
}
if ($devRef -eq $PROD_REF_EXPECTED -or $devRef -eq $prodRef) {
    Write-Host 'LEVISA_DEV_DB_URL points at PRODUCTION. Refusing to write.' -ForegroundColor Red
    exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Docker is not running. Start Docker Desktop and retry.' -ForegroundColor Red
    exit 1
}

# ── Is dev empty? ───────────────────────────────────────────────
$devTables = (psql $DEV -At -c "select count(*) from information_schema.tables where table_schema='public'")
Assert-Ok 'connect to DEV'
$devTables = [int]($devTables | Select-Object -Last 1)

if ($devTables -gt 0 -and -not $Reset) {
    Write-Host "DEV already has $devTables table(s) in public. Re-run with -Reset to wipe and refresh it." -ForegroundColor Yellow
    exit 1
}

Write-Host ''
Write-Host "  READ  from PROD : $prodRef" -ForegroundColor Cyan
Write-Host "  WRITE to   DEV  : $devRef" -ForegroundColor Cyan
if ($Reset) { Write-Host '  DEV public schema and auth users will be WIPED first.' -ForegroundColor Yellow }
if (-not $Yes) {
    $answer = Read-Host 'Type CLONE to continue'
    if ($answer -ne 'CLONE') { Write-Host 'Cancelled.'; exit 0 }
}

# ── Output folder (git-ignored) ─────────────────────────────────
$root = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $root (".dbclone\" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $out | Out-Null
$roles  = Join-Path $out 'roles.sql'
$schema = Join-Path $out 'schema.sql'
$data   = Join-Path $out 'data.sql'
$authTr = Join-Path $out 'auth_triggers.sql'

# ── 1. Dump PROD (read-only) ────────────────────────────────────
Write-Host 'Dumping roles ...' -ForegroundColor Cyan
supabase db dump --db-url $PROD -f $roles --role-only
Assert-Ok 'dump roles'

Write-Host 'Dumping schema ...' -ForegroundColor Cyan
supabase db dump --db-url $PROD -f $schema
Assert-Ok 'dump schema'

Write-Host 'Dumping data (public + auth + storage metadata) ...' -ForegroundColor Cyan
supabase db dump --db-url $PROD -f $data --use-copy --data-only
Assert-Ok 'dump data'

Write-Host 'Reading custom triggers on auth/storage tables ...' -ForegroundColor Cyan
$triggerSql = @"
set search_path = '';
select format('drop trigger if exists %I on %I.%I; %s;', t.tgname, n.nspname, c.relname, pg_get_triggerdef(t.oid))
from pg_trigger t
join pg_class c      on c.oid = t.tgrelid
join pg_namespace n  on n.oid = c.relnamespace
join pg_proc p       on p.oid = t.tgfoid
join pg_namespace pn on pn.oid = p.pronamespace
where n.nspname in ('auth','storage')
  and pn.nspname not in ('auth','storage','extensions','realtime','supabase_functions')
  and not t.tgisinternal;
"@
$triggerLines = psql $PROD -At -c $triggerSql
Assert-Ok 'read auth triggers'
# psql also echoes the "SET" command tag - keep only the generated statements.
$triggerLines = @($triggerLines | Where-Object { $_ -like 'drop trigger*' })
[IO.File]::WriteAllLines($authTr, [string[]]$triggerLines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("  found {0} custom trigger(s)" -f $triggerLines.Count)

# ── Strip prod Database Webhooks from the DEV schema ────────────
# Prod has Database Webhooks (supabase_functions.http_request triggers on
# public.invoices) that POST every invoice update to n8n. They must NEVER
# exist in dev: dev rows share prod's ids, so n8n would email Ryder/RZR and
# write the result back into PROD. Dev also has no supabase_functions schema.
$schemaLines = Get-Content -Encoding utf8 $schema
$webhookLines = @($schemaLines | Where-Object { $_ -match '"?supabase_functions"?\."?http_request"?' })
if ($webhookLines.Count -gt 0) {
    Write-Host ("  skipping {0} prod Database Webhook trigger(s) (they call n8n):" -f $webhookLines.Count) -ForegroundColor Yellow
    foreach ($w in $webhookLines) {
        if ($w -match 'TRIGGER "([^"]+)"') { Write-Host "    - $($Matches[1])" -ForegroundColor Yellow }
    }
    $kept = @($schemaLines | Where-Object { $_ -notmatch '"?supabase_functions"?\."?http_request"?' })
    [IO.File]::WriteAllLines($schema, [string[]]$kept, (New-Object System.Text.UTF8Encoding($false)))
}

# ── Keep only auth + public data ────────────────────────────────
# storage.* is platform-owned (restoring it fails with "permission denied")
# and empty in prod (files live in Google Drive). supabase_functions.hooks is
# the prod webhook call log - irrelevant for dev.
$skipSchemas = '"(storage|supabase_functions)"\.'
$dataOut = New-Object System.Collections.Generic.List[string]
$inSkippedCopy = $false
$skippedBlocks = 0
foreach ($line in (Get-Content -Encoding utf8 $data)) {
    if ($inSkippedCopy) {
        if ($line -eq '\.') { $inSkippedCopy = $false }
        continue
    }
    if ($line -match "^COPY $skipSchemas") { $inSkippedCopy = $true; $skippedBlocks++; continue }
    if ($line -match "setval\('$skipSchemas") { continue }
    $dataOut.Add($line)
}
[IO.File]::WriteAllLines($data, $dataOut.ToArray(), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  left out $skippedBlocks storage/webhook-log table(s) from the data copy"

# ── 2. Optional reset of DEV ────────────────────────────────────
if ($Reset) {
    Write-Host 'Wiping DEV public schema + auth users ...' -ForegroundColor Yellow
    $resetSql = @"
drop schema if exists public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all   on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
delete from auth.users;
"@
    psql $DEV -v ON_ERROR_STOP=1 -c $resetSql
    Assert-Ok 'reset DEV'
}

# ── 3. Restore into DEV (single transaction, triggers off for data) ──
Write-Host 'Restoring into DEV ...' -ForegroundColor Cyan
psql --single-transaction --variable ON_ERROR_STOP=1 `
     --file $roles `
     --file $schema `
     --command 'SET session_replication_role = replica' `
     --file $data `
     --dbname $DEV
Assert-Ok 'restore into DEV'

if ($triggerLines.Count -gt 0) {
    Write-Host 'Re-creating auth/storage triggers ...' -ForegroundColor Cyan
    psql $DEV -v ON_ERROR_STOP=1 -f $authTr
    Assert-Ok 'create auth triggers'
}

# ── 4. Verify row counts ────────────────────────────────────────
$countSql = @"
select table_schema || '.' || table_name || '|' ||
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables
where table_type = 'BASE TABLE'
  and (table_schema = 'public' or (table_schema = 'auth' and table_name in ('users','identities')))
order by 1;
"@
$prodCounts = @{}; $devCounts = @{}
foreach ($l in (psql $PROD -At -c $countSql)) { if ($l) { $p = $l.Split('|'); $prodCounts[$p[0]] = $p[1] } }
foreach ($l in (psql $DEV  -At -c $countSql)) { if ($l) { $p = $l.Split('|'); $devCounts[$p[0]]  = $p[1] } }

Write-Host ''
Write-Host ('{0,-40} {1,10} {2,10}' -f 'table', 'prod', 'dev')
$mismatch = 0
foreach ($k in ($prodCounts.Keys | Sort-Object)) {
    $d = $devCounts[$k]
    $flag = ''
    if ($d -ne $prodCounts[$k]) { $flag = '  <-- MISMATCH'; $mismatch++ }
    Write-Host ('{0,-40} {1,10} {2,10}{3}' -f $k, $prodCounts[$k], $d, $flag)
}
Write-Host ''
if ($mismatch -eq 0) {
    Write-Host 'Clone complete - all row counts match.' -ForegroundColor Green
} else {
    Write-Host "Clone finished with $mismatch mismatched table(s) - check above." -ForegroundColor Yellow
}
Write-Host "Dump files: $out (contain real data - do not share or commit)"

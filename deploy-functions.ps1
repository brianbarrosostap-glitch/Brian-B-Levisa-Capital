# ================================================================
# deploy-functions.ps1
# Deploys Supabase Edge Functions to DEV (default) or PROD.
#
#   .\deploy-functions.ps1                        # all functions -> DEV
#   .\deploy-functions.ps1 send-emails            # one function  -> DEV
#   .\deploy-functions.ps1 -Target prod           # all functions -> PROD (asks to confirm)
#
# Every folder under supabase/functions except _shared is a function.
# verify_jwt per function comes from supabase/config.toml.
#
# BEFORE RUNNING: `supabase login` with the account that owns the project.
# ================================================================

param(
    [Parameter(Position = 0)]
    [string[]]$Functions,
    [ValidateSet('dev', 'prod')]
    [string]$Target = 'dev',
    [switch]$Yes
)

$REFS = @{
    dev  = 'zwvjkhtehkpdjjrfyhhv'   # levisa dev  (git develop / Vercel Preview)
    prod = 'fhmdtbvpjqftwsbdihcu'   # LIVE        (git main / Vercel Production)
}
$PROJECT_REF = $REFS[$Target]
$fnRoot = Join-Path $PSScriptRoot 'supabase\functions'

if (-not $Functions -or $Functions.Count -eq 0) {
    $Functions = Get-ChildItem -Directory $fnRoot |
        Where-Object { $_.Name -notlike '_*' } |
        ForEach-Object { $_.Name } |
        Sort-Object
}

Write-Host ""
Write-Host "Target : $Target ($PROJECT_REF)" -ForegroundColor Cyan
Write-Host "Deploy : $($Functions -join ', ')" -ForegroundColor Cyan

if ($Target -eq 'prod' -and -not $Yes) {
    $answer = Read-Host 'Deploying to PRODUCTION. Type PROD to continue'
    if ($answer -ne 'PROD') { Write-Host 'Cancelled.'; exit 0 }
}

$failed = @()
foreach ($fn in $Functions) {
    if (-not (Test-Path (Join-Path $fnRoot $fn))) {
        Write-Host "  SKIP: $fn (no such folder)" -ForegroundColor Yellow
        continue
    }
    Write-Host "  -> $fn" -ForegroundColor Yellow
    supabase functions deploy $fn --project-ref $PROJECT_REF
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  FAILED: $fn" -ForegroundColor Red
        $failed += $fn
    } else {
        Write-Host "  OK: $fn" -ForegroundColor Green
    }
}

Write-Host ""
if ($failed.Count) {
    Write-Host "Done with failures: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host "Done. Functions live at https://$PROJECT_REF.supabase.co/functions/v1/<name>" -ForegroundColor Green

# ================================================================
# deploy-functions.ps1
# Deploys all 4 Supabase Edge Functions in one shot.
#
# BEFORE RUNNING:
#   1. Install the Supabase CLI:
#        npm install -g supabase
#   2. Log in:
#        supabase login
#   3. Replace YOUR_PROJECT_REF below with your actual project ref.
#      Find it at: Dashboard → Project Settings → General → Reference ID
# ================================================================

$PROJECT_REF = "YOUR_PROJECT_REF"   # <-- change this

if ($PROJECT_REF -eq "YOUR_PROJECT_REF") {
    Write-Host "ERROR: Edit deploy-functions.ps1 and set your PROJECT_REF first." -ForegroundColor Red
    exit 1
}

Write-Host "Linking project $PROJECT_REF ..." -ForegroundColor Cyan
supabase link --project-ref $PROJECT_REF

Write-Host ""
Write-Host "Deploying Edge Functions ..." -ForegroundColor Cyan

$functions = @(
    "approve-batch",
    "submit-advance-request",
    "match-confirmation",
    "mark-invoice-status"
)

foreach ($fn in $functions) {
    Write-Host "  → $fn" -ForegroundColor Yellow
    supabase functions deploy $fn --project-ref $PROJECT_REF
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  FAILED: $fn" -ForegroundColor Red
    } else {
        Write-Host "  OK: $fn" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Done. Functions live at:" -ForegroundColor Green
Write-Host "  https://$PROJECT_REF.supabase.co/functions/v1/<function-name>"

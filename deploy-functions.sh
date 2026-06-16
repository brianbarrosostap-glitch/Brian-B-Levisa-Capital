#!/bin/bash
# ================================================================
# deploy-functions.sh  (use this if you prefer bash / Git Bash)
# BEFORE RUNNING:
#   npm install -g supabase
#   supabase login
#   Set PROJECT_REF below.
# ================================================================

PROJECT_REF="YOUR_PROJECT_REF"   # <-- change this

if [ "$PROJECT_REF" = "YOUR_PROJECT_REF" ]; then
  echo "ERROR: set your PROJECT_REF in deploy-functions.sh first."
  exit 1
fi

supabase link --project-ref "$PROJECT_REF"

for fn in approve-batch submit-advance-request match-confirmation mark-invoice-status; do
  echo "Deploying $fn ..."
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
done

echo ""
echo "Done. Functions live at:"
echo "  https://$PROJECT_REF.supabase.co/functions/v1/<function-name>"

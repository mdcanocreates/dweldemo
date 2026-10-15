# Remote state for Dwel staging workspace.
#
# BEFORE first authorized apply:
#   1. Create (or reuse) an S3 bucket + DynamoDB lock table for Terraform state
#      that is SEPARATE from any future prod remote migration.
#   2. Copy backend.hcl.example → backend.hcl (gitignored) and fill real values.
#   3. terraform init -backend-config=backend.hcl
#
# Until then, leave this block commented so accidental init cannot claim a
# half-configured remote backend. Local state must never be used for apply
# against the shared production account without the same review bar.

# terraform {
#   backend "s3" {
#     # All values supplied via -backend-config=backend.hcl
#   }
# }

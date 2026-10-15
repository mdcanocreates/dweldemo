# Staging engineering continuation — inventory

**Date:** 2026-10-14  
**Worktree:** `apps/dwel-staging-continue`  
**Branch:** `staging/engineering-continue`  
**Base SHA:** `fddec9a` (Sprint 2)  

## Preexisting dirty tree (NOT absorbed)

Primary checkout `apps/dwel` on `sprint2/dwel-document-review-admin` @ `fddec9a` remains heavily dirty (evidence, redesign, unrelated TF, web rebuild). This worktree was created clean from `fddec9a` so staging prep does not commit unrelated changes.

## Related product SHAs (reference)

| Product | SHA |
|---------|-----|
| Dwel Sprint 1 | `5e00887` |
| Dwel Sprint 2 | `fddec9a` |
| Admin | `7a500fa` |
| Lumis (tip when recorded) | `dcfadb7` |

## This branch scope

Staging Terraform attachment + CloudFront strategy, static/CI gates, disposable migrate helper, runbook/manifest/costs, `/health/live`, staging UI banner.

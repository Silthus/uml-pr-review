# Ingestion

Event ingestion: consuming events, running them through the pipelines, and producing their outputs.

## invariants
- ingestion never reaches cdp: Ingestion code depends on CDP only through the contracts in ~/common.
  over: every non-test import under nodejs/src/ingestion
  via: lint oxlint:no-restricted-imports matching "~/cdp"
  because: ingestion and CDP deploy apart, and a direct import couples their releases
  kinds: none

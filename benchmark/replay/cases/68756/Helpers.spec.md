# Helpers

Shared request helpers, impersonation among them.

## invariants
- impersonation read through is_impersonated: Code asks whether a request is impersonated only through is_impersonated, which also sees MCP impersonation.
  protects: is_impersonated_session in posthog/models/activity_logging/model_activity.py
  chokepoint: is_impersonated in posthog/helpers/impersonation.py
  because: is_impersonated_session reads only the loginas session cookie, so it misses MCP impersonation
  kinds: none

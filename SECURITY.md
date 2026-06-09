# Security policy

## Reporting a vulnerability

Please report security issues privately. Do **not** open a public issue for a vulnerability.

- Email: **security@vitrus.dev**
- Or use GitHub's [private vulnerability reporting](https://github.com/ahmetvural79/Vitrus/security/advisories/new).

We aim to acknowledge within 72 hours and to provide a remediation timeline after triage. Please give
us a reasonable window to ship a fix before any public disclosure.

## Scope

This repo is the **open core** (`@vitrus/core`, `@vitrus/mcp`). The managed cloud service is operated
separately; issues specific to the hosted platform can also be sent to the address above.

## Design guarantees worth knowing

- **No secrets in the repo.** The open core needs no API keys to run (offline-deterministic defaults).
  Provider keys are supplied via environment variables at runtime and are never logged — `vitrus
  doctor` redacts them.
- **Source of truth is local Markdown.** Nothing is sent to a third party unless you configure a cloud
  provider (embedder/synthesizer). Until then the brain is fully local.
- **ACL is fail-closed** at the index layer (`hybrid_search` filters by `principals`; undefined =
  unrestricted local use, an array = enforced).
- **Multi-tenant isolation** (cloud layer) uses Postgres `FORCE ROW LEVEL SECURITY` with a
  non-superuser role plus org-namespaced IDs; the cross-tenant leak test asserts zero cross-org reads.
- **MCP HTTP transport** in the open core is unauthenticated by design — put it behind your own auth,
  or use the cloud layer's OAuth 2.1 resource-server mode.

## Supported versions

The latest minor release receives security fixes. Pin a version in production and watch releases.

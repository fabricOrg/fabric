# jojo platform — documentation

All design, product, and process docs live here. Code/config stays at the repo root.

## Architecture & concepts
- [ARCHITECTURE.md](ARCHITECTURE.md) — platform shape, stack, tenancy, wallet/ledger, decisions log
- [MODULE-DECOMPOSITION.md](MODULE-DECOMPOSITION.md) — modules → components, entities, deps, build order
- [SYSTEM-OVERVIEW-DIAGRAM.md](SYSTEM-OVERVIEW-DIAGRAM.md) — stakeholder "system on a page"
- [GLOSSARY.md](GLOSSARY.md) — plain-English terms (CPaaS, BFF, DLR, RLS, …)

## Subsystems
- [IDENTITY-SSO.md](IDENTITY-SSO.md) — WorkOS SSO, staff identity
- [WORKOS-INFISICAL-SETUP.md](WORKOS-INFISICAL-SETUP.md) - local WorkOS customer realm and Infisical secrets setup
- [decisions/0001-workos-tenant-resolution.md](decisions/0001-workos-tenant-resolution.md) - WorkOS organization to tenant trust boundary
- [INTEGRATIONS-PLUGIN-ARCHITECTURE.md](INTEGRATIONS-PLUGIN-ARCHITECTURE.md) — vendor plugin framework + failover
- [CONTROL-PLANE-ADMIN.md](CONTROL-PLANE-ADMIN.md) — the admin / control plane
- [COMPLIANCE-AND-DATA-PROTECTION.md](COMPLIANCE-AND-DATA-PROTECTION.md) — processor/controller, PII vault, residency

## Product & delivery
- [SMS-FEATURES-AND-POSITIONING.md](SMS-FEATURES-AND-POSITIONING.md) — features + competitive wedge
- [MONEY-ACCOUNTING-AND-COMMERCIAL-PRICING-ROADMAP.md](MONEY-ACCOUNTING-AND-COMMERCIAL-PRICING-ROADMAP.md) — proposed accounting progression and fixed-price bundle scope
- [WALKING-SKELETON.md](WALKING-SKELETON.md) — the thin-thread PI-1 scope
- [PI-1-BACKLOG.md](PI-1-BACKLOG.md) — research-grounded backlog
- [PI-1/](PI-1/README.md) — per-feature user stories (48 files, 9 epics)

## Reviews (gates)
- [ARCHITECTURE-REVIEW.md](ARCHITECTURE-REVIEW.md) — second-pass design critique
- [PRE-IMPLEMENTATION-REVIEW.md](PRE-IMPLEMENTATION-REVIEW.md) — adversarial flow review (9 blockers, resolved)

## Build & process
- [AGENT-DELIVERY-LOOPS.md](AGENT-DELIVERY-LOOPS.md) - vertical-slice agent ownership and gates
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — branches, commits, pull requests, and quality gates
- [sdk/](sdk/README.md) — current SDK guides and the proposed managed-messaging DX
- [IMPLEMENTATION-ROADMAP.md](IMPLEMENTATION-ROADMAP.md) — the two interleaved build tracks (AWS + app)
- [CONVENTIONS.md](CONVENTIONS.md) — code-quality working agreement (ported from shop-app-v2)
- [DEPLOYMENT-AND-DEVOPS.md](DEPLOYMENT-AND-DEVOPS.md) — AWS Cape Town, ECS, CI/CD, hardening
- [DEPLOYMENT-ENVIRONMENTS.md](DEPLOYMENT-ENVIRONMENTS.md) - dev -> testing -> staging -> production promotion

## Shareable
- [platform-brief.html](platform-brief.html) — single-file tabbed brief for stakeholders

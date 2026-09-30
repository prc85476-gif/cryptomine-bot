# MASTER WEBSITE SECURITY AUDIT & HARDENING PROMPT

Act as a senior Application Security Engineer, DevSecOps Engineer, and Secure Code Reviewer.

Your task is to perform a comprehensive security audit of my existing website and fix verified security vulnerabilities without breaking its current features, UI, database, or production deployment.

## PHASE 1 — Understand the Entire Project

1. Inspect the complete repository, including frontend, backend, API routes, authentication, database, admin panel, deployment files, dependencies, and configuration.
2. Identify the actual framework, programming languages, database, hosting provider, and application architecture.
3. Map all public endpoints, privileged endpoints, user roles, sensitive data, and external API integrations.
4. Identify security-critical files and create a prioritized audit checklist.
5. Do not assume any framework or database without inspecting the project.

## PHASE 2 — API Keys and Secret Protection

Search the repository and Git history, where available, for:

* API keys, tokens, passwords, private keys, and connection strings.
* Database credentials and service-role keys.
* Payment gateway secrets and webhook signing secrets.
* Cloud provider credentials and private signing keys.
* Secrets accidentally embedded in frontend JavaScript, source maps, public configuration, build artifacts, or logs.
* Sensitive values committed to Git or exposed through public files.

Requirements:

* Keep private credentials exclusively on the server or in the appropriate secret manager.
* Never expose server secrets through NEXT_PUBLIC_*, VITE_* or other client-exposed environment variables.
* Distinguish genuinely public client keys from privileged secret keys. Public keys may still require domain restrictions, quotas, and appropriate permissions.
* Add a safe .env.example containing placeholder values only.
* Ensure .env files, private keys, backups, database dumps, and sensitive configuration are excluded from Git and public deployment artifacts.
* Remove secret values from logs, error messages, and API responses.
* If a credential has been exposed, explain which credential must be rotated or revoked. Do not assume deleting it from the current source code makes it safe.
* Never print actual secrets in the audit report.
* Never modify production credentials automatically without my authorization.

## PHASE 3 — Authentication and Authorization

Inspect:

* Login, registration, password reset, email verification, and logout.
* Session management, JWT validation, cookie security, and token expiration.
* Admin and moderator access.
* Role-based and resource-level authorization.
* Account takeover, IDOR/BOLA, privilege escalation, and authentication bypass.
* Password storage and password-reset token handling.
* Brute-force protection and credential-stuffing defenses.

Requirements:

* Enforce authorization on the server for every sensitive operation.
* Do not trust hidden buttons, frontend route guards, user IDs, roles, or permissions supplied by the client.
* Use secure, HttpOnly, Secure, and appropriate SameSite cookies when cookie-based sessions are used.
* Validate JWT signatures, allowed algorithms, issuer, audience, expiration, and other relevant claims.
* Apply rate limits and appropriate login abuse protections.
* Require MFA for privileged accounts when supported and appropriate.
* Ensure users cannot read, edit, or delete another user's private data by changing an identifier.

## PHASE 4 — API, Database, and Input Security

Test and fix:

* SQL/NoSQL injection.
* Cross-site scripting (XSS).
* Cross-site request forgery (CSRF), where applicable.
* Server-side request forgery (SSRF).
* Unsafe deserialization and command injection.
* Broken access control and mass assignment.
* Insecure file uploads and path traversal.
* Unsafe redirects and excessive error disclosure.
* Missing request-size limits and resource exhaustion.
* Weak CORS policies and missing security headers.

Requirements:

* Use parameterized queries or safe ORM operations.
* Validate all untrusted input on the server using explicit schemas and allowlists where appropriate.
* Encode output according to its context.
* Restrict file type, size, storage location, and access to uploaded files.
* Prevent arbitrary remote URL fetching and access to internal services.
* Apply least-privilege database permissions.
* Return generic production errors without exposing stack traces or internal infrastructure details.
* Do not rely on client-side validation as a security boundary.

## PHASE 5 — Frontend and Browser Security

Inspect:

* Hardcoded credentials and sensitive application data.
* Exposed source maps and unnecessary debug information.
* Unsafe HTML rendering and DOM injection.
* Content Security Policy (CSP).
* HTTPS enforcement and security headers.
* CORS and allowed origins.
* Clickjacking protections.
* Third-party scripts and dependency integrity.
* Sensitive information stored in localStorage, sessionStorage, URLs, or browser logs.

Implement appropriate security headers, including CSP, HSTS, X-Content-Type-Options, and frame protections, without breaking legitimate functionality.

Do not blindly apply restrictive policies that disable required APIs, authentication, payments, or embedded content.

## PHASE 6 — Database and Business Logic

Verify that:

* Users can only access records they are authorized to access.
* Admin-only operations are enforced on the server.
* Prices, balances, discounts, referral rewards, payment status, and permissions cannot be manipulated by modifying client requests.
* Payment callbacks and webhooks are authenticated and verified.
* Duplicate requests cannot cause duplicate payments, rewards, or transactions.
* Sensitive records are not exposed through overly broad API responses.
* Database backups, migrations, and deletion operations are handled safely.
* Production and development environments are properly separated.

If the application handles money or cryptocurrency, pay special attention to transaction integrity, webhook verification, replay attacks, idempotency, withdrawal controls, and audit logs.

## PHASE 7 — Dependency and Infrastructure Security

Inspect:

* Outdated and vulnerable packages.
* Lockfiles and dependency integrity.
* Exposed development servers, debug endpoints, and test accounts.
* Overly permissive cloud or hosting permissions.
* Unnecessary open ports and public database access.
* CI/CD secrets and deployment permissions.
* DNS, TLS, reverse proxy, and hosting configuration where accessible.
* Rate limiting, bot abuse, and denial-of-service exposure.

Use the relevant ecosystem tools when available, such as npm audit, Gitleaks, Semgrep, OWASP ZAP, or Trivy. Choose tools appropriate to the actual stack.

Do not install unknown packages or run destructive scanners against production.

## PHASE 8 — Testing and Verification

After making changes:

1. Run existing tests and add security regression tests for verified vulnerabilities.
2. Run linting, type checks, build checks, and dependency audits where applicable.
3. Test unauthenticated, authenticated, and privileged access paths.
4. Verify that one user cannot access another user's private resources.
5. Verify that secrets are not present in the frontend bundle or public artifacts.
6. Confirm that legitimate application functionality still works.
7. Re-test each fixed vulnerability and report any issue that could not be verified.
8. Do not claim the site is completely secure or penetration-tested unless the relevant testing was actually completed.

Use a local or authorized staging environment for active security testing. Do not attack third-party systems or perform destructive tests.

## PHASE 9 — Safe Remediation Rules

* Inspect before modifying.
* Preserve existing functionality and architecture wherever possible.
* Back up or create a Git checkpoint before substantial changes.
* Make small, reviewable changes.
* Never delete production data, disable authentication, weaken security controls, or expose credentials as a workaround.
* Never overwrite production environment variables without approval.
* Do not automatically deploy to production.
* If a change requires a migration, credential rotation, provider-dashboard configuration, or downtime, explain the required action and obtain approval before performing it.
* If you lack access to a provider dashboard or external service, clearly state what I must verify manually.

## PHASE 10 — Final Security Report

Create SECURITY_AUDIT.md containing:

1. Project architecture and security boundaries.
2. Findings with severity: Critical, High, Medium, Low, or Informational.
3. Affected files, routes, and components.
4. Evidence and reproducible steps for each verified issue.
5. Potential impact and remediation applied.
6. Tests performed and their results.
7. Remaining risks and unverified areas.
8. Exposed credentials requiring rotation, identified by type or name only.
9. Required hosting-provider and dashboard settings.
10. A prioritized checklist of remaining actions.

Also create SECURITY_CHECKLIST.md and, where appropriate, a repeatable security-check command or CI workflow.

Start with read-only inspection. Fix verified vulnerabilities systematically, beginning with Critical and High severity issues. Ask for approval before destructive operations, production changes, credential rotation, or deployment.

My goal is to reduce the website's attack surface and prevent unauthorized access, data leaks, account compromise, and abuse. Be evidence-driven, preserve functionality, and clearly distinguish verified security from assumptions or untested areas.

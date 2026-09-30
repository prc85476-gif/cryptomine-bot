---
name: coolify-deployment
description: >-
  Procedures and checklists for deploying, monitoring, and diagnosing the CryptoMine bot on Coolify.
---

# 🚀 Coolify Deployment & Health Check Skill

This skill documents the automated deployment, container log verification, and database sync workflow on Coolify.

## Standard Deployment Flow

1. **Pre-Deployment Checks:**
   - Syntax validation:
     ```bash
     node -c server.js
     ```
   - Security verification:
     ```bash
     node scratch/security_verification_test.js
     ```
   - Git commit & push to `main`:
     ```bash
     git add -A && git commit -m "..." && git push origin main
     ```

2. **Trigger Coolify Deployment:**
   - Use Coolify MCP tool `deploy` with UUID `apijgaazl8bnyiwwrytire7f`, `force: true`, `wait: true`.

3. **Verify Container Health:**
   - Check application logs using `application_logs` tool:
     - Verify: `✅ Neon PostgreSQL Database Initialized Successfully`
     - Verify: `🤖 Main User Telegram Bot initialized`
     - Verify: `🤖 Telegram Admin Bot initialized`

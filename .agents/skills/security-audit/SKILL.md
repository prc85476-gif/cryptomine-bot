---
name: security-audit
description: >-
  Comprehensive security auditing, exploit detection, penetration testing,
  and secret isolation validation for CryptoMine Telegram Mini App and Node.js backend.
---

# 🛡️ CryptoMine Security Audit & Penetration Testing Skill

This skill guides the automated and manual verification of all security controls in the CryptoMine platform.

## Key Capabilities

1. **Automated Security Test Suite Execution:**
   Run the full security test suite:
   ```bash
   node scratch/security_verification_test.js
   ```
   Validates:
   - Zero hardcoded secrets/passwords/tokens in source files.
   - `.env.example` placeholder integrity & `.gitignore` secret exclusion.
   - Debug and fast-forward endpoints blocked (`403 Forbidden`).
   - BEP-20 / BSC crypto wallet address validation.

2. **Client-Side Balance Tampering Simulation:**
   Run the fake balance exploit simulator:
   ```bash
   node scratch/test_fake_js_balance.js
   ```
   Validates:
   - Rejection of client-modified balances on withdrawal.
   - Strict server-side and Neon PostgreSQL atomic deduction (`atomicDeductBalance`).

3. **On-Chain Deposit & Blockchain Security:**
   - Verifies BSC RPC log scanning via `depositWatcherService`.
   - Confirms that deposits are ONLY credited on confirmed blockchain transfers.

4. **Telegram HMAC-SHA256 Auth Verification:**
   - Validates `x-telegram-init-data` cryptographic signature against the bot token.
   - Prevents user ID spoofing and IDOR attacks.

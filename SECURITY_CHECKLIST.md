# 🛡️ CRYPTOMINE ONGOING SECURITY CHECKLIST

### Daily & Operational Maintenance
- [ ] **Hot Wallet Balance Monitoring:** Keep only the minimal required daily withdrawal payout amount in the hot payout wallet to minimize exposure.
- [ ] **Admin Bot Audits:** Check the admin notification channel for any flagged multi-account attempts or unexpected deposit spikes.
- [ ] **Database Backups:** Ensure automated daily Neon PostgreSQL branch snapshots are enabled.

### Code & Environment Deployment Checklist
- [x] Ensure `.env` is never committed to Git (`.gitignore` verified).
- [x] Verify `.env.example` contains only non-sensitive placeholder values.
- [x] All database queries use parameterized SQL inputs (`$1`, `$2`, etc.).
- [x] Real deposits require on-chain BSC block confirmations.
- [x] All withdrawal deductions are atomic with database-level concurrency locking.
- [x] Cryptographic verification enabled for Telegram WebApp `initData`.
- [x] API rate limiting (120 req/min) and security HTTP headers active.
- [x] Debug/Fast-forward endpoints permanently locked down in production.
- [x] Admin panel strictly restricted to authorized administrator (`@ownerof421`).

### Quick Security Test Command
To verify system security locally at any time, run:
```bash
node scratch/security_verification_test.js
```

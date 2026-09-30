---
name: telegram-miniapp-test
description: >-
  Testing and validation procedures for Telegram Mini App frontend, Main User Bot, Admin Notification Bot, and referral tracking.
---

# 🤖 Telegram Bot & Mini App Testing Skill

This skill provides step-by-step procedures for testing Telegram Mini App integrations and bot workflows.

## Workflows

### 1. Referral Flow Verification
- When a user enters `/start REF-12345` in the Main Bot, verify:
  - Bot sends welcome message + **💎 Mint NFT** button.
  - No referral is counted at the bot stage.
  - When the user launches the Mini App (`💎 Mint NFT`), verify:
    - Mini App transmits referral parameter (`x-telegram-start-param`) and device fingerprint (`x-device-fingerprint`).
    - Referrer receives `🎉 New Referral Joined! 👥` notification.
    - +1 Mystery Gift box is added to the referrer's account.

### 2. Multi-Account / Anti-Multi Device Ban Testing
- Verify that if two Telegram accounts access the Mini App from the same device fingerprint or IP:
  - Second account is automatically banned with reason: `Multi-Account Abuse`.
  - Admin Bot receives real-time security alert with user IDs, IP, and fingerprint.
  - User sees the banned screen with support contact link (`@CryptoMint_Support_bot`).

### 3. Withdrawal Alert & Admin Approval Workflow
- When user submits a withdrawal:
  - User receives 1-line confirmation in Telegram.
  - Admin Bot sends rich alert with **[Approve & Payout]**, **[Reject]**, and **[🚫 Ban User]** action buttons.
  - Approving triggers BSC on-chain BEP-20 payout and posts transaction receipt with BscScan link.

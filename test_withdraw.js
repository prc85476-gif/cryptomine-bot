const dbService = require('./src/services/dbService');
const telegramBotService = require('./src/services/telegramBotService');
const mainBotService = require('./src/services/mainBotService');
require('dotenv').config();

async function runTest() {
  console.log('🚀 Running Test Withdrawal for User ID: 8829204942...');

  const userId = 8829204942;
  const username = 'AdminUser';
  const name = 'Admin Test';

  // 1. Ensure user exists with sufficient balance
  const user = await dbService.getUser(userId, {
    username,
    firstName: name,
    lastName: ''
  });

  if (user.balance < 1.0) {
    await dbService.updateUser(userId, {
      balance: parseFloat((user.balance + 10.0).toFixed(4))
    });
    console.log('✅ Credited +10 USDT to user balance for testing.');
  }

  const withdrawAmt = 0.38;
  const fee = 0.005;
  const finalReceived = parseFloat((withdrawAmt - fee).toFixed(4));
  const address = '0x71C8705a2B88e6082570081d4511200155bB04d9';
  const selectedNet = 'USDT BEP20';
  const txId = `tx-${Date.now()}`;

  // 2. Add transaction to DB
  await dbService.addTransaction({
    id: txId,
    userId: userId,
    type: `Withdraw (${selectedNet})`,
    amount: `-${withdrawAmt.toFixed(4)} USDT`,
    recipientAddress: address,
    network: selectedNet,
    status: 'Pending',
    positive: false,
    date: 'Processing'
  });

  // 3. Initialize bot services if not already
  telegramBotService.init();
  mainBotService.init();

  // Give 1 second for bot connection
  await new Promise(r => setTimeout(r, 1000));

  // 4. Send instant 1-line pending notification to USER's bot
  console.log('📤 Sending 1-line pending alert to User Bot...');
  await mainBotService.notifyUserWithdrawalPending(userId, withdrawAmt);

  // 5. Send clean withdrawal request alert to ADMIN Bot
  console.log('📤 Sending pending withdrawal request to Admin Bot with Approve/Reject buttons...');
  await telegramBotService.notifyWithdrawalRequest({
    txId,
    userId,
    username,
    amount: withdrawAmt,
    fee,
    finalReceived,
    address,
    network: selectedNet
  });

  console.log('🎉 Test withdrawal request dispatched successfully!');
  console.log('👉 Please check your Telegram:');
  console.log('   1. Main Bot (@CryptoMine): 1-line pending notification');
  console.log('   2. Admin Bot (@acryptomintadminwithdraw2bot): Clean approval card with [Approve & Pay]');
}

runTest().then(() => {
  setTimeout(() => process.exit(0), 3000);
}).catch(err => {
  console.error('❌ Error during test:', err);
  process.exit(1);
});

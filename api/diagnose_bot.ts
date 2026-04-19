import { getTelegrafBot } from './telegram_bot.js';
import * as dotenv from 'dotenv';
dotenv.config();

async function diagnose() {
  console.log('🔍 Starting Bot Diagnosis...');
  
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('❌ ERROR: TELEGRAM_BOT_TOKEN is missing in .env');
    return;
  }
  console.log('✅ TOKEN found.');

  const bot = getTelegrafBot();
  if (!bot) {
    console.error('❌ ERROR: Bot failed to initialize. Check setupBotLogic codes.');
    return;
  }
  console.log('✅ Bot instance created.');

  try {
    const me = await bot.telegram.getMe();
    console.log(`✅ Connection to Telegram OK: @${me.username}`);
    
    const webhook = await bot.telegram.getWebhookInfo();
    console.log('📊 Webhook Status:', JSON.stringify(webhook, null, 2));
    
    if (webhook.url) {
      console.log('⚠️ Warning: Webhook is active. Polling bot here will NOT receive messages.');
    } else {
      console.log('ℹ️ No webhook active. Bot should be in POLLING mode.');
    }
  } catch (e: any) {
    console.error('❌ ERROR connecting to Telegram API:', e.message);
  }
}

diagnose();

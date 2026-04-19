import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';

dotenv.config();

async function reset() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN not found in environment.');
    process.exit(1);
  }

  const bot = new Telegraf(token);
  try {
    console.log('📡 Attempting to delete webhook...');
    await bot.telegram.deleteWebhook();
    console.log('✅ Webhook deleted! The local bot should now be able to start polling.');
    
    const info = await bot.telegram.getWebhookInfo();
    console.log('ℹ️ Current Webhook Info:', JSON.stringify(info, null, 2));
  } catch (e) {
    console.error('❌ Failed to reset webhook:', e);
  }
}

reset();

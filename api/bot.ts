import { bot } from '../telegram_bot';

// Vercel Serverless Function Handler
export default async (req: any, res: any) => {
  try {
    if (req.method === 'POST') {
      if (bot) {
        try {
          await bot.handleUpdate(req.body);
        } catch (handleErr) {
          console.error('Error within bot.handleUpdate:', handleErr);
          // Crucial: do NOT throw or fail. If we return 500, Telegram will retry this exact same 
          // bad update forever and paralyze the bot. We must acknowledge it to clear the queue.
        }
      } else {
        console.warn('Bot is not initialized. Check Env variables.');
      }
      return res.status(200).send('OK');
    } else {
      return res.status(200).send('EchoVox Bot Webhook is active (Vercel).');
    }
  } catch (err) {
    console.error('Outer Webhook error:', err);
    // Still return 200 to Telegram so it doesn't loop
    return res.status(200).send('Error ignored to prevent Telegram retry loop');
  }
};

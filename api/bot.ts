import { bot } from '../telegram_bot';

// Vercel Serverless Function Handler
export default async (req: any, res: any) => {
  try {
    if (req.method === 'POST') {
      if (bot) {
        await bot.handleUpdate(req.body);
      } else {
        console.warn('Bot is not initialized. Check Env variables.');
      }
      res.status(200).send('OK');
    } else {
      res.status(200).send('EchoVox Bot Webhook is active (Vercel).');
    }
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Error');
  }
};

import { bot } from '../telegram_bot';

export default async (req: any, res: any) => {
  try {
    if (req.method === 'POST') {
      if (!req.body) {
         console.error('Empty body received');
         return res.status(200).send('Empty body ignored');
      }

      if (bot) {
        try {
          // Emergency Queue Clearer (5 minutes)
          const msgDate = req.body?.message?.date || req.body?.callback_query?.message?.date;
          const now = Math.floor(Date.now() / 1000);
          if (msgDate && (now - msgDate > 300)) {
             console.log('Skipping old stuck message:', msgDate);
             return res.status(200).send('OK');
          }

          console.log('Processing update ID:', req.body.update_id);
          await bot.handleUpdate(req.body);
        } catch (handleErr) {
          console.error('Telegraf Handle Error:', handleErr);
        }
      } else {
        console.warn('Bot is not initialized. Check Env variables.');
      }
      return res.status(200).send('OK');
    } else {
      return res.status(200).send('EchoVox Bot Webhook is active (Full try-catch).');
    }
  } catch (err) {
    console.error('Outer Webhook error:', err);
    return res.status(200).send('Error ignored');
  }
};

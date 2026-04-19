import fetch from 'node-fetch';

export default async (req: any, res: any) => {
  try {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!BOT_TOKEN) {
      return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is missing in Vercel Environment Variables.' });
    }

    // Get the domain Vercel is running on from the request headers
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (!host) {
        return res.status(500).json({ error: 'Could not determine host domain.' });
    }

    const webhookUrl = `https://${host}/api/bot`;
    const tgUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`;

    console.log('Setting webhook to:', webhookUrl);

    // Call Telegram API to set the webhook
    const response = await fetch(tgUrl);
    const data = await response.json();

    if (data.ok) {
      res.status(200).send(`
        <html>
          <body style="font-family: sans-serif; padding: 40px; background: #111; color: #fff; text-align: center;">
            <h1 style="color: #4CAF50;">✅ Webhook Set Successfully!</h1>
            <p>Your bot is now permanently connected to Vercel.</p>
            <p style="color: #888;">Webhook URL: <b>${webhookUrl}</b></p>
            <p>You can close this page and start chatting with your bot in Telegram.</p>
          </body>
        </html>
      `);
    } else {
      res.status(500).json({ error: 'Telegram API Error', details: data });
    }
  } catch (err: any) {
    console.error('Error setting webhook:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
};

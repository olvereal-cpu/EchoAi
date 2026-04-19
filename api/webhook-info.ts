import fetch from 'node-fetch';

export default async (req: any, res: any) => {
  try {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!BOT_TOKEN) {
      return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is missing.' });
    }

    const tgUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;

    const response = await fetch(tgUrl);
    const data = await response.json();

    res.status(200).send(`
      <html>
        <body style="font-family: monospace; padding: 40px; background: #111; color: #fff;">
          <h2 style="color: #4CAF50;">Telegram Webhook Status Diagnostics</h2>
          <pre style="background: #222; padding: 20px; border-radius: 8px; font-size: 14px; overflow-x: auto;">
${JSON.stringify(data, null, 2)}
          </pre>
          <p><b>pending_update_count</b>: How many messages Telegram is trying to send to Vercel but failed.</p>
          <p><b>last_error_message</b>: The actual error Vercel gave back to Telegram if it crashed.</p>
        </body>
      </html>
    `);

  } catch (err: any) {
    console.error('Error fetching webhook info:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
};

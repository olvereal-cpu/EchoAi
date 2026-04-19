import fetch from 'node-fetch';

export default async (req: any, res: any) => {
  try {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const GEMINI_KEYS = process.env.GEMINI_API_KEYS || process.env.VITE_GEMINI_API_KEYS || process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';

    let webhookInfo: any = { error: "BOT_TOKEN IS MISSING in Vercel Environment Variables!" };
    
    if (BOT_TOKEN) {
      const tgUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
      const response = await fetch(tgUrl);
      webhookInfo = await response.json();
    }

    res.status(200).send(`
      <html>
        <body style="font-family: monospace; padding: 40px; background: #111; color: #fff;">
          <h2 style="color: #4CAF50;">EchoVox Bot Diagnostics</h2>
          
          <div style="background: #333; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="margin-top: 0;">Environment Variables Check:</h3>
            <p><b>TELEGRAM_BOT_TOKEN:</b> ${BOT_TOKEN ? '✅ SET (' + BOT_TOKEN.substring(0, 8) + '...)' : '❌ MISSING in Vercel Settings'}</p>
            <p><b>GEMINI_API_KEYS:</b> ${GEMINI_KEYS ? '✅ SET' : '❌ MISSING in Vercel Settings'}</p>
          </div>

          <h3 style="color: #4CAF50;">Telegram Webhook Info</h3>
          <pre style="background: #222; padding: 20px; border-radius: 8px; font-size: 14px; overflow-x: auto;">
${JSON.stringify(webhookInfo, null, 2)}
          </pre>
          <p><b>pending_update_count</b>: Must be 0. If it's growing, messages are stuck.</p>
          <p><b>last_error_message</b>: The last fatal error blocking Telegram.</p>
        </body>
      </html>
    `);

  } catch (err: any) {
    console.error('Error fetching webhook info:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
};

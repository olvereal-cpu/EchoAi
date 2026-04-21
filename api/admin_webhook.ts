import { getTelegrafBot } from "./telegram_bot.js";

export default async (req: any, res: any) => {
  try {
    const bot = getTelegrafBot();
    if (!bot) {
      return res.status(500).json({ error: "Bot not initialized" });
    }
    
    if (req.method === 'POST') {
      if (req.body.action === 'delete') {
        await bot.telegram.deleteWebhook();
        return res.status(200).json({ success: true, message: "Webhook deleted" });
      }
      
      if (req.body.action === 'set') {
        const projectUrl = process.env.PROJECT_URL || process.env.APP_URL?.replace('https://', '').replace(/\/$/, '') || req.headers.host || '';
        if (!projectUrl) {
          return res.status(400).json({ error: "PROJECT_URL or APP_URL is missing in environment variables" });
        }
        const webhookUrl = `https://${projectUrl}/api/telegram_bot`;
        await bot.telegram.setWebhook(webhookUrl);
        return res.status(200).json({ success: true, message: `Webhook set to ${webhookUrl}` });
      }
    }

    const info = await bot.telegram.getWebhookInfo();
    res.status(200).json(info);
  } catch (e: any) {
    console.error("Admin Webhook Error:", e);
    res.status(500).json({ error: e.message });
  }
};

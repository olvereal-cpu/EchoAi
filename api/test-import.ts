export default async (req: any, res: any) => {
  try {
    const tgBot = await import('./telegram_bot.js') || await import('./telegram_bot.ts') || await import('./telegram_bot');
    res.status(200).json({ status: "Success", bot_initialized: !!tgBot.bot });
  } catch (err: any) {
    res.status(500).json({ error: "Import Failed", details: err.message, stack: err.stack });
  }
};

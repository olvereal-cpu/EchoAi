import { bot } from './telegram_bot';

export default async (req: any, res: any) => {
  try {
    res.status(200).json({ status: "Success", bot_initialized: !!bot });
  } catch (err: any) {
    res.status(500).json({ error: "Import Failed", details: err.message, stack: err.stack });
  }
};

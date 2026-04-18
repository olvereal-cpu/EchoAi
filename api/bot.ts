import { Telegraf } from 'telegraf';
import { GoogleGenAI, Modality } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

if (!BOT_TOKEN || !GEMINI_KEY) {
  // Graceful failure for Vercel build phase if keys aren't present
  console.warn('⚠️ Missing BOT_TOKEN or GEMINI_KEY in API Route');
}

const bot = new Telegraf(BOT_TOKEN || '');
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY || '' });

// Basic Handlers (minimal for Vercel demo, we should ideally share logic)
bot.start((ctx) => ctx.reply('EchoVox Pro Bot is Active! (Webhook Mode)'));

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  try {
    await ctx.sendChatAction('record_voice');
    const response = await (ai as any).models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio && base64Audio.length > 100) { // Check for valid data length
      const buffer = Buffer.from(base64Audio, 'base64');
      // Send as document to avoid OGG playback issues/strict format checks
      await ctx.replyWithDocument({ source: buffer, filename: 'audio.ogg' }, { caption: 'Готовая озвучка' });
    } else {
      console.error('TTS returned empty or invalid audio:', response);
      ctx.reply('⚠️ Ошибка: синтезатор вернул пустые данные.');
    }
  } catch (err) {
    console.error(err);
    ctx.reply('⚠️ Ошибка синтеза.');
  }
});

// Vercel Serverless Function Handler
export default async (req: any, res: any) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } else {
      res.status(200).send('Bot is running...');
    }
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Error');
  }
};

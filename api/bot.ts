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
    if (base64Audio && base64Audio.length > 100) { 
      // Add WAV header to raw PCM data
      const binaryString = Buffer.from(base64Audio, 'base64').toString('binary');
      const len = binaryString.length;
      const buffer = Buffer.alloc(len);
      for (let i = 0; i < len; i++) buffer[i] = binaryString.charCodeAt(i);
      
      const numChannels = 1;
      const sampleRate = 24000;
      const bitsPerSample = 16;
      const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
      const blockAlign = (numChannels * bitsPerSample) / 8;
      const dataSize = buffer.length;
      const chunkSize = 36 + dataSize;
      
      const wavHeader = Buffer.alloc(44);
      wavHeader.write('RIFF', 0);
      wavHeader.writeUInt32LE(chunkSize, 4);
      wavHeader.write('WAVE', 8);
      wavHeader.write('fmt ', 12);
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20); // PCM
      wavHeader.writeUInt16LE(numChannels, 22);
      wavHeader.writeUInt32LE(sampleRate, 24);
      wavHeader.writeUInt32LE(byteRate, 28);
      wavHeader.writeUInt16LE(blockAlign, 32);
      wavHeader.writeUInt16LE(bitsPerSample, 34);
      wavHeader.write('data', 36);
      wavHeader.writeUInt32LE(dataSize, 40);
      
      const finalWav = Buffer.concat([wavHeader, buffer]);
      await ctx.replyWithDocument({ source: finalWav, filename: 'audio.wav' }, { caption: 'Готовая озвучка (WAV)' });
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

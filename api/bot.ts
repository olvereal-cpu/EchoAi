import { Telegraf } from 'telegraf';
import { GoogleGenAI, Modality } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Support a comma-separated list of keys, falling back to singular standard keys
const keysString = process.env.GEMINI_API_KEYS || process.env.VITE_GEMINI_API_KEYS || process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
const API_KEYS = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);

if (!BOT_TOKEN || API_KEYS.length === 0) {
  // Graceful failure for Vercel build phase if keys aren't present
  console.warn('⚠️ Missing BOT_TOKEN or GEMINI_API_KEY(S) in API Route');
}

const bot = new Telegraf(BOT_TOKEN || '');

// Basic Handlers
bot.start((ctx) => ctx.reply('EchoVox Pro Bot is Active! (Webhook Mode)'));

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  if (API_KEYS.length === 0) {
    return ctx.reply('⚠️ Ошибка: На сервере не задан ни один API-ключ Gemini.');
  }

  try {
    await ctx.sendChatAction('record_voice');

    // Shuffle array so requests are randomly distributed across all keys
    const shuffledKeys = [...API_KEYS].sort(() => 0.5 - Math.random());
    let response: any = null;
    let lastError: any = null;
    let success = false;

    // Retry Loop: Try each key. If 429 Quota Exceeded happens, continue to next key.
    for (let i = 0; i < shuffledKeys.length; i++) {
        const currentKey = shuffledKeys[i];
        try {
            const ai = new GoogleGenAI({ apiKey: currentKey });
            response = await (ai as any).models.generateContent({
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
            success = true;
            break; // Success! Break out of the retry loop.
        } catch (apiErr: any) {
             const status = apiErr?.status || apiErr?.response?.status;
             const isQuotaError = status === 429 || apiErr?.message?.includes('429') || apiErr?.message?.includes('Quota exceeded');
             if (isQuotaError) {
                 console.warn(`Key ${i + 1}/${shuffledKeys.length} hit quota limit. Trying next...`);
                 lastError = apiErr;
                 continue; // Target hit quota limit, try next fallback key
             } else {
                 console.error(`Unexpected API error with key ${i + 1}:`, apiErr);
                 lastError = apiErr;
                 break; // Unrelated error (e.g., bad request, text too long), stop retrying.
             }
        }
    }

    if (!success) {
      console.error('All keys exhausted or failed:', lastError);
      return ctx.reply('⚠️ Ошибка: Все доступные API-ключи исчерпали свой лимит (квоту). Попробуйте завтра или добавьте новые ключи.');
    }

    const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    const base64Audio = inlineData?.data;

    if (base64Audio && base64Audio.length > 100) { 
      // Fast conversion of base64 to Buffer
      const pcmBuffer = Buffer.from(base64Audio, 'base64');
      
      const numChannels = 1;
      const sampleRate = 24000;
      const bitsPerSample = 16;
      const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
      const blockAlign = (numChannels * bitsPerSample) / 8;
      const dataSize = pcmBuffer.length;
      const chunkSize = 36 + dataSize;
      
      const wavHeader = Buffer.alloc(44);
      wavHeader.write('RIFF', 0);
      wavHeader.writeUInt32LE(chunkSize, 4);
      wavHeader.write('WAVE', 8);
      wavHeader.write('fmt ', 12);
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20); // PCM format chunk
      wavHeader.writeUInt16LE(numChannels, 22);
      wavHeader.writeUInt32LE(sampleRate, 24);
      wavHeader.writeUInt32LE(byteRate, 28);
      wavHeader.writeUInt16LE(blockAlign, 32);
      wavHeader.writeUInt16LE(bitsPerSample, 34);
      wavHeader.write('data', 36);
      wavHeader.writeUInt32LE(dataSize, 40);
      
      const finalWav = Buffer.concat([wavHeader, pcmBuffer]);
      
      // Send as document since replyWithAudio strict fails on WAV, and replyWithVoice fails on PCM
      await ctx.replyWithDocument({ source: finalWav, filename: 'voice.wav' }, { caption: '🔊 Готовая озвучка' });
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

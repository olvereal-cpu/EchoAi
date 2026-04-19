import { Telegraf, Context, Markup } from 'telegraf';
import { GoogleGenAI, Modality } from '@google/genai';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// --- Configuration ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const REQ_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID;
const CHANNEL_LINK = process.env.CHANNEL_LINK || 'https://t.me/ais_build';

let bot: Telegraf | null = null;

if (!BOT_TOKEN) {
  console.warn('⚠️ Warning: Missing TELEGRAM_BOT_TOKEN. Telegram bot is disabled.');
} else {
  bot = new Telegraf(BOT_TOKEN);
  setupBotLogic(bot);
}

function setupBotLogic(bot: Telegraf) {
  const USERS_FILE = path.join(process.cwd(), 'users.json');

  // --- Types ---
  interface UserData {
    id: number;
    username?: string;
    name?: string;
    voice: string;
    scenario?: string;
    joinedAt: string;
  }

  // --- DB Helpers ---
  function loadUsers(): Record<number, UserData> {
    try {
      if (fs.existsSync(USERS_FILE)) {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
      }
    } catch (e) {
      console.warn('Error reading users file:', e);
    }
    return {};
  }

  function saveUser(user: Partial<UserData> & { id: number }) {
    const users = loadUsers();
    users[user.id] = { ...users[user.id], ...user } as UserData;
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (e) {
      console.warn('Could not save user, likely Read-Only filesystem on Vercel:', e.message);
    }
  }

  // --- Keyboards ---
  const getMainMenu = () => {
    return Markup.keyboard([
      ['🎙️ Выбрать голос', '📝 Сценарии'],
      ['⭐️ Поддержать проект', 'ℹ️ Помощь']
    ]).resize();
  };

  const getVoiceMenu = () => {
    return Markup.inlineKeyboard([
      [Markup.button.callback('Kore (Жен)', 'voice_Kore'), Markup.button.callback('Puck (Муж)', 'voice_Puck')],
      [Markup.button.callback('Charon', 'voice_Charon'), Markup.button.callback('Fenrir', 'voice_Fenrir')],
      [Markup.button.callback('Zephyr', 'voice_Zephyr')]
    ]);
  };

  const getScenarioMenu = () => {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🎙️ Новости', 'scen_news'), Markup.button.callback('📖 Книга', 'scen_book')],
      [Markup.button.callback('📱 Сторис', 'scen_stories'), Markup.button.callback('⚡ Shorts', 'scen_shorts')],
      [Markup.button.callback('💬 Диалог', 'scen_dialogue'), Markup.button.callback('❌ Сброс', 'scen_none')]
    ]);
  };

  // --- Middleware: Sub Check ---
  const checkSub = async (ctx: Context, next: () => Promise<void>) => {
    if (!REQ_CHANNEL_ID || ctx.from?.id === ADMIN_ID) return next();
    
    try {
      const member = await ctx.telegram.getChatMember(REQ_CHANNEL_ID, ctx.from!.id);
      if (['member', 'administrator', 'creator'].includes(member.status)) {
        return next();
      }
    } catch (e) {
      console.error('Sub check error:', e);
    }

    return ctx.reply(`⚠️ Для работы с ботом необходимо подписаться на наш канал:\n${CHANNEL_LINK}`, 
      Markup.inlineKeyboard([[Markup.button.url('✅ Подписаться', CHANNEL_LINK)]]));
  };

  // --- Handlers ---
  bot.start(async (ctx) => {
    const user: UserData = {
      id: ctx.from.id,
      username: ctx.from.username,
      name: ctx.from.first_name,
      voice: 'Kore',
      joinedAt: new Date().toISOString()
    };
    saveUser(user);
    await ctx.reply('🚀 Добро пожаловать в EchoVox.pro! Я превращаю текст в профессиональную озвучку. Просто напишите мне текст, и я пришлю вам готовый аудиофайл.', getMainMenu());
  });

  bot.command('admin', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply('🛠 Админ-панель EchoVox', Markup.inlineKeyboard([
      [Markup.button.callback('📊 Статистика', 'admin_stats')],
      [Markup.button.callback('📥 Скачать базу (TXT)', 'admin_export')],
      [Markup.button.callback('📢 Рассылка', 'admin_broadcast')]
    ]));
  });

  bot.hears('🎙️ Выбрать голос', (ctx) => ctx.reply('Выберите желаемый голос:', getVoiceMenu()));
  bot.hears('📝 Сценарии', (ctx) => ctx.reply('Выберите стиль озвучки:', getScenarioMenu()));
  bot.hears('ℹ️ Помощь', (ctx) => ctx.reply('ℹ️ **Справка:**\nОтправьте любой текст боту, и он преобразует его в речь (до 1000 слов). Вы можете выбрать разные голоса или применить стиль озвучки в меню "Сценарии".\n\nМодель: Gemini Flash Voice TTS\nРазработчик: AI Studio Build'));

  bot.action(/voice_(.+)/, (ctx) => {
    const voice = ctx.match[1];
    saveUser({ id: ctx.from!.id, voice });
    ctx.answerCbQuery();
    ctx.reply(`✅ Выбран голос: ${voice}`);
  });

  bot.action(/scen_(.+)/, (ctx) => {
    const scen = ctx.match[1];
    saveUser({ id: ctx.from!.id, scenario: scen === 'none' ? undefined : scen });
    ctx.answerCbQuery();
    ctx.reply(`✅ Выбран сценарий: ${scen === 'none' ? 'Сброшен' : scen}`);
  });

  bot.hears('⭐️ Поддержать проект', (ctx) => {
    // Reply with a message instead of broken invoice if provider_token is missing
    ctx.reply('⭐️ **Спасибо за поддержку!**\nПроект существует благодаря энтузиазму разработчиков. Вы можете поддержать нас, поделившись этим ботом с друзьями!');
  });

  bot.action('admin_stats', (ctx) => {
    const count = Object.keys(loadUsers()).length;
    ctx.reply(`👥 Всего пользователей в базе: ${count}`);
  });

  bot.action('admin_export', async (ctx) => {
    const users = loadUsers();
    const content = Object.values(users).map(u => `${u.id} | @${u.username || 'n/a'} | ${u.name}`).join('\n');
    const filePath = path.join(process.cwd(), 'users_export.txt');
    fs.writeFileSync(filePath, content);
    await ctx.replyWithDocument({ source: filePath, filename: 'users.txt' });
    fs.unlinkSync(filePath);
  });

  bot.action('admin_broadcast', (ctx) => {
    ctx.reply('Пришлите сообщение для рассылки (текст).');
    bot.on('text', async (bCtx, next) => {
      if (bCtx.from.id !== ADMIN_ID) return next();
      const users = loadUsers();
      let sent = 0;
      for (const uid of Object.keys(users)) {
        try {
          await bCtx.telegram.sendMessage(uid, bCtx.message.text);
          sent++;
        } catch (e) {}
      }
      bCtx.reply(`📢 Рассылка завершена. Доставлено: ${sent}`);
    });
  });

  bot.on('text', checkSub, async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    try {
      await ctx.sendChatAction('record_voice');
      const users = loadUsers();
      const user = users[ctx.from!.id] || { voice: 'Kore', scenario: undefined } as Partial<UserData>;
      
      const styles: Record<string, string> = {
        news: 'Speak as a news anchor',
        book: 'Narrate as an audiobook',
        stories: 'Speak as a happy influencer',
        shorts: 'Fast and high energy',
        dialogue: 'Synthesize as a dialogue'
      };

      let prompt = text;
      if (user.scenario && styles[user.scenario]) {
        prompt = `${styles[user.scenario]}: ${text}`;
      }

      const keysString = process.env.GEMINI_API_KEYS || process.env.VITE_GEMINI_API_KEYS || process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
      const API_KEYS = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);

      if (API_KEYS.length === 0) {
        return await ctx.reply('⚠️ Ошибка: На сервере не задан ни один API-ключ Gemini.');
      }

      const shuffledKeys = [...API_KEYS].sort(() => 0.5 - Math.random());
      let response: any = null;
      let lastError: any = null;
      let success = false;

      for (let i = 0; i < shuffledKeys.length; i++) {
          const currentKey = shuffledKeys[i];
          try {
              const currentAi = new GoogleGenAI({ apiKey: currentKey });
              response = await (currentAi as any).models.generateContent({
                model: "gemini-3.1-flash-tts-preview",
                contents: [{ parts: [{ text: prompt }] }],
                config: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: user.voice || 'Kore' },
                    },
                  },
                },
              });
              success = true;
              break;
          } catch (apiErr: any) {
               const status = apiErr?.status || apiErr?.response?.status;
               const isQuotaError = status === 429 || apiErr?.message?.includes('429') || apiErr?.message?.includes('Quota exceeded');
               if (isQuotaError) {
                   console.warn(`Key ${i + 1}/${shuffledKeys.length} hit quota limit. Trying next...`);
                   lastError = apiErr;
                   continue;
               } else {
                   console.error(`Unexpected API error with key ${i + 1}:`, apiErr);
                   lastError = apiErr;
                   break;
               }
          }
      }

      if (!success) {
        console.error('All keys exhausted or failed:', lastError);
        return await ctx.reply('⚠️ Ошибка: Все доступные API-ключи исчерпали свой лимит (квоту).');
      }

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
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
        
        await ctx.replyWithDocument({ source: finalWav, filename: 'voice.wav' }, { caption: '🔊 Готовая озвучка' });
      } else {
         return await ctx.reply('⚠️ Ошибка: синтезатор вернул пустые данные.');
      }
    } catch (err) {
      console.error(err);
      await ctx.reply('⚠️ Ошибка синтеза.');
    }
  });

  // Start polling only if strictly forced (disabled by default to prevent stealing Webhook from Vercel)
  if (process.env.LOCAL_DEBUG_POLLING === 'true') {
     bot.launch().then(() => console.log('✅ Polling Bot started.'));
  } else {
     console.log('ℹ️ Local polling disabled. Bot expects to run via Vercel Webhook in production.');
  }
}

export { bot };

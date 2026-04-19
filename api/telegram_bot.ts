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
  const USERS_FILE = path.join('/tmp', 'users.json');
  // Fallback memory state since Vercel might destroy /tmp files on cold starts
  const memoryDB: Record<number, UserData> = {};

  // --- Types ---
  interface UserData {
    id: number;
    username?: string;
    name?: string;
    voice: string;
    scenario?: string;
    targetLang?: string;
    charsGenerated?: number;
    audioCount?: number;
    joinedAt: string;
  }

  // --- DB Helpers ---
  function loadUsers(): Record<number, UserData> {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const diskData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
        Object.assign(memoryDB, diskData);
      }
    } catch (e) {
      console.warn('Error reading users file:', e);
    }
    return memoryDB;
  }

  function saveUser(user: Partial<UserData> & { id: number }) {
    const users = loadUsers();
    users[user.id] = { ...users[user.id], ...user } as UserData;
    memoryDB[user.id] = users[user.id];
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (e: any) {
      // Vercel /tmp write shouldn't fail, but if it does, it's saved in memoryDB
    }
  }

  // --- Keyboards ---
  const getMainMenu = () => {
    return Markup.keyboard([
      ['🎙️ Выбрать голос', '🎭 Эмоции / Роли'],
      ['🌍 Переводчик', '⭐️ Поддержать проект'],
      ['ℹ️ Помощь']
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
      [Markup.button.callback('🤫 Шепот (ASMR)', 'scen_whisper'), Markup.button.callback('🤬 Злобно', 'scen_angry')],
      [Markup.button.callback('🤪 Сарказм', 'scen_sarcastic'), Markup.button.callback('❌ Обычный голос', 'scen_none')]
    ]);
  };

  const getLangMenu = () => {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🇬🇧 Английский', 'lang_EN'), Markup.button.callback('🇪🇸 Испанский', 'lang_ES')],
      [Markup.button.callback('🇫🇷 Французский', 'lang_FR'), Markup.button.callback('🇩🇪 Немецкий', 'lang_DE')],
      [Markup.button.callback('🇯🇵 Японский', 'lang_JA'), Markup.button.callback('❌ Отключить', 'lang_none')]
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

  bot.hears('🎙️ Выбрать голос', (ctx) => ctx.reply('Выберите желаемый голос:\n*Совет: Нажмите на любую кнопку для предпрослушивания голоса.*', getVoiceMenu()));
  bot.hears('🎭 Эмоции / Роли', (ctx) => ctx.reply('Выберите стиль озвучки:', getScenarioMenu()));
  bot.hears('🌍 Переводчик', (ctx) => ctx.reply('🌐 Выберите язык для автоперевода (текст сначала переведут, а потом озвучат):', getLangMenu()));
  bot.hears('ℹ️ Помощь', (ctx) => ctx.reply('ℹ️ **Справка:**\nОтправьте любой текст боту, и он преобразует его в речь. Вы можете загрузить текстовый файл (.txt) - я разобью его на аудио.\n\nМодель: Gemini Flash Voice TTS\nРазработчик: AI Studio Build'));

  bot.action(/voice_(.+)/, async (ctx) => {
    const voice = ctx.match[1];
    saveUser({ id: ctx.from!.id, voice });
    await ctx.answerCbQuery(`Выбран: ${voice}`);
    await ctx.reply(`✅ Голос изменен на **${voice}**. Генерирую предпрослушивание...`, {parse_mode: 'Markdown'});
    
    // Auto-generate preview
    const keysString = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
    const API_KEYS = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
    if(API_KEYS.length > 0) {
        try {
            await ctx.sendChatAction('record_voice');
            const ai = new GoogleGenAI({ apiKey: API_KEYS[0] });
            const resp = await (ai as any).models.generateContent({
              model: "gemini-3.1-flash-tts-preview",
              contents: [{ parts: [{ text: `Привет! Это голос ${voice}. Я готов озвучить любой твой текст.` }] }],
              config: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
              },
            });
            const base64Audio = resp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                const audioBuffer = Buffer.from(base64Audio, 'base64');
                await ctx.replyWithVoice({ source: audioBuffer });
            }
        } catch (e) {
            console.warn("Failed preview", e);
        }
    }
  });

  bot.action(/scen_(.+)/, async (ctx) => {
    const scen = ctx.match[1];
    saveUser({ id: ctx.from!.id, scenario: scen === 'none' ? undefined : scen });
    
    const msgs: Record<string, string> = {
      news: 'Диктор новостей 🎙️',
      book: 'Аудиокнига 📖',
      whisper: 'Мягкий шепот 🤫',
      angry: 'Злобно и экспрессивно 🤬',
      sarcastic: 'Сарказм 🤪',
      none: 'Обычный голос ❌'
    };
    
    await ctx.answerCbQuery();
    await ctx.reply(`✅ Выбрана эмоция: **${msgs[scen] || scen}**\nВсе следующие сообщения будут озвучиваться в этом стиле.`, {parse_mode: "Markdown"});
  });

  bot.action(/lang_(.+)/, async (ctx) => {
    const lang = ctx.match[1];
    saveUser({ id: ctx.from!.id, targetLang: lang === 'none' ? undefined : lang });
    
    const langNames: Record<string, string> = {
      EN: 'Английский 🇬🇧', ES: 'Испанский 🇪🇸', FR: 'Французский 🇫🇷',
      DE: 'Немецкий 🇩🇪', JA: 'Японский 🇯🇵'
    };
    
    await ctx.answerCbQuery();
    if(lang === 'none') {
        await ctx.reply(`❌ Переводчик отключен. Озвучиваю оригинальный текст.`);
    } else {
        await ctx.reply(`✅ Автоперевод включен. Теперь весь ваш текст будет переводиться на **${langNames[lang]}** перед озвучкой.`, {parse_mode: 'Markdown'});
    }
  });

  bot.hears('⭐️ Поддержать проект', (ctx) => {
    ctx.reply('⭐️ **Спасибо за поддержку!**\nВы можете поддержать нас, поделившись этим ботом с друзьями!');
  });

  bot.action('admin_stats', (ctx) => {
    const users = loadUsers();
    const count = Object.keys(users).length;
    let totalChars = 0;
    let totalAudio = 0;
    
    Object.values(users).forEach(u => {
        if(u.charsGenerated) totalChars += u.charsGenerated;
        if(u.audioCount) totalAudio += u.audioCount;
    });
    
    ctx.reply(`📊 **Статистика Бота:**\n\n👥 Всего пользователей: ${count}\n🔡 Сгенерировано символов: ${totalChars}\n🎧 Аудио сгенерировано: ${totalAudio}`, {parse_mode: 'Markdown'});
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
        news: 'Read this in a professional news anchor tone',
        book: 'Narrate this warmly like an audiobook',
        whisper: 'Read this in a very soft whisper, ASMR style',
        angry: 'Read this loudly and with deep anger',
        sarcastic: 'Read this with a sarcastic and playful tone',
        dialogue: 'Read this as a natural dialogue'
      };
      
      const langNames: Record<string, string> = {
        EN: 'English', ES: 'Spanish', FR: 'French',
        DE: 'German', JA: 'Japanese'
      };

      const keysString = process.env.GEMINI_API_KEYS || process.env.VITE_GEMINI_API_KEYS || process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
      const API_KEYS = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);

      if (API_KEYS.length === 0) {
        return await ctx.reply('⚠️ Ошибка: На сервере не задан ни один API-ключ Gemini.');
      }
      
      const currentAi = new GoogleGenAI({ apiKey: API_KEYS[0] });
      let textToSpeak = text;

      // STEP 1: Process text through normal LLM if translation is needed
      if (user.targetLang && langNames[user.targetLang]) {
          try {
             let prepPrompt = `Translate the following text into ${langNames[user.targetLang]}. ONLY output the translated text, without any conversational filler or markdown formatting.\n\nText: ${text}`;
             const textResp = await currentAi.models.generateContent({
                 model: "gemini-3-flash-preview",
                 contents: prepPrompt
             });
             if (textResp.text) {
                 textToSpeak = textResp.text.trim();
             }
          } catch(e) {
             console.error("Translation prep failed:", e);
             await ctx.reply("⚠️ Ошибка автоперевода. Попытка озвучить оригинал...");
          }
      }
      
      // STEP 2: Apply emotion prompt prefix for TTS
      let finalTTSPrompt = textToSpeak;
      if (user.scenario && styles[user.scenario]) {
          finalTTSPrompt = `${styles[user.scenario]}:\n${textToSpeak}`;
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
                contents: [{ parts: [{ text: finalTTSPrompt }] }],
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
        
        saveUser({ 
           id: ctx.from!.id, 
           charsGenerated: (user.charsGenerated || 0) + text.length,
           audioCount: (user.audioCount || 0) + 1
        });

        await ctx.replyWithVoice({ source: finalWav }, { caption: '🔊 Аудио готово' });
      } else {
         const debugInfo = JSON.stringify(response.candidates?.[0] || 'No candidates');
         console.error('Empty audio data. Gemini Response:', debugInfo);
         return await ctx.reply(`⚠️ Ошибка: синтезатор вернул пустые данные.\n\nДетали ответа Gemini: ${debugInfo.substring(0, 1000)}`);
      }
    } catch (err) {
      console.error(err);
      await ctx.reply(`⚠️ Ошибка синтеза: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  bot.on('document', checkSub, async (ctx) => {
    try {
      const doc = ctx.message.document;
      if (doc.mime_type !== 'text/plain') {
        return ctx.reply('Пожалуйста, отправьте текстовый файл (.txt) для озвучки.');
      }
      
      if (doc.file_size && doc.file_size > 4000) {
        return ctx.reply('⚠️ Файл слишком большой. Для работы в бесплатном облаке Vercel максимальный размер файла - 4 КБ. Пожалуйста, разбейте текст на части.');
      }

      const fileUrl = await ctx.telegram.getFileLink(doc.file_id);
      const response = await fetch(fileUrl);
      const text = await response.text();
      
      if (!text || text.trim().length === 0) {
          return ctx.reply('Файл пуст.');
      }
      
      // Simulate sending the text through the normal text handler by spoofing the message
      ctx.message.text = text.substring(0, 4000); // safety boundary
      await ctx.reply('📄 Файл принят! Начинаю генерацию аудио... (это может занять до 20 секунд).');
      bot.handleUpdate({
          update_id: ctx.update.update_id + 1000000,
          message: ctx.message
      } as any);

    } catch (e) {
      console.error("Document parsing error", e);
      ctx.reply('❌ Ошибка при чтении файла.');
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

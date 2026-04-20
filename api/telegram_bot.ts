import { Telegraf, Context, Markup } from 'telegraf';
import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from '@google/genai';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { db } from './firestore.js';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from 'firebase/firestore/lite';

dotenv.config();

// --- Configuration ---
const ADMIN_ID = Number(process.env.ADMIN_ID) || 0;
const REQ_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID;
const CHANNEL_LINK = process.env.CHANNEL_LINK || 'https://t.me/ais_build';

let bot: Telegraf | null = null;
let botInitialized = false;

function getBot() {
  if (botInitialized && bot) return bot;
  
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN is missing.');
    return null;
  }

  try {
    bot = new Telegraf(token);
    bot.catch((err, ctx) => {
      console.error(`❌ Telegraf error for ${ctx.updateType}:`, err);
    });
    setupBotLogic(bot);
    botInitialized = true;
    return bot;
  } catch (err) {
    console.error('❌ Failed to initialize Telegraf:', err);
    return null;
  }
}

function setupBotLogic(bot: Telegraf) {
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
    
    // Quota System
    lastResetDate?: string;
    dailyGens?: number;
    purchasedGens?: number;
  }

  // Quota Helper
  function getDailyLimit() {
    return 10;
  }

  async function checkQuota(user: Partial<UserData>, userId: number): Promise<{ allowed: boolean; reason?: string }> {
     if (userId === ADMIN_ID) return { allowed: true };

     const today = new Date().toISOString().split('T')[0];
     
     // 1. Global Daily Limit (e.g. 50 total for free tier)
     if (db) {
         try {
             const globalRef = doc(db, 'bot_stats', 'global_daily');
             const globalSnap = await getDoc(globalRef);
             if (globalSnap.exists()) {
                 const data = globalSnap.data();
                 if (data.date === today && data.count >= 20) { 
                     return { allowed: false, reason: '⚠️ Общий лимит бота на сегодня исчерпан (20/20). Попробуйте завтра!' };
                 }
             }
         } catch(e) {}
     }

     // 2. Personal Limit
     let dailyGens = user.dailyGens || 0;
     if (user.lastResetDate !== today) {
       dailyGens = 0; 
     }
     
     const purchased = user.purchasedGens || 0;
     const ok = dailyGens < getDailyLimit() || purchased > 0;
     
     if (!ok) {
         return { allowed: false, reason: '⚠️ Вы исчерпали свой лимит (10/10). Лимит обновится завтра или вы можете купить доп. генерации ⭐️' };
     }

     return { allowed: true };
  }

  async function consumeQuota(user: Partial<UserData>, id: number) {
    const today = new Date().toISOString().split('T')[0];
    
    // 1. Consume Global
    if (db && id !== ADMIN_ID) {
        try {
            const globalRef = doc(db, 'bot_stats', 'global_daily');
            const globalSnap = await getDoc(globalRef);
            if (!globalSnap.exists() || globalSnap.data()?.date !== today) {
                await setDoc(globalRef, { date: today, count: 1 });
            } else {
                await updateDoc(globalRef, { count: (globalSnap.data()?.count || 0) + 1 });
            }
        } catch(e) {}
    }

    // 2. Consume Personal
    let dailyGens = user.dailyGens || 0;
    let purchased = user.purchasedGens || 0;
    
    if (user.lastResetDate !== today) {
      dailyGens = 0;
    }
    
    if (dailyGens < getDailyLimit()) {
      dailyGens++;
    } else if (purchased > 0) {
      purchased--;
    }
    
    await saveUser({
       ...user,
       id,
       lastResetDate: today,
       dailyGens,
       purchasedGens: purchased
    });
  }

  // --- DB Helpers ---
  async function loadUser(id: number): Promise<Partial<UserData>> {
    if (!db) return { id, voice: 'Kore', dailyGens: 0 };
    try {
        const ref = doc(db, 'bot_users', String(id));
        const snap = await getDoc(ref);
        if (snap.exists()) {
            return { ...snap.data(), id } as UserData;
        }
    } catch(e) {
        console.error("Firestore read error", e);
    }
    return { id, voice: 'Kore', dailyGens: 0 };
  }

  async function saveUser(user: Partial<UserData> & { id: number }) {
    if (!db) return;
    try {
        const ref = doc(db, 'bot_users', String(user.id));
        await setDoc(ref, user, { merge: true });
    } catch(e) {
        console.error("Firestore write error", e);
    }
  }

  // --- Audio Utils ---
  function createWavBuffer(base64Audio: string): Buffer {
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
    
    return Buffer.concat([wavHeader, pcmBuffer]);
  }

  // --- Keyboards ---
  const getMainMenu = () => {
    return Markup.keyboard([
      ['🎙️ Выбрать голос', '🎭 Эмоции / Роли'],
      ['🌍 Переводчик', '⭐️ Купить генерации'],
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
      [Markup.button.callback('📱 Сторис', 'scen_stories'), Markup.button.callback('⚡ Shorts', 'scen_shorts')],
      [Markup.button.callback('💬 Диалог', 'scen_dialogue'), Markup.button.callback('🤫 Шепот (ASMR)', 'scen_whisper')],
      [Markup.button.callback('🤬 Злобно', 'scen_angry'), Markup.button.callback('🤪 Сарказм', 'scen_sarcastic')],
      [Markup.button.callback('❌ Обычный голос', 'scen_none')]
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

  bot.command('id', async (ctx) => {
    ctx.reply(`🆔 Ваш ID: ${ctx.from.id}\n👑 Admin ID: ${ADMIN_ID}\n${ctx.from.id === ADMIN_ID ? '✅ Вы администратор' : '❌ Вы не администратор'}`);
  });

  bot.command('debug', async (ctx) => {
    const isAd = ctx.from.id === ADMIN_ID;
    let subStatus = 'Unknown';
    if (REQ_CHANNEL_ID) {
      try {
        const member = await ctx.telegram.getChatMember(REQ_CHANNEL_ID, ctx.from.id);
        subStatus = member.status;
      } catch (e: any) {
        subStatus = `Error: ${e.message}`;
      }
    } else {
      subStatus = 'No required channel';
    }
    
    ctx.reply(`🛠 **Debug Info**\n\n👤 ID: ${ctx.from.id}\n👑 Admin ID: ${ADMIN_ID}\n📢 Channel: ${REQ_CHANNEL_ID || 'None'}\n📡 Sub Status: ${subStatus}`, { parse_mode: 'Markdown' });
  });

  // --- Handlers ---
  bot.start(async (ctx) => {
    const user: UserData = {
      id: ctx.from.id,
      username: ctx.from.username,
      name: ctx.from.first_name,
      voice: 'Kore',
      joinedAt: new Date().toISOString()
    };
    await saveUser(user);
    await ctx.reply('🚀 Добро пожаловать в EchoVox.pro! Я превращаю текст в профессиональную озвучку. Просто напишите мне текст, и я пришлю вам готовый аудиофайл.', getMainMenu());
  });

  bot.action('admin_set_webhook', async (ctx) => {
    if (ctx.from!.id !== ADMIN_ID) return;
    
    const projectUrl = process.env.PROJECT_URL || process.env.APP_URL?.replace('https://', '').replace(/\/$/, '') || '';
    
    if (!projectUrl) {
      return ctx.reply('❌ Ошибка: PROJECT_URL не задан. Укажите его в настройках (например: echovox-bot.vercel.app)');
    }
    
    try {
      const webhookUrl = `https://${projectUrl}/api/telegram_bot`;
      await ctx.telegram.setWebhook(webhookUrl);
      ctx.reply(`✅ Webhook установлен:\n${webhookUrl}\n\n⚠️ Внимание: Теперь бот будет отвечать только через Vercel. Поллинг в AI Studio остановлен.`);
    } catch (e: any) {
      if (e.message?.includes('429')) {
        ctx.reply('⏳ Слишком много запросов. Telegram просит подождать 1-5 секунд перед повторной установкой вебхука. Попробуйте еще раз сейчас.');
      } else {
        ctx.reply(`❌ Ошибка установки Webhook: ${e.message}`);
      }
    }
  });

  bot.action('admin_delete_webhook', async (ctx) => {
    if (ctx.from!.id !== ADMIN_ID) return;
    try {
      await ctx.telegram.deleteWebhook();
      ctx.reply('🗑 Webhook удален. Бот возвращается в режим Поллинга. Подождите 1-2 минуты, пока AI Studio подхватит обновления.');
    } catch (e: any) {
      ctx.reply(`❌ Ошибка удаления Webhook: ${e.message}`);
    }
  });

  bot.action('admin_webhook_info', async (ctx) => {
    if (ctx.from!.id !== ADMIN_ID) return;
    try {
      const info = await ctx.telegram.getWebhookInfo();
      const text = `ℹ️ **Webhook Info:**\n\n` +
                   `🔗 URL: ${info.url || 'Не установлен'}\n` +
                   `📅 Has Custom Cert: ${info.has_custom_certificate}\n` +
                   `📊 Pending Updates: ${info.pending_update_count}\n` +
                   `❌ Last Error: ${info.last_error_message || 'Нет'}\n` +
                   `🕒 Last Error Date: ${info.last_error_date ? new Date(info.last_error_date * 1000).toLocaleString() : 'Нет'}`;
      ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (e: any) {
      ctx.reply(`❌ Ошибка получения инфо: ${e.message}`);
    }
  });

  bot.command('admin', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply('🛠 Админ-панель EchoVox', Markup.inlineKeyboard([
      [Markup.button.callback('📊 Статистика', 'admin_stats'), Markup.button.callback('📥 База (TXT)', 'admin_export')],
      [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
      [Markup.button.callback('🌐 Установить Webhook', 'admin_set_webhook')],
      [Markup.button.callback('🗑 Удалить Webhook', 'admin_delete_webhook'), Markup.button.callback('ℹ️ Инфо Webhook', 'admin_webhook_info')]
    ]));
  });

  bot.hears('🎙️ Выбрать голос', (ctx) => ctx.reply('Выберите желаемый голос:\n*Совет: Нажмите на любую кнопку для предпрослушивания голоса.*', getVoiceMenu()));
  bot.hears('🎭 Эмоции / Роли', (ctx) => ctx.reply('Выберите стиль озвучки:', getScenarioMenu()));
  bot.hears('🌍 Переводчик', (ctx) => ctx.reply('🌐 Выберите язык для автоперевода (текст сначала переведут, а потом озвучат):', getLangMenu()));
  bot.hears('ℹ️ Помощь', (ctx) => ctx.reply('ℹ️ **Справка:**\nОтправьте любой текст боту, и он преобразует его в речь. Вы можете загрузить текстовый файл (.txt) - я разобью его на аудио.\n\nМодель: Gemini Flash Voice TTS\nРазработчик: AI Studio Build'));

  bot.action(/voice_(.+)/, async (ctx) => {
    const voice = ctx.match[1];
    const user = await loadUser(ctx.from!.id);
    await saveUser({ ...user, id: ctx.from!.id, voice });
    await ctx.answerCbQuery(`Выбран: ${voice}`);
    await ctx.reply(`✅ Голос изменен на **${voice}**. Генерирую предпрослушивание...`, {parse_mode: 'Markdown'});
    
    // Auto-generate preview
    const keysString = process.env.GEMINI_API_KEYS || process.env.VITE_GEMINI_API_KEYS || process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
    const API_KEYS = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
    
    if(API_KEYS.length === 0) {
        return await ctx.reply("⚠️ Ключ API не найден для предпрослушивания.");
    }

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
            const finalWavBuffer = createWavBuffer(base64Audio);
            await ctx.replyWithVoice({ source: finalWavBuffer });
        } else {
             const debugInfo = JSON.stringify(resp.candidates?.[0] || 'No candidates');
             await ctx.reply(`⚠️ Предпрослушивание: пустые данные от API. Детали: ${debugInfo.substring(0, 500)}`);
        }
    } catch (e: any) {
        console.warn("Failed preview", e);
        await ctx.reply(`⚠️ Ошибка предпрослушивания: ${e.message || String(e)}`);
    }
  });

  bot.action(/scen_(.+)/, async (ctx) => {
    const scen = ctx.match[1];
    const user = await loadUser(ctx.from!.id);
    await saveUser({ ...user, id: ctx.from!.id, scenario: scen === 'none' ? undefined : scen });
    
    const msgs: Record<string, string> = {
      news: 'Диктор новостей 🎙️',
      book: 'Аудиокнига 📖',
      stories: 'Эмоциональный для Сторис 📱',
      shorts: 'Динамичный для Shorts ⚡',
      dialogue: 'Естественный диалог 💬',
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
    const user = await loadUser(ctx.from!.id);
    await saveUser({ ...user, id: ctx.from!.id, targetLang: lang === 'none' ? undefined : lang });
    
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
    return ctx.reply('Вы исчерпали бесплатный лимит или просто хотите купить больше генераций? Выберите пакет:', Markup.inlineKeyboard([
        [Markup.button.pay('Купить 15 генераций (50 ⭐️)')],
        [Markup.button.pay('Купить 40 генераций (100 ⭐️)')]
    ]));
  });
  
  // Custom command to trigger specific invoice dynamically in Telegram
  bot.action('buy_15', (ctx) => {
     ctx.replyWithInvoice({
      title: 'Пакет 15', description: '15 дополнительных генераций аудио', payload: 'pkg_15',
      provider_token: '', currency: 'XTR', prices: [{ label: 'Пакет 15', amount: 50 }]
    });
  });
  
  bot.action('buy_40', (ctx) => {
     ctx.replyWithInvoice({
      title: 'Пакет 40', description: '40 дополнительных генераций аудио', payload: 'pkg_40',
      provider_token: '', currency: 'XTR', prices: [{ label: 'Пакет 40', amount: 100 }]
    });
  });

  bot.hears('⭐️ Купить генерации', (ctx) => {
      ctx.reply('Дополнительные генерации без суточных ограничений:', Markup.inlineKeyboard([
          [Markup.button.callback('15 генераций - 50 ⭐️', 'buy_15')],
          [Markup.button.callback('40 генераций - 100 ⭐️', 'buy_40')]
      ]));
  });

  bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

  bot.on('successful_payment', async (ctx) => {
    const payload = ctx.message.successful_payment.invoice_payload;
    const user = await loadUser(ctx.from!.id);
    let added = 0;
    
    if (payload === 'pkg_15') added = 15;
    if (payload === 'pkg_40') added = 40;
    
    await saveUser({
        ...user,
        id: ctx.from!.id,
        purchasedGens: (user.purchasedGens || 0) + added
    });
    
    await ctx.reply(`🌟 Оплата прошла успешно! Вам начислено +${added} генераций! Вы можете продолжать использование.`);
  });

  bot.action('admin_stats', async (ctx) => {
    if (!db) {
       return ctx.reply("База данных недоступна");
    }
    const snap = await getDocs(collection(db, 'bot_users'));
    let totalChars = 0;
    let totalAudio = 0;
    let count = 0;
    snap.forEach(doc => {
        count++;
        const u = doc.data() as UserData;
        if(u.charsGenerated) totalChars += u.charsGenerated;
        if(u.audioCount) totalAudio += u.audioCount;
    });
    
    ctx.reply(`📊 **Статистика Бота:**\n\n👥 Всего пользователей: ${count}\n🔡 Сгенерировано символов: ${totalChars}\n🎧 Аудио сгенерировано: ${totalAudio}`);
  });

  bot.action('admin_export', async (ctx) => {
    try {
      console.log('📬 Admin export requested by:', ctx.from?.id);
      if (!db) {
         console.error('❌ export: db is not initialized');
         return ctx.reply("База данных недоступна");
      }
      await ctx.answerCbQuery('Генерирую файл...');
      
      const colRef = collection(db, 'bot_users');
      const snap = await getDocs(colRef);
      console.log(`📑 Found ${snap.docs.length} users in DB for export.`);
      
      let content = "ID | Username | Name | Audio Count | Chars | Joined At\n";
      content += "----------------------------------------------------------\n";
      
      snap.forEach(doc => {
         const u = doc.data() as UserData;
         content += `${doc.id} | @${u.username || 'n/a'} | ${u.name || 'n/a'} | ${u.audioCount || 0} | ${u.charsGenerated || 0} | ${u.joinedAt || 'n/a'}\n`;
      });
      
      if (snap.docs.length === 0) {
          return ctx.reply("База пользователей в Firestore пуста.");
      }

      await ctx.replyWithDocument({ 
        source: Buffer.from(content, 'utf-8'), 
        filename: `users_export_${new Date().toISOString().split('T')[0]}.txt` 
      }, {
        caption: `👥 Всего пользователей в базе: ${snap.docs.length}`
      });
      console.log('✅ Export sent successfully.');
    } catch (e: any) {
      console.error("❌ Export error:", e);
      ctx.reply(`❌ Ошибка экспорта: ${e.message}`);
    }
  });

  bot.action('admin_broadcast', (ctx) => {
    ctx.reply('Пришлите сообщение для рассылки (текст).');
    bot.on('text', async (bCtx, next) => {
      if (bCtx.from.id !== ADMIN_ID) return next();
      if (!db) return bCtx.reply("База данных недоступна");
      
      const snap = await getDocs(collection(db, 'bot_users'));
      let sent = 0;
      for (const d of snap.docs) {
        try {
          await bCtx.telegram.sendMessage(Number(d.id), bCtx.message.text);
          sent++;
        } catch (e) {}
      }
      bCtx.reply(`📢 Рассылка завершена. Доставлено: ${sent}`);
    });
  });

  async function processSynthesis(ctx: Context, text: string) {
    if (!text || text.trim().length === 0) return;

    try {
      const user = await loadUser(ctx.from!.id);
      const quota = await checkQuota(user, ctx.from!.id);
      
      if (!quota.allowed) {
          return ctx.reply(quota.reason!);
      }
      
      await ctx.sendChatAction('record_voice');
      
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
      
      let textToSpeak = text;

      // STEP 1: Process text through normal LLM if translation is needed
      if (user.targetLang && langNames[user.targetLang]) {
          try {
             const currentAi = new GoogleGenAI({ apiKey: API_KEYS[0] });
             let prepPrompt = `Translate the following text into ${langNames[user.targetLang]}. ONLY output the translated text, without any conversational filler or markdown formatting.\n\nText: ${text}`;
             const textResp = await currentAi.models.generateContent({
                 model: "gemini-3-flash-preview",
                 contents: [{ role: 'user', parts: [{ text: prepPrompt }] }]
             });
             const responseText = textResp.text;
             if (responseText) {
                 textToSpeak = responseText.trim();
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
              response = await currentAi.models.generateContent({ 
                model: "gemini-3.1-flash-tts-preview",
                contents: [{ parts: [{ text: finalTTSPrompt }] }],
                config: {
                  responseModalities: [Modality.AUDIO],
                  safetySettings: [
                    { category: 'HARM_CATEGORY_HATE_SPEECH' as any, threshold: 'BLOCK_NONE' as any },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT' as any, threshold: 'BLOCK_NONE' as any },
                    { category: 'HARM_CATEGORY_HARASSMENT' as any, threshold: 'BLOCK_NONE' as any },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' as any, threshold: 'BLOCK_NONE' as any }
                  ],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: user.voice || 'Kore' },
                    },
                  },
                },
              });
              
              const candidate = response.candidates?.[0];
              if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'OTHER') {
                  console.warn(`⚠️ Blocked by safety or other reason: ${candidate.finishReason}`);
                  continue; 
              }

              success = true;
              break;
          } catch (apiErr: any) {
               const status = apiErr?.status || apiErr?.response?.status;
               if (status === 429 || apiErr?.message?.includes('429')) {
                   console.warn(`Key ${i + 1}/${shuffledKeys.length} hit quota. Trying next...`);
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
        return await ctx.reply(`⚠️ Ошибка: Все API-ключи исчерпали лимит или произошла критическая ошибка: ${lastError?.message || 'Unknown'}`);
      }

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio && base64Audio.length > 100) {
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
        wavHeader.writeUInt16LE(1, 20);
        wavHeader.writeUInt16LE(numChannels, 22);
        wavHeader.writeUInt32LE(sampleRate, 24);
        wavHeader.writeUInt32LE(byteRate, 28);
        wavHeader.writeUInt16LE(blockAlign, 32);
        wavHeader.writeUInt16LE(bitsPerSample, 34);
        wavHeader.write('data', 36);
        wavHeader.writeUInt32LE(dataSize, 40);
        
        const finalWav = Buffer.concat([wavHeader, pcmBuffer]);
        
        await consumeQuota(user, ctx.from!.id);
        await saveUser({ 
           ...user,
           id: ctx.from!.id, 
           charsGenerated: (user.charsGenerated || 0) + text.length,
           audioCount: (user.audioCount || 0) + 1
        });

        await ctx.replyWithVoice({ source: finalWav }, { caption: '🔊 Аудио готово' });
      } else {
         const debugInfo = JSON.stringify(response.candidates?.[0] || 'No candidates');
         return await ctx.reply(`⚠️ Ошибка: синтезатор вернул пустые данные. Детали: ${debugInfo.substring(0, 500)}`);
      }
    } catch (err: any) {
      console.error(err);
      await ctx.reply(`⚠️ Ошибка синтеза: ${err.message || String(err)}`);
    }
  }

  bot.on('text', checkSub, async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    await processSynthesis(ctx, text);
  });

  bot.on('document', checkSub, async (ctx) => {
    try {
      const doc = ctx.message.document;
      if (doc.mime_type !== 'text/plain') {
        return ctx.reply('Пожалуйста, отправьте текстовый файл (.txt) для озвучки.');
      }
      
      const fileUrl = await ctx.telegram.getFileLink(doc.file_id);
      const fetchResp = await fetch(fileUrl);
      const text = await fetchResp.text();
      
      if (!text || text.trim().length === 0) {
          return ctx.reply('Файл пуст.');
      }
      
      await ctx.reply('📄 Файл принят! Начинаю генерацию аудио...');
      await processSynthesis(ctx, text.substring(0, 5000));

    } catch (e: any) {
      console.error("Document parsing error", e);
      ctx.reply(`❌ Ошибка при чтении файла: ${e.message}`);
    }
  });

  // Only start polling if NOT on Vercel and explicitly allowed
  const isVercel = process.env.VERCEL === '1';
  const isWebhook = process.env.WEBHOOK_MODE === 'true';

  if (!isVercel && !isWebhook) {
     console.log('🚀 Launching polling bot...');
     bot.launch()
       .then(() => console.log('✅ Polling Bot successfully started.'))
       .catch((err: any) => {
         if (err.description?.includes('Conflict')) {
           console.error('❌ Conflict: Webhook is active elsewhere (likely on Vercel).');
           console.log('💡 To use the bot here in the preview, write /admin to the bot (it will go to Vercel) and press "Delete Webhook", then wait a minute.');
         } else {
           console.error('❌ Failed to launch bot:', err);
         }
       });
  }
}

// Initialize bot for local development (polling) if not on Vercel
const isProd = process.env.NODE_ENV === 'production';
const isVercel = process.env.VERCEL === '1';
const isWebhook = process.env.WEBHOOK_MODE === 'true';

console.log(`🤖 Bot Startup Check: ENV=${process.env.NODE_ENV}, VERCEL=${process.env.VERCEL}, WEBHOOK=${process.env.WEBHOOK_MODE}`);

if (!isVercel && !isWebhook) {
  console.log('🔌 Triggering getBot() for local polling...');
  getBot();
  
  // Local Pingator to prevent local sleep
  setInterval(async () => {
    try {
      const b = getBot();
      if (b) {
        const me = await b.telegram.getMe();
        console.log(`📡 Local Ping: ${me.username} is active.`);
      }
    } catch (e: any) {
      console.warn('📡 Local Ping Failed:', e.message);
    }
  }, 1000 * 60 * 10); // Every 10 minutes
}

export { getBot as getTelegrafBot };

// Vercel Serverless Function Handler
export default async (req: any, res: any) => {
  console.log(`📡 Incoming Update [${req.method}]`);
  
  const currentBot = getBot();
  
  if (!currentBot) {
    console.error('❌ Bot not initialized: TOKEN is missing.');
    return res.status(500).send('Check TELEGRAM_BOT_TOKEN environment variable.');
  }

  if (req.method === 'POST') {
    try {
      await currentBot.handleUpdate(req.body);
      res.status(200).send('OK');
    } catch (err) {
      console.error('❌ Error handling update:', err);
      res.status(500).send('Internal processing error');
    }
  } else {
    // Health check / Pingator
    const isCron = req.headers['x-vercel-cron'] === '1';
    
    try {
      // Access Firestore to keep it warm
      const { collection, getDocs, limit, query } = await import("firebase/firestore/lite");
      if (db) {
        await getDocs(query(collection(db, "bot_users"), limit(1)));
      }

      const info = await currentBot.telegram.getMe();
      
      if (isCron) {
        console.log('⏰ Vercel Cron Ping: System Warmed Up.');
      }

      res.status(200).json({
         status: 'ready',
         bot: info.username,
         warmed: true,
         cron: isCron,
         webhook: process.env.WEBHOOK_MODE === 'true'
      });
    } catch (e: any) {
      console.error('🌡️ Warmup Error:', e.message);
      res.status(200).json({ status: 'running', error: e.message });
    }
  }
};

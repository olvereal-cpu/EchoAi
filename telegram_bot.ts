import { Telegraf, Context, Markup } from 'telegraf';
import { GoogleGenAI, Modality } from '@google/genai';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// --- Configuration ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const REQ_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID;
const CHANNEL_LINK = process.env.CHANNEL_LINK || 'https://t.me/ais_build';

if (!BOT_TOKEN || !GEMINI_KEY) {
  console.error('❌ Missing essential environment variables (BOT_TOKEN or GEMINI_API_KEY/VITE_GEMINI_API_KEY).');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
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
  if (fs.existsSync(USERS_FILE)) {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  }
  return {};
}

function saveUser(user: UserData) {
  const users = loadUsers();
  users[user.id] = { ...users[user.id], ...user };
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
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
  await ctx.reply('🚀 Добро пожаловать в EchoVox.pro! Я превращаю текст в профессиональную озвучку.', getMainMenu());
});

// Admin Panel
bot.command('admin', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  ctx.reply('🛠 Админ-панель EchoVox', Markup.inlineKeyboard([
    [Markup.button.callback('📊 Статистика', 'admin_stats')],
    [Markup.button.callback('📥 Скачать базу (TXT)', 'admin_export')],
    [Markup.button.callback('📢 Рассылка', 'admin_broadcast')]
  ]));
});

// Voice selection
bot.hears('🎙️ Выбрать голос', (ctx) => ctx.reply('Выберите желаемый голос:', getVoiceMenu()));
bot.hears('📝 Сценарии', (ctx) => ctx.reply('Выберите стиль озвучки:', getScenarioMenu()));

bot.action(/voice_(.+)/, (ctx) => {
  const voice = ctx.match[1];
  saveUser({ id: ctx.from!.id, voice, joinedAt: new Date().toISOString() }); // joinedAt won't overwrite existing due to helper merge
  ctx.answerCbQuery();
  ctx.reply(`✅ Выбран голос: ${voice}`);
});

bot.action(/scen_(.+)/, (ctx) => {
  const scen = ctx.match[1];
  saveUser({ id: ctx.from!.id, voice: 'Kore', scenario: scen === 'none' ? undefined : scen, joinedAt: '' });
  ctx.answerCbQuery();
  ctx.reply(`✅ Выбран сценарий: ${scen}`);
});

// Stars Support
bot.hears('⭐️ Поддержать проект', (ctx) => {
  ctx.replyWithInvoice({
    title: 'Поддержка EchoVox.pro',
    description: 'Добровольный взнос на развитие и оплату серверов.',
    payload: 'donation',
    provider_token: '', // Empty for Telegram Stars
    currency: 'XTR', // Stars
    prices: [{ label: '10 Stars', amount: 10 }],
    start_parameter: 'donate'
  });
});

// Admin Actions
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
    return; // Stop listening
  });
});

// Main TTS Logic with Sub Check
bot.on('text', checkSub, async (ctx) => {
  const text = ctx.message.text;
  const users = loadUsers();
  const user = users[ctx.from!.id] || { 
    id: ctx.from!.id, 
    voice: 'Kore',
    joinedAt: new Date().toISOString()
  } as UserData;

  if (text.startsWith('/')) return; // Ignore other commands

  try {
    await ctx.sendChatAction('record_voice');
    
    // Simple mapping for scenarios
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

    const response = await (ai as any).models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: user.voice || 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (base64Audio) {
      const buffer = Buffer.from(base64Audio, 'base64');
      await ctx.replyWithVoice({ source: buffer }, { caption: 'Синтезировано через EchoVox.pro' });
    }
  } catch (err) {
    console.error(err);
    ctx.reply('⚠️ Ошибка синтеза. Попробуйте другой текст.');
  }
});

bot.launch().then(() => console.log('✅ Bot started with DB, Admin and Stars support!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

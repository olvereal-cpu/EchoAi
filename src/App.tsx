/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { 
  Mic2, 
  Play, 
  Volume2, 
  History as HistoryIcon, 
  X, 
  Cpu, 
  Settings2,
  Trash2,
  Download,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { getAi } from './lib/gemini';
import { Modality, HarmCategory, HarmBlockThreshold } from '@google/genai';

// Constants
const VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'] as const;
type VoiceName = typeof VOICES[number];

const TRANSLATIONS = {
  en: {
    title: "The Architecture of Sound.",
    subtitle: "Transforming raw text into fluid, human-like voice patterns. Select your linguistic profile and define the output.",
    module: "Voice Synthesis Module",
    scenarios: "Quick Scenarios / Templates",
    inputBuffer: "Input Buffer",
    glyphs: "Glyphs",
    words: "Words",
    profiles: "Linguistic Profiles",
    synthesizing: "Synthesizing",
    terminate: "Terminate",
    activate: "Activate Echo",
    archive: "Archive",
    clear: "Clear Archive",
    noWaves: "No archived soundwaves",
    purge: "Purge",
    tipsTitle: "Expert Synthesis Guide",
    tip1: "Punctuation is key: Use commas for brief pauses and periods for longer ones.",
    tip2: "Phonetics: If a name sounds wrong, try writing it phonetically (e.g., 'A-I-S' instead of 'AIS').",
    tip3: "Breathing Room: Add extra spaces or newlines to allow the AI to 'breathe' between sections.",
    tip4: "Dialogue Mode: Trigger male/female dialogues by starting lines with 'Joe: ' or 'Jane: '.",
    issue: "Issue No. 001",
    rendering: "High precision audio rendering v1.0",
    placeholder: "Begin typing here...",
    langSwitch: "Switch to RU"
  },
  ru: {
    title: "Архитектура Звука.",
    subtitle: "Превращение текста в плавные, человеческие голосовые паттерны. Выберите профиль и настройте результат.",
    module: "Модуль Синтеза Речи",
    scenarios: "Быстрые сценарии / Шаблоны",
    inputBuffer: "Буфер ввода",
    glyphs: "Знаки",
    words: "Слова",
    profiles: "Лингвистические Профили",
    synthesizing: "Синтез...",
    terminate: "Прервать",
    activate: "Запустить Эхо",
    archive: "Архив",
    clear: "Очистить Архив",
    noWaves: "Нет архивных записей",
    purge: "Удалить",
    tipsTitle: "Гайд по Синтезу",
    tip1: "Пунктуация: Комы и точки создают естественный ритм пауз.",
    tip2: "Фонетика: Если имя звучит неверно, напишите его по слогам (например, 'Эй-Ай' вместо 'AI').",
    tip3: "Свобода: Используйте абзацы, чтобы дать диктору 'передохнуть' между мыслями.",
    tip4: "Диалоги: Начинайте строки с имен для мужской/женской озвучки (например, 'Иван: ', 'Мария: ').",
    issue: "Выпуск № 001",
    rendering: "Прецизионный рендеринг аудио v1.0",
    placeholder: "Начните вводить текст здесь...",
    langSwitch: "Switch to EN"
  }
};

interface Scenario {
  id: string;
  name: string;
  emoji: string;
  text: string;
  style: string;
}

const SCENARIOS: Scenario[] = [
  { 
    id: 'audiobook', 
    name: 'Audiobook', 
    emoji: '📖', 
    text: 'It was a dark and stormy night. In the distance, a owl hooted, echoing through the empty woods. Arthur adjusted his cloak, the weight of the ancient key heavy in his pocket.',
    style: 'Speak as a professional narrator for a mystery novel. Calm, slow, and dramatic cadence.'
  },
  { 
    id: 'stories', 
    name: 'IG Stories', 
    emoji: '📱', 
    text: 'Hey guys! So many of you were asking about my morning routine, so here it is. It all starts with a cold brew and 10 minutes of journaling.',
    style: 'Speak with high energy, like a lifestyle influencer. Bright and conversational.'
  },
  { 
    id: 'shorts', 
    name: 'Shorts/Reels', 
    emoji: '⚡', 
    text: 'Stop scrolled! Did you know that cats actually spend 70% of their lives sleeping? That is almost 15 years on average!',
    style: 'Speak very fast and punchy. Hook the listener immediately. High energy.'
  },
  { 
    id: 'longvideo', 
    name: 'Long Video', 
    emoji: '📹', 
    text: 'In today\'s deep dive, we are exploring the socioeconomic impacts of the industrial revolution on modern urban planning. Let\'s begin with the first factory acts of 1833.',
    style: 'Speak like an educational YouTuber. Clear, informative, and engaging but steady pace.'
  },
  { 
    id: 'dialogue', 
    name: 'Dialogue', 
    emoji: '💬', 
    text: 'Joe: Ready for the launch?\nJane: Almost. Just waiting for the final telemetry sync.',
    style: 'Synthesize as a dialogue between Joe and Jane.'
  },
  { 
    id: 'news', 
    name: 'News Flash', 
    emoji: '🎙️', 
    text: 'Breaking news: Researchers have successfully integrated biological neural networks with synthetic voice models.',
    style: 'Speak as a professional, authoritative news anchor.'
  },
];

interface TtsHistory {
  id: string;
  text: string;
  voice: VoiceName;
  timestamp: number;
  audioData?: string; // Base64 data (only for current session items to save localStorage)
}

// WAV generation helper
function generateWav(base64Data: string): Blob {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const buffer = new Int16Array(len / 2);
  
  for (let i = 0; i < len / 2; i++) {
    const low = binaryString.charCodeAt(i * 2);
    const high = binaryString.charCodeAt(i * 2 + 1);
    buffer[i] = (high << 8) | low;
  }

  const numChannels = 1;
  const sampleRate = 24000;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = buffer.length * 2;
  const chunkSize = 36 + dataSize;

  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, chunkSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < buffer.length; i++) {
    view.setInt16(44 + i * 2, buffer[i], true);
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

export default function App() {
  const [text, setText] = useState('');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>('Kore');
  const [isGenerating, setIsGenerating] = useState(false);
  const [history, setHistory] = useState<TtsHistory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lastAudioData, setLastAudioData] = useState<string | null>(null);
  const [lang, setLang] = useState<'en' | 'ru'>('en');
  
  const t = TRANSLATIONS[lang];
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Load history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('tts_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Strip audioData when loading from localStorage to stay under limit
        setHistory(parsed.map((item: TtsHistory) => ({ ...item, audioData: undefined })));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  // Save history to localStorage (storing everything except audioData)
  useEffect(() => {
    const strippedHistory = history.map(({ audioData, ...rest }) => rest);
    localStorage.setItem('tts_history', JSON.stringify(strippedHistory));
  }, [history]);

  const stopAudio = () => {
    if (audioSourceRef.current) {
      audioSourceRef.current.stop();
      audioSourceRef.current = null;
    }
    setIsPlaying(false);
  };

  const playAudio = async (base64Data: string) => {
    try {
      stopAudio();
      
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const audioCtx = audioContextRef.current;
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const buffer = new Int16Array(len / 2);
      
      for (let i = 0; i < len / 2; i++) {
        const low = binaryString.charCodeAt(i * 2);
        const high = binaryString.charCodeAt(i * 2 + 1);
        buffer[i] = (high << 8) | low;
      }
      
      const float32 = new Float32Array(buffer.length);
      for (let i = 0; i < buffer.length; i++) {
        float32[i] = buffer[i] / 32768;
      }
      
      const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      
      source.onended = () => setIsPlaying(false);
      
      audioSourceRef.current = source;
      source.start();
      setIsPlaying(true);
    } catch (err) {
      console.error("Audio playback error:", err);
      setError("Failed to play audio. Check your browser's audio support.");
    }
  };

  const downloadAudio = (base64Data: string, filename: string) => {
    const blob = generateWav(base64Data);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleGenerate = async () => {
    if (!text.trim()) return;
    
    // Website Quota Logic
    const today = new Date().toISOString().split('T')[0];
    const savedQuotaStr = localStorage.getItem('tts_quota');
    let dailyGens = 0;
    
    if (savedQuotaStr) {
       const quotaState = JSON.parse(savedQuotaStr);
       if (quotaState.date === today) {
           dailyGens = quotaState.count;
       }
    }
    
    if (dailyGens >= 10) {
        setError(lang === 'ru' ? '⚠️ Вы исчерпали бесплатный лимит на веб-версии (10/10). Пожалуйста, воспользуйтесь Telegram-ботом, чтобы подключить расширения.' : '⚠️ You have reached your local free limit (10/10). Use the Telegram bot to unlock limits.');
        return;
    }
    
    setIsGenerating(true);
    setError(null);
    
    try {
      // Use the selected scenario ID to apply the specific style instruction
      const activeScenario = SCENARIOS.find(s => s.id === selectedScenarioId);
      const prompt = activeScenario ? `${activeScenario.style}: ${text.trim()}` : text.trim();

      // Detection for dialogue format: "Name: text"
      const lines = text.trim().split('\n');
      const speakerLines = lines.filter(l => l.includes(':'));
      const isDialogue = speakerLines.length >= 2;

      const ai = await getAi();
      if (!ai) {
        throw new Error("API Key is missing. In Vercel, please add 'VITE_GEMINI_API_KEY' to your Environment Variables and redeploy.");
      }
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          systemInstruction: "You are a professional text-to-speech engine. Convert the provided text into audio using the specified voice. Maintain a constant volume level, energy, and clear articulation throughout the entire duration of the speech. Do not fade out, lower the volume, or change the pace towards the end. Do not output any text response.",
          responseModalities: [Modality.AUDIO],
          safetySettings: [
            { category: 'HARM_CATEGORY_HATE_SPEECH' as any, threshold: 'BLOCK_NONE' as any },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT' as any, threshold: 'BLOCK_NONE' as any },
            { category: 'HARM_CATEGORY_HARASSMENT' as any, threshold: 'BLOCK_NONE' as any },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' as any, threshold: 'BLOCK_NONE' as any },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY' as any, threshold: 'BLOCK_NONE' as any }
          ],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

      const candidate = response.candidates?.[0];
      if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'OTHER') {
        throw new Error(`Generation blocked by model safety filters (${candidate.finishReason}). Try a different text.`);
      }

      const base64Audio = candidate?.content?.parts?.[0]?.inlineData?.data;
      
      if (base64Audio) {
        setLastAudioData(base64Audio);
        
        localStorage.setItem('tts_quota', JSON.stringify({
            date: today,
            count: dailyGens + 1
        }));

        // Add to history
        const newEntry: TtsHistory = {
          id: crypto.randomUUID(),
          text: text.trim(),
          voice: isDialogue ? 'Multi' as any : selectedVoice,
          timestamp: Date.now(),
          audioData: base64Audio, // Keep only in memory history
        };
        setHistory(prev => [newEntry, ...prev].slice(0, 20));
        
        // Play immediately
        await playAudio(base64Audio);
      } else {
        throw new Error("No audio data received from the model.");
      }
    } catch (err: any) {
      console.error("TTS Generation Error:", err);
      setError(err.message || "An unexpected error occurred during voice synthesis.");
    } finally {
      setIsGenerating(false);
    }
  };

  const removeFromHistory = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const clearHistory = () => {
    if (confirm("Are you sure you want to clear your history?")) {
      setHistory([]);
    }
  };

  const [isAdminView, setIsAdminView] = useState(false);
  const [adminStats, setAdminStats] = useState<any>(null);
  const [webhookInfo, setWebhookInfo] = useState<any>(null);
  const [isAdminLoading, setIsAdminLoading] = useState(false);

  const fetchAdminData = async () => {
    setIsAdminLoading(true);
    try {
      const stats = await fetch('/api/admin/stats').then(res => res.json());
      const webhook = await fetch('/api/admin/webhook').then(res => res.json());
      setAdminStats(stats);
      setWebhookInfo(webhook);
    } catch (err) {
      console.error("Failed to fetch admin data", err);
    } finally {
      setIsAdminLoading(false);
    }
  };

  const deleteWebhook = async () => {
    if (!confirm("Are you sure you want to delete the webhook? This will stop Vercel and enable local polling.")) return;
    try {
      await fetch('/api/admin/webhook', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete' })
      });
      alert("Webhook deleted. Refreshing...");
      fetchAdminData();
    } catch (e) {
      alert("Failed to delete webhook");
    }
  };

  const setWebhook = async () => {
    try {
      const res = await fetch('/api/admin/webhook', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set' })
      });
      const data = await res.json();
      if (data.success) {
        alert("✅ Webhook established successfully!");
      } else {
        alert("❌ Error: " + (data.error || 'Failed to set webhook'));
      }
      fetchAdminData();
    } catch (e) {
      alert("Failed to establish webhook relay.");
    }
  };

  useEffect(() => {
    if (isAdminView) {
      fetchAdminData();
    }
  }, [isAdminView]);

  if (isAdminView) {
    return (
      <div className="min-h-screen bg-[#050505] text-[#f0f0f0] font-mono p-6 md:p-10 flex flex-col gap-10">
        <header className="flex justify-between items-center border-b border-white/10 pb-6">
          <div className="flex gap-4 items-center">
            <Cpu className="text-[#ff4e00]" />
            <h1 className="text-xl font-black uppercase tracking-tighter italic">EchoVox Master Terminal</h1>
          </div>
          <button 
            onClick={() => setIsAdminView(false)}
            className="px-4 py-2 border border-white/20 text-[10px] uppercase font-bold hover:bg-white hover:text-black transition-all"
          >
            Exit Terminal
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 bg-white/5 border border-white/10 space-y-2">
            <span className="text-[10px] opacity-40 uppercase font-bold">Linguistic Entities</span>
            <div className="text-4xl font-black text-[#ff4e00]">{adminStats?.userCount || 0}</div>
          </div>
          <div className="p-6 bg-white/5 border border-white/10 space-y-2">
            <span className="text-[10px] opacity-40 uppercase font-bold">Glyphs Synthesized</span>
            <div className="text-4xl font-black">{adminStats?.totalChars?.toLocaleString() || 0}</div>
          </div>
          <div className="p-6 bg-white/5 border border-white/10 space-y-2">
            <span className="text-[10px] opacity-40 uppercase font-bold">Soundwaves Generated</span>
            <div className="text-4xl font-black">{adminStats?.totalAudio || 0}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="space-y-6">
            <h2 className="text-sm uppercase font-bold tracking-widest text-white/50 border-b border-white/5 pb-2">Webhook Relay Configuration</h2>
            <div className="p-6 bg-white/5 border border-white/10 space-y-4">
               <div>
                 <span className="text-[10px] opacity-40 uppercase block mb-1">Target URL</span>
                 <code className="text-xs text-[#ff4e00] break-all">{webhookInfo?.url || 'NULL (POLLING MODE ACTIVE)'}</code>
               </div>
               <div className="grid grid-cols-2 gap-4">
                 <div>
                   <span className="text-[10px] opacity-40 uppercase block mb-1">Pending Syncs</span>
                   <div className="text-xl font-bold">{webhookInfo?.pending_update_count || 0}</div>
                 </div>
                 <div>
                   <span className="text-[10px] opacity-40 uppercase block mb-1">Last Error Date</span>
                   <div className="text-xs opacity-60">
                     {webhookInfo?.last_error_date ? new Date(webhookInfo.last_error_date * 1000).toLocaleString() : 'CLEAR'}
                   </div>
                 </div>
               </div>
               
                <div className="pt-4 flex gap-4">
                  <button 
                   onClick={fetchAdminData}
                   className="px-4 py-2 bg-white/5 border border-white/10 text-[10px] font-bold uppercase hover:bg-white/10"
                  >
                    Refresh Sync
                  </button>
                  <button 
                   onClick={setWebhook}
                   className="px-4 py-2 bg-[#ff4e00]/20 border border-[#ff4e00]/40 text-[#ff4e00] text-[10px] font-bold uppercase hover:bg-[#ff4e00] hover:text-white"
                  >
                    Establish Webhook Relay
                  </button>
                  <button 
                   onClick={deleteWebhook}
                   className="p-2 border border-red-500/30 text-red-500/50 text-[10px] font-bold uppercase hover:bg-red-500 hover:text-white"
                  >
                    Reset
                  </button>
                </div>
            </div>
          </div>

          <div className="space-y-6">
            <h2 className="text-sm uppercase font-bold tracking-widest text-white/50 border-b border-white/5 pb-2">Recent Linguistic Activity</h2>
            <div className="border border-white/10 overflow-hidden">
               <table className="w-full text-[10px] uppercase text-left border-collapse">
                 <thead className="bg-white/5">
                   <tr>
                     <th className="p-3 border-b border-white/10">ID</th>
                     <th className="p-3 border-b border-white/10">Profile</th>
                     <th className="p-3 border-b border-white/10">Soundwaves</th>
                     <th className="p-3 border-b border-white/10">Glyphs</th>
                   </tr>
                 </thead>
                 <tbody>
                   {adminStats?.users?.slice(0, 5).map((user: any) => (
                     <tr key={user.id} className="hover:bg-white/5">
                       <td className="p-3 border-b border-white/5 opacity-50">{user.id}</td>
                       <td className="p-3 border-b border-white/5 font-bold">@{user.username || 'ANON'}</td>
                       <td className="p-3 border-b border-white/5">{user.audioCount || 0}</td>
                       <td className="p-3 border-b border-white/5">{user.charsGenerated || 0}</td>
                     </tr>
                   ))}
                   {!adminStats?.users?.length && (
                     <tr><td colSpan={4} className="p-10 text-center opacity-20">NO ENTITIES REGISTERED</td></tr>
                   )}
                 </tbody>
               </table>
            </div>
          </div>
        </div>

        <div className="mt-auto pt-10 text-[9px] opacity-20 flex justify-between">
           <span>ECHVOX_MASTER_TERMINAL_V1.0</span>
           <span>SECURE_DATA_RELAY_ACTIVE</span>
        </div>
      </div>
    );
  }

  const currentDate = new Date().toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-[#f0f0f0] font-sans overflow-x-hidden selection:bg-[#ff4e00] selection:text-white flex flex-col">
      {/* Accent Shadow Blobs */}
      <div className="fixed top-1/2 right-[10%] -translate-y-1/2 w-[400px] h-[400px] bg-radial-gradient from-[#ff4e001a] to-transparent z-0 pointer-events-none" 
           style={{ background: 'radial-gradient(circle, rgba(255,78,0,0.1) 0%, transparent 70%)' }}></div>
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-black text-[220px] uppercase tracking-[-10px] text-[#f0f0f00d] select-none whitespace-nowrap">
          ECHOVOX
        </div>
      </div>

      <header className="relative z-50 w-full px-6 md:px-10 pt-10 pb-6 border-b border-[#f0f0f01a] flex justify-between items-start bg-[#0f0f0f]">
        <div className="max-w-7xl mx-auto w-full flex justify-between items-start">
          <div className="logo font-serif italic text-2xl tracking-tighter text-white">EchoVox.pro</div>
          <div className="flex gap-6 md:gap-10 items-start">
            <div className="text-[10px] text-white/30 font-mono mt-1">v1.0.9</div>
            <button 
              onClick={() => setLang(lang === 'en' ? 'ru' : 'en')}
              className="text-[10px] uppercase tracking-[0.2em] font-bold border border-[#f0f0f033] px-3 py-1 hover:border-[#ff4e00] hover:text-[#ff4e00] transition-all bg-black/20"
            >
              {t.langSwitch}
            </button>
            <div className="meta text-right text-[11px] uppercase tracking-[0.1em] opacity-60 leading-relaxed font-semibold hidden sm:block">
              {t.issue}<br />
              {currentDate}
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 w-full max-w-7xl mx-auto flex-grow grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-10 md:gap-20 p-6 md:p-10">
        {/* Synthesis Section */}
        <section className="space-y-10 max-w-[800px]">
          <div className="space-y-6">
            <span className="text-[#ff4e00] text-sm uppercase tracking-[0.2em] font-bold block">
              {t.module}
            </span>
            <h1 className="font-serif italic text-5xl md:text-7xl leading-[1.1] text-white">
              {t.title}
            </h1>
            <p className="text-lg opacity-80 max-w-xl text-[#d0d0d0] leading-relaxed">
              {t.subtitle}
            </p>
          </div>

          <div className="space-y-6">
            <span className="text-[10px] uppercase tracking-widest opacity-40 font-bold block">{t.scenarios}</span>
            <div className="flex flex-wrap gap-3">
              {SCENARIOS.map((scenario) => (
                <button
                  key={scenario.id}
                  onClick={() => {
                    if (selectedScenarioId === scenario.id) {
                      setSelectedScenarioId(null);
                    } else {
                      setText(scenario.text);
                      setSelectedScenarioId(scenario.id);
                    }
                  }}
                  className={cn(
                    "px-4 py-2 border border-[#f0f0f01a] text-[11px] uppercase tracking-wider transition-all hover:bg-white/5",
                    selectedScenarioId === scenario.id ? "border-[#ff4e00] text-[#ff4e00] bg-[#ff4e000d]" : "text-white/60"
                  )}
                >
                  <span className="mr-2">{scenario.emoji}</span>
                  {scenario.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-end">
              <span className="text-[10px] uppercase tracking-widest opacity-40 font-bold">{t.inputBuffer}</span>
              <div className="flex gap-4 items-center">
                <span className={cn(
                  "text-[10px] uppercase tracking-widest font-bold",
                  text.split(/\s+/).filter(Boolean).length > 1000 ? "text-[#ff4e00]" : "opacity-40"
                )}>
                  {text.split(/\s+/).filter(Boolean).length} / 1000 {t.words}
                </span>
                <span className="text-[10px] uppercase tracking-widest opacity-40 font-bold">{text.length} {t.glyphs}</span>
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t.placeholder}
              className="w-full h-48 bg-transparent border border-[#f0f0f01a] p-8 focus:outline-none focus:border-[#ff4e00] transition-colors placeholder:opacity-10 resize-none font-serif text-3xl italic leading-tight text-white/90"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="space-y-6">
              <span className="text-[10px] uppercase tracking-widest opacity-40 font-bold">{t.profiles}</span>
              <div className="flex flex-wrap gap-x-8 gap-y-4">
                {VOICES.map((voice) => (
                  <button
                    key={voice}
                    onClick={() => setSelectedVoice(voice)}
                    className={cn(
                      "text-[11px] uppercase tracking-[0.15em] font-bold transition-all relative pb-2 group",
                      selectedVoice === voice 
                        ? "text-white" 
                        : "text-[#f0f0f066] hover:text-white"
                    )}
                  >
                    {voice}
                    {selectedVoice === voice && (
                      <motion.div layoutId="activeVoice" className="absolute bottom-0 left-0 w-full h-[2px] bg-[#ff4e00]" />
                    )}
                    <span className="absolute bottom-0 left-0 w-0 h-[2px] bg-white group-hover:w-full transition-all duration-300"></span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col justify-end space-y-6">
              <AnimatePresence>
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="p-4 bg-[#ff4e001a] border border-[#ff4e0033] text-[#ff4e00] text-xs font-bold uppercase tracking-wider flex gap-3 items-center"
                  >
                    <AlertCircle size={14} />
                    <p>{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex gap-4">
                <button
                  onClick={isPlaying ? stopAudio : handleGenerate}
                  disabled={isGenerating || (!text.trim() && !isPlaying)}
                  className={cn(
                    "flex-grow h-20 flex items-center justify-center gap-4 transition-all group overflow-hidden relative",
                    isGenerating 
                      ? "bg-[#f0f0f01a] cursor-not-allowed" 
                      : "bg-[#ff4e00] text-white hover:bg-[#ff4e00cc]"
                  )}
                >
                  {isGenerating ? (
                    <div className="flex items-center gap-3">
                      <Loader2 size={24} className="animate-spin" />
                      <span className="uppercase tracking-[0.2em] font-black italic">{t.synthesizing}</span>
                    </div>
                  ) : isPlaying ? (
                    <>
                      <X size={24} className="group-hover:rotate-90 transition-transform" />
                      <span className="uppercase tracking-[0.2em] font-black italic">{t.terminate}</span>
                    </>
                  ) : (
                    <>
                      <Play size={24} fill="currentColor" className="group-hover:scale-110 transition-transform" />
                      <span className="uppercase tracking-[0.2em] font-black italic">{t.activate}</span>
                    </>
                  )}
                </button>
                
                {lastAudioData && !isGenerating && (
                  <button
                    onClick={() => downloadAudio(lastAudioData, `echo-${Date.now()}`)}
                    className="w-20 h-20 flex items-center justify-center bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all active:scale-95"
                    title="Download Current Audio"
                  >
                    <Download size={24} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="pt-20 border-t border-[#f0f0f01a] space-y-8">
            <h3 className="font-serif italic text-3xl opacity-80">{t.tipsTitle}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 outline-none">
              <div className="space-y-2">
                <h4 className="text-[10px] uppercase tracking-widest text-[#ff4e00] font-bold">01. Rhythm</h4>
                <p className="text-sm opacity-60 leading-relaxed font-semibold">{t.tip1}</p>
              </div>
              <div className="space-y-2">
                <h4 className="text-[10px] uppercase tracking-widest text-[#ff4e00] font-bold">02. Clarity</h4>
                <p className="text-sm opacity-60 leading-relaxed font-semibold">{t.tip2}</p>
              </div>
              <div className="space-y-2">
                <h4 className="text-[10px] uppercase tracking-widest text-[#ff4e00] font-bold">03. Structure</h4>
                <p className="text-sm opacity-60 leading-relaxed font-semibold">{t.tip3}</p>
              </div>
              <div className="space-y-2">
                <h4 className="text-[10px] uppercase tracking-widest text-[#ff4e00] font-bold">04. Interactive</h4>
                <p className="text-sm opacity-60 leading-relaxed font-semibold">{t.tip4}</p>
              </div>
            </div>
          </div>
        </section>

        {/* History / Archive Section */}
        <aside className="border-l border-[#f0f0f01a] pl-10 space-y-10">
          <div className="flex justify-between items-center">
            <h2 className="text-[11px] uppercase tracking-[0.2em] font-bold opacity-60">{t.archive}</h2>
            {history.length > 0 && (
              <button 
                onClick={clearHistory}
                className="text-[9px] uppercase tracking-widest opacity-30 hover:opacity-100 transition-opacity hover:text-[#ff4e00]"
              >
                {t.clear}
              </button>
            )}
          </div>

          <div className="space-y-12 max-h-[1000px] overflow-y-auto pr-6 custom-scrollbar">
            {history.length === 0 ? (
              <div className="py-20 text-center opacity-10 font-serif italic text-3xl">
                {t.noWaves}
              </div>
            ) : (
              history.map((item, idx) => (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={item.id}
                  className="group relative"
                >
                  <div className="flex items-baseline gap-4 mb-3">
                    <span className="font-serif italic text-2xl opacity-20">0{idx + 1}</span>
                    <span className="text-[10px] uppercase font-bold tracking-widest text-[#ff4e00]">
                      {item.voice}
                    </span>
                  </div>
                  <p className="font-serif italic text-xl leading-snug line-clamp-3 mb-6 opacity-90 group-hover:opacity-100 transition-opacity">
                    "{item.text}"
                  </p>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] uppercase tracking-[0.1em] opacity-30 font-bold">
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className="flex gap-4 items-center">
                      <button 
                        onClick={() => removeFromHistory(item.id)}
                        className="opacity-0 group-hover:opacity-40 transition-opacity text-[9px] uppercase font-bold hover:text-red-500 hover:opacity-100"
                      >
                        {t.purge}
                      </button>
                      {item.audioData && (
                        <button 
                          onClick={() => downloadAudio(item.audioData!, `echo-${item.timestamp}`)}
                          className="opacity-0 group-hover:opacity-40 transition-opacity hover:opacity-100 hover:text-white"
                          title="Download Audio"
                        >
                          <Download size={14} />
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          setText(item.text);
                          setSelectedVoice(item.voice);
                          if (item.audioData) playAudio(item.audioData);
                        }}
                        className="w-10 h-10 border border-[#f0f0f033] rounded-full flex items-center justify-center group-hover:border-[#ff4e00] transition-colors"
                      >
                        <Play size={12} fill="currentColor" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </aside>
      </main>

      <footer className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-10 py-12 border-t border-[#f0f0f01a] flex flex-col md:flex-row justify-between items-center gap-10 mt-10">
        <div className="flex flex-col items-center md:items-start gap-4">
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 100 100" className="w-12 h-12" fill="none" stroke="url(#logo-grad)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="logo-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#C82B7D" />
                  <stop offset="100%" stopColor="#EB5E28" />
                </linearGradient>
              </defs>
              <path d="M 16 38 A 36 36 0 0 1 84 38" />
              <path d="M 16 62 A 36 36 0 0 0 84 62" />
              <path d="M 5 50 L 25 50 L 32 30 L 42 75 L 52 20 L 62 70 L 72 50 L 95 50" />
            </svg>
            <div className="flex flex-col text-left">
              <span className="font-serif italic text-2xl font-bold text-white tracking-tight">EchoVox</span>
              <span className="text-[10px] uppercase tracking-widest text-[#f0f0f066] mt-1">© 2026 Echovox.<br/>All rights reserved.</span>
            </div>
          </div>
        </div>

        <nav className="flex gap-6 md:gap-10 items-center">
          <button 
            onClick={() => setIsAdminView(true)}
            className="text-[10px] uppercase tracking-[0.15em] font-bold opacity-30 hover:opacity-100 transition-opacity flex items-center gap-2"
          >
            <Settings2 size={12} />
            Admin Terminal
          </button>
          <a href="#" className="text-[10px] uppercase tracking-[0.15em] font-bold border-b border-[#ff4e00] pb-2">Synthesis</a>
          <a href="#" className="text-[10px] uppercase tracking-[0.15em] font-bold opacity-30 hover:opacity-100 transition-opacity">Models</a>
          <a href="#" className="text-[10px] uppercase tracking-[0.15em] font-bold opacity-30 hover:opacity-100 transition-opacity">Docs</a>
        </nav>
      </footer>
    </div>
  );
}

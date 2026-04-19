import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
// We'll import the bot logic and its Vercel handler
import botHandler from "./api/telegram_bot.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for parsing JSON (required for Telegram webhooks)
  app.use(express.json());

  // Admin API routes
  app.get("/api/admin/stats", async (req, res) => {
    try {
      const { db } = await import("./api/firestore.js");
      if (!db) return res.status(500).json({ error: "Database not initialized" });
      
      const { collection, getDocs } = await import("firebase/firestore/lite");
      const snap = await getDocs(collection(db, "bot_users"));
      
      let totalChars = 0;
      let totalAudio = 0;
      snap.forEach(doc => {
        const data = doc.data();
        totalChars += (data.charsGenerated || 0);
        totalAudio += (data.audioCount || 0);
      });

      res.json({
        userCount: snap.size,
        totalChars,
        totalAudio,
        users: snap.docs.map(d => ({ id: d.id, ...d.data() }))
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/webhook", async (req, res) => {
    try {
      const bot = (await import("./api/telegram_bot.ts")).getTelegrafBot();
      if (!bot) return res.status(500).json({ error: "Bot not initialized" });
      
      const info = await bot.telegram.getWebhookInfo();
      res.json(info);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/webhook/delete", async (req, res) => {
    try {
      const bot = (await import("./api/telegram_bot.ts")).getTelegrafBot();
      if (!bot) return res.status(500).json({ error: "Bot not initialized" });
      
      await bot.telegram.deleteWebhook();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log(`🤖 Telegram bot should be active (check logs above)`);
  });
}

startServer();

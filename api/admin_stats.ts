import { db } from "./firestore.js";
import { collection, getDocs } from "firebase/firestore/lite";

export default async (req: any, res: any) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }
    
    // Check for auth if needed, but for now we'll keep it simple as the frontend handles the "admin view" toggle
    // In a real app, you'd check a secret header or similar
    
    const snap = await getDocs(collection(db, "bot_users"));
    
    let totalChars = 0;
    let totalAudio = 0;
    snap.forEach(doc => {
      const data = doc.data();
      totalChars += (data.charsGenerated || 0);
      totalAudio += (data.audioCount || 0);
    });

    res.status(200).json({
      userCount: snap.size,
      totalChars,
      totalAudio,
      users: snap.docs.map(d => ({ id: d.id, ...d.data() }))
    });
  } catch (e: any) {
    console.error("Admin Stats Error:", e);
    res.status(500).json({ error: e.message });
  }
};

let aiClient: any = null;

export async function getAi() {
  if (!aiClient) {
    const keysString = import.meta.env.VITE_GEMINI_API_KEYS || import.meta.env.VITE_GEMINI_API_KEY || (import.meta as any).env?.GEMINI_API_KEY || (process.env as any).GEMINI_API_KEY;
    const apiKeys = (keysString || '').split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);
    
    if (apiKeys.length === 0) {
      console.warn("Gemini API Key is missing or invalid. Check your environment variables.");
      return null;
    }

    // Pick a random key for the UI session to distribute load
    const randomKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];

    const isPlaceholder = ["VITE_GEMINI_API_KEY", "YOUR_GEMINI_KEY", "GEMINI_API_KEY"].includes(randomKey);

    if (isPlaceholder) {
      console.warn("Gemini API Key is a placeholder. Please configure real keys.");
      return null;
    }
    
    try {
      const { GoogleGenAI } = await import("@google/genai");
      // The SDK requires an options object: { apiKey: string }
      aiClient = new GoogleGenAI({ apiKey: randomKey });
    } catch (e) {
      console.error("Critical error: Failed to construct GoogleGenAI client", e);
      return null;
    }
  }
  return aiClient;
}

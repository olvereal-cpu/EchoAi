let aiClient: any = null;

export async function getAi() {
  if (!aiClient) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || (import.meta as any).env?.GEMINI_API_KEY || (process.env as any).GEMINI_API_KEY;
    
    const isPlaceholder = !apiKey || 
      ["VITE_GEMINI_API_KEY", "YOUR_GEMINI_KEY", "GEMINI_API_KEY", ""].includes(apiKey.trim());

    if (isPlaceholder) {
      console.warn("Gemini API Key is missing or invalid. Check your environment variables.");
      return null;
    }
    
    try {
      const { GoogleGenAI } = await import("@google/genai");
      // The SDK requires an options object: { apiKey: string }
      aiClient = new GoogleGenAI({ apiKey: apiKey.trim() });
    } catch (e) {
      console.error("Critical error: Failed to construct GoogleGenAI client", e);
      return null;
    }
  }
  return aiClient;
}

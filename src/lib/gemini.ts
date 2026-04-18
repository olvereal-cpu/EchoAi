let aiClient: any = null;

export async function getAi() {
  if (!aiClient) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || (import.meta.env as any).GEMINI_API_KEY;
    
    if (!apiKey || apiKey === "VITE_GEMINI_API_KEY" || apiKey === "YOUR_GEMINI_KEY" || apiKey === "GEMINI_API_KEY") {
      console.warn("Gemini API Key is missing. Environment check: VITE_GEMINI_API_KEY is", !!import.meta.env.VITE_GEMINI_API_KEY);
      return null;
    }
    
    try {
      const { GoogleGenAI } = await import("@google/genai");
      aiClient = new GoogleGenAI(apiKey);
    } catch (e) {
      console.error("Critical error: Failed to construct GoogleGenAI client", e);
      return null;
    }
  }
  return aiClient;
}

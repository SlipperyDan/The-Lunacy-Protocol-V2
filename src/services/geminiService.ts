import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

let aiClient: GoogleGenAI | null = null;

const getAiClient = () => {
    if (!aiClient) {
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("VITE_GEMINI_API_KEY is not set. Please check your .env file.");
        }
        aiClient = new GoogleGenAI({ apiKey });
    }
    return aiClient;
};

export const analyzeVideo = async (videoBase64: string, mimeType: string, prompt: string) => {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: {
            parts: [
                { inlineData: { data: videoBase64, mimeType } },
                { text: prompt }
            ]
        }
    });
    return response.text;
};

export const transcribeAudio = async (audioBase64: string, mimeType: string) => {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
            parts: [
                { inlineData: { data: audioBase64, mimeType } },
                { text: "Transcribe this audio." }
            ]
        }
    });
    return response.text;
};

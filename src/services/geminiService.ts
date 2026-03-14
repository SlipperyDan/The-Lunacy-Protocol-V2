import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const analyzeVideo = async (videoBase64: string, mimeType: string, prompt: string) => {
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

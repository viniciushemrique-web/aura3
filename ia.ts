/** Cliente Gemini via REST (substitui google.generativeai). */
import { fetch } from "@tauri-apps/plugin-http";
import { CHAVE_GEMINI, MODELO_GEMINI } from "./config";

export class ModeloIA {
  static configurado(): boolean {
    return Boolean(CHAVE_GEMINI);
  }

  async gerar(prompt: string): Promise<string> {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": CHAVE_GEMINI },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      },
    );
    if (!r.ok) throw new Error(`Gemini ${r.status}`);
    const j = await r.json();
    const texto = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof texto !== "string") throw new Error("Resposta vazia da IA.");
    return texto;
  }

  /** Transcreve um trecho de áudio WAV (16 kHz, mono, PCM16) enviado em base64. */
  async transcrever(wavBase64: string): Promise<string> {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": CHAVE_GEMINI },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/wav", data: wavBase64 } },
              {
                text: "Transcreva exatamente o que a pessoa disse neste áudio, em português do Brasil. " +
                  "Responda somente com o texto falado, sem aspas e sem comentários. " +
                  "Se não houver fala clara, responda com um texto vazio.",
              },
            ],
          }],
          generationConfig: { temperature: 0 },
        }),
      },
    );
    if (!r.ok) throw new Error(`Gemini (transcrição) ${r.status}`);
    const j = await r.json();
    const texto = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof texto === "string" ? texto.trim() : "";
  }
}

/** Configurações globais, constantes e utilitários (port de config.py). */

const env = import.meta.env as Record<string, string | undefined>;

export const LARGURA_JANELA = 940;
export const ALTURA_JANELA = 560;

export const VOZ_PADRAO = "masculina";
export const IDIOMA_VOZ = "pt-BR";
export const VELOCIDADE_VOZ = 1.0; // 0.5 (lento) a 2.0 (rápido)

export const MODELO_GEMINI = env.VITE_GEMINI_MODEL ?? "gemini-3.8-flash";
export const CHAVE_GEMINI = env.VITE_GEMINI_API_KEY ?? "";

export const URL_WHATSAPP = "http://localhost:5000/enviar";
export const TIMEOUT_WHATSAPP_MS = 8000;

export const SPOTIFY = {
  clientId: env.VITE_SPOTIFY_CLIENT_ID ?? "",
  refreshToken: env.VITE_SPOTIFY_REFRESH_TOKEN ?? "",
};

export const CHAVE_PIX = (env.VITE_CHAVE_PIX ?? "").trim();

// Agenda local (nomes em minúsculas).
export const CONTATOS: Record<string, string> = {
  "joão": "+5511999999999",
  maria: "+5521988888888",
  "mãe": "+5511977777777",
};

export const EXTENSOES_ORGANIZAVEIS = new Set([
  ".png", ".jpg", ".jpeg", ".gif",
  ".pdf", ".docx", ".xlsx", ".txt", ".pptx",
]);

export const FRASES_AGUA_ADICIONAR = ["bebi água", "bebi agua", "bebi um copo", "adicionar água", "adicionar agua"];
export const FRASES_AGUA_STATUS = ["quanta água", "quanta agua", "status de água", "status de agua"];
export const FRASES_STATUS_SAUDE = ["como está minha saúde", "relatório de ergonomia", "tempo de tela"];
export const FRASES_TROCAR_VOZ = [
  "trocar de voz", "trocar voz", "troca de voz", "troque de voz",
  "mudar de voz", "mudar voz", "muda de voz", "mude de voz",
  "alterar voz", "alterar de voz", "outra voz", "próxima voz", "proxima voz",
];

export const ROTULOS_ACAO: Record<string, string> = {
  tocar_spotify: "Música tocando",
  organizar_area_de_trabalho: "Área de Trabalho organizada",
  agendar_desligamento: "Desligamento agendado",
  enviar_whatsapp: "Mensagem enviada",
  trocar_voz: "Voz alterada",
  conversar: "Resposta pronta",
};

/** Primeiro inteiro encontrado no texto, ou null. */
export function extrairPrimeiroInteiro(texto: string): number | null {
  const m = texto.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Escapa texto para uso em RegExp. */
export function escaparRegex(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Palavra inteira com suporte a acentos (o \b do JS só entende ASCII). */
export function palavraInteira(palavra: string): string {
  return `(?<![\\p{L}\\p{N}_])${escaparRegex(palavra)}(?![\\p{L}\\p{N}_])`;
}

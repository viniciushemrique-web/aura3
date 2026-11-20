/**
 * Mídia do sistema (port do card de Spotify).
 * Lê a sessão de mídia do Windows (GlobalSystemMediaTransportControls), a mesma usada
 * pela barra de volume/flyout de mídia. Funciona com Spotify, navegador, etc.
 */
import { invoke } from "@tauri-apps/api/core";

export interface Midia {
  titulo: string;
  artista: string;
  app: string;
  tocando: boolean;
  posicao_s: number;
  duracao_s: number;
}

declare global {
  interface Window {
    auraMidiaAtualizar?: (snap: Midia | null) => void;
    auraMidiaControle?: (acao: "playpause" | "next" | "prev") => void;
  }
}

export function iniciarMidia(intervaloMs = 1000): void {
  window.auraMidiaControle = (acao) => {
    invoke("midia_controle", { acao }).catch((e) => console.error("Controle de mídia:", e));
  };

  const atualizar = async () => {
    try {
      const snap = await invoke<Midia | null>("midia_atual");
      window.auraMidiaAtualizar?.(snap ?? null);
    } catch (e) {
      console.error("Leitura da mídia:", e);
    }
  };

  void atualizar();
  setInterval(() => void atualizar(), intervaloMs);
}

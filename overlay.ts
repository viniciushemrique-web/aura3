/**
 * Overlay: click-through dinâmico + polling do cursor + ocultar fora da Área de Trabalho
 * (port da parte Win32 de main.py). No Tauri, transparência e janela sem borda vêm do
 * tauri.conf.json; aqui só alternamos setIgnoreCursorEvents conforme o cursor.
 */
import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { ESTADO } from "./estado";

declare global {
  interface Window {
    /** Definido no index.html: recebe a posição do cursor em px CSS da janela. */
    auraApontar?: (x: number, y: number) => void;
  }
}

export function iniciarOverlay(idIlha = "dynamicIsland"): void {
  const janela = getCurrentWindow();

  const estilo = document.createElement("style");
  estilo.textContent = `
    html, body { background: transparent !important; }
    body.aura-oculto { opacity: 0; pointer-events: none; transition: opacity .2s; }`;
  document.head.appendChild(estilo);

  let ultimoVisivel: boolean | null = null;
  let ultimoClickThrough: boolean | null = null;
  let ocupado = false;

  const passo = async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      const visivel = await invoke<boolean>("primeiro_plano_e_area_de_trabalho");
      if (visivel !== ultimoVisivel) {
        ultimoVisivel = visivel;
        ESTADO.atualizar({ visivel });
        document.body.classList.toggle("aura-oculto", !visivel);
        if (!visivel) {
          ultimoClickThrough = true;
          await janela.setIgnoreCursorEvents(true);
        }
      }
      const ilha = document.getElementById(idIlha);
      if (!visivel || !ilha) return;

      const [cursor, pos, escala] = await Promise.all([
        cursorPosition(), janela.outerPosition(), janela.scaleFactor(),
      ]);
      // Com click-through o webview não recebe mousemove: o gatinho recebe o cursor daqui.
      window.auraApontar?.((cursor.x - pos.x) / escala, (cursor.y - pos.y) / escala);
      const r = ilha.getBoundingClientRect();
      const grande = ilha.classList.contains("is-large");

      const x1 = pos.x + Math.trunc((r.left - 8) * escala);
      const y1 = pos.y + Math.trunc((r.top - 6) * escala);
      const x2 = pos.x + Math.trunc((r.right + 8) * escala);
      const y2 = pos.y + Math.trunc((r.bottom + 8) * escala);

      let sobreIlha = cursor.x >= x1 && cursor.x <= x2 && cursor.y >= y1 && cursor.y <= y2;

      // Botões laterais da ilha expandida.
      if (grande && !sobreIlha) {
        const yMid = pos.y + Math.trunc(280 * escala);
        if (Math.abs(cursor.y - yMid) <= Math.trunc(115 * escala)) {
          const raio = Math.trunc(34 * escala);
          const desloc = Math.trunc(40 * escala);
          if (Math.abs(cursor.x - (x1 - desloc)) <= raio || Math.abs(cursor.x - (x2 + desloc)) <= raio) {
            sobreIlha = true;
          }
        }
      }

      const clickThrough = !sobreIlha;
      if (clickThrough !== ultimoClickThrough) {
        ultimoClickThrough = clickThrough;
        await janela.setIgnoreCursorEvents(clickThrough);
      }
    } catch (e) {
      console.error("overlay:", e);
    } finally {
      ocupado = false;
    }
  };

  setInterval(() => void passo(), 40);
}

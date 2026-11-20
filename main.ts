/** Ponto de entrada (port de main.py): nome, janela overlay, ponte com o HTML e assistente. */
import { currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { ALTURA_JANELA, LARGURA_JANELA } from "./core/config";
import { ESTADO } from "./core/estado";
import { Assistente } from "./core/orquestrador";
import { iniciarOverlay } from "./core/overlay";
import { iniciarMidia } from "./core/midia";

declare global {
  interface Window {
    /** Ponte para o index.html (substitui GET /api/estado e POST /api/comando). */
    aura: {
      estado: (desdeNotif: number, desdeMsg: number) => ReturnType<typeof ESTADO.instantaneo>;
      comando: (texto: string) => void;
      assinar: (fn: () => void) => () => void;
    };
  }
}

/** Nome salvo → env → modal simples (window.prompt não é confiável no webview). */
async function obterNomeAssistente(): Promise<string> {
  const env = (import.meta.env.VITE_NOME_ASSISTENTE as string | undefined)?.trim();
  if (env) return env;
  const salvo = localStorage.getItem("aura_nome")?.trim();
  if (salvo) return salvo;

  const janela = getCurrentWindow();
  await janela.setIgnoreCursorEvents(false);
  await janela.setFocus();

  const nome = await new Promise<string>((resolve) => {
    const caixa = document.createElement("div");
    caixa.style.cssText =
      "position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:99999;padding:14px 18px;" +
      "background:#111;color:#fff;border-radius:18px;font:14px system-ui;display:flex;gap:8px;align-items:center";
    caixa.innerHTML =
      '<label>Qual nome você quer dar ao assistente?</label>' +
      '<input id="aura-nome" value="Aura" style="padding:6px 10px;border-radius:8px;border:0;outline:0">' +
      '<button id="aura-ok" style="padding:6px 12px;border-radius:8px;border:0;cursor:pointer">OK</button>';
    document.body.appendChild(caixa);
    const input = caixa.querySelector<HTMLInputElement>("#aura-nome")!;
    const fechar = () => { const v = input.value.trim() || "Aura"; caixa.remove(); resolve(v); };
    caixa.querySelector("#aura-ok")!.addEventListener("click", fechar);
    input.addEventListener("keydown", (e) => e.key === "Enter" && fechar());
    input.focus();
    input.select();
  });
  localStorage.setItem("aura_nome", nome);
  return nome;
}

/** Centraliza a janela no topo do monitor principal. */
async function posicionarJanela(): Promise<void> {
  const janela = getCurrentWindow();
  const monitor = await currentMonitor();
  if (!monitor) return;
  const x = monitor.position.x + Math.max(0, Math.round((monitor.size.width - LARGURA_JANELA * monitor.scaleFactor) / 2));
  await janela.setPosition(new PhysicalPosition(x, monitor.position.y));
}

async function principal(): Promise<void> {
  await posicionarJanela();
  const nome = await obterNomeAssistente();
  ESTADO.atualizar({ nome, visivel: true });
  const assistente = new Assistente(nome);
  document.title = nome;
  await getCurrentWindow().setTitle(nome);

  window.aura = {
    estado: (n, m) => ESTADO.instantaneo(n, m),
    comando: (texto) => {
      const t = String(texto).trim().slice(0, 500);
      if (!t) return;
      ESTADO.adicionarMensagem("user", t);
      void assistente.processarComando(t).catch((e) => console.error("Erro ao processar comando da interface:", e));
    },
    assinar: (fn) => ESTADO.assinar(fn),
  };
  document.dispatchEvent(new CustomEvent("aura-pronta"));

  iniciarOverlay("dynamicIsland");
  iniciarMidia();
  await assistente.executar();
}

void principal();
void ALTURA_JANELA;

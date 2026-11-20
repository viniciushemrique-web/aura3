/** Ações locais do Windows e integrações externas (port de acoes.py). */
import { invoke } from "@tauri-apps/api/core";
import { desktopDir, join } from "@tauri-apps/api/path";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { exists, mkdir, readDir, rename } from "@tauri-apps/plugin-fs";
import { fetch } from "@tauri-apps/plugin-http";
import { CHAVE_PIX, CONTATOS, EXTENSOES_ORGANIZAVEIS, TIMEOUT_WHATSAPP_MS, URL_WHATSAPP } from "./config";
import { ESTADO, notificar } from "./estado";
import { SpotifyCliente } from "./spotify";
import type { Voz } from "./voz";

export class ExecutorAcoes {
  private spotify: SpotifyCliente | null;

  constructor(private nome: string, private voz: Voz) {
    if (SpotifyCliente.configurado()) {
      this.spotify = new SpotifyCliente();
    } else {
      this.spotify = null;
      console.warn("⚠️ Spotify não configurado (defina VITE_SPOTIFY_CLIENT_ID e VITE_SPOTIFY_REFRESH_TOKEN).");
    }
  }

  async trocarVoz(perfil?: string | null): Promise<void> {
    const novo = this.voz.trocarPerfil(perfil);
    if (novo) {
      notificar("Voz alterada", `Perfil ativo: ${novo}`, "success", 3200);
      await this.voz.falar(`Voz alterada para ${novo}. Como estou soando agora?`);
    } else {
      const disponiveis = this.voz.listarPerfis().slice(0, 6).join(", ");
      notificar("Voz não encontrada", "Perfil indisponível", "error", 3200);
      await this.voz.falar(
        disponiveis
          ? `Não encontrei essa voz. As vozes disponíveis são: ${disponiveis}.`
          : "O sintetizador de voz não está ativo no momento.",
      );
    }
  }

  async organizarAreaDeTrabalho(): Promise<void> {
    let desktop: string;
    try {
      desktop = await desktopDir();
      if (!(await exists(desktop))) throw new Error("inexistente");
    } catch {
      await this.voz.falar("Não consegui localizar sua Área de Trabalho.");
      return;
    }

    const nomeSeguro = this.nome.replace(/[<>:"/\\|?*]/g, "").trim() || "Assistente";
    let movidos = 0;
    try {
      const pastaDestino = await join(desktop, `${nomeSeguro} Organizado`);
      if (!(await exists(pastaDestino))) await mkdir(pastaDestino, { recursive: true });

      for (const item of await readDir(desktop)) {
        if (!item.isFile) continue;
        const ponto = item.name.lastIndexOf(".");
        const sufixo = ponto > 0 ? item.name.slice(ponto) : "";
        if (!EXTENSOES_ORGANIZAVEIS.has(sufixo.toLowerCase())) continue;
        const radical = sufixo ? item.name.slice(0, ponto) : item.name;

        let destino = await join(pastaDestino, item.name);
        for (let n = 1; await exists(destino); n++) {
          destino = await join(pastaDestino, `${radical} (${n})${sufixo}`);
        }
        try {
          await rename(await join(desktop, item.name), destino);
          movidos++;
        } catch (e) {
          console.error(`Não foi possível mover '${item.name}':`, e);
        }
      }
    } catch (e) {
      console.error("Erro ao organizar a Área de Trabalho:", e);
      await this.voz.falar("Houve um erro ao acessar seus arquivos da Área de Trabalho.");
      return;
    }

    if (movidos) {
      notificar("Área de Trabalho", `${movidos} arquivos organizados`, "swallow", 2800);
      await this.voz.falar(`Pronto! Organizei ${movidos} arquivos na pasta ${nomeSeguro} Organizado.`);
    } else {
      await this.voz.falar("Sua Área de Trabalho já está limpa e organizada!");
    }
  }

  async alterarVolume(aumentar: boolean): Promise<void> {
    await this.voz.falar(aumentar ? "Aumentando o volume." : "Diminuindo o volume.");
    try {
      await invoke("alterar_volume", { aumentar });
    } catch (e) {
      console.error("Erro ao alterar o volume:", e);
    }
  }

  async iniciarTimer(minutos: number | null): Promise<void> {
    if (!minutos || minutos <= 0) {
      await this.voz.falar("Não entendi a duração do timer.");
      return;
    }
    ESTADO.atualizar({ foco: true, timer_minutos: minutos });
    setTimeout(() => {
      ESTADO.atualizar({ foco: false, timer_minutos: 0 });
      notificar("Timer finalizado", `${minutos} minutos se passaram`, "notification", 4000);
      void this.voz.falar(`Atenção! O seu timer de ${minutos} minutos acabou!`);
    }, minutos * 60_000);
    notificar("Timer iniciado", `${minutos} minutos de contagem`, "success", 2600);
    await this.voz.falar(`Timer de ${minutos} minutos iniciado.`);
  }

  async agendarDesligamento(minutosBruto: unknown): Promise<void> {
    const minutos = Math.trunc(Number(minutosBruto));
    if (!Number.isFinite(minutos) || minutos <= 0) {
      await this.voz.falar("Não entendi em quantos minutos é para desligar.");
      return;
    }
    try {
      await invoke("agendar_desligamento", { minutos });
      notificar("Desligamento agendado", `Em ${minutos} minutos`, "notification", 3000);
      await this.voz.falar(`Computador agendado para desligar em ${minutos} minutos.`);
    } catch (e) {
      console.error("Erro ao agendar desligamento:", e);
      notificar("Falha no desligamento", "Não consegui agendar", "error", 2800);
      await this.voz.falar("Não consegui agendar o desligamento.");
    }
  }

  async cancelarDesligamento(): Promise<void> {
    try {
      await invoke("cancelar_desligamento");
      await this.voz.falar("Desligamento cancelado.");
    } catch {
      await this.voz.falar("Não há desligamento agendado para cancelar.");
    }
  }

  async copiarPix(): Promise<void> {
    if (!CHAVE_PIX) {
      await this.voz.falar("Sua chave PIX ainda não foi configurada.");
      return;
    }
    try {
      await writeText(CHAVE_PIX);
      notificar("Chave PIX copiada", "Pronta para colar", "success", 2400);
      await this.voz.falar("Sua chave PIX foi copiada. Já pode colar onde precisar!");
    } catch (e) {
      console.error("Erro ao acessar a área de transferência:", e);
      await this.voz.falar("Não consegui acessar a área de transferência.");
    }
  }

  async tocarSpotify(musica: string): Promise<void> {
    if (!this.spotify) {
      await this.voz.falar("O Spotify não foi configurado.");
      return;
    }
    if (!musica.trim()) {
      await this.voz.falar("Não entendi qual música tocar.");
      return;
    }
    try {
      const faixa = await this.spotify.buscarFaixa(musica);
      if (!faixa) {
        await this.voz.falar("Música não encontrada.");
        return;
      }
      const dispositivos = await this.spotify.dispositivos();
      if (!dispositivos.length) {
        await this.voz.falar("Abra o aplicativo do Spotify no computador primeiro.");
        return;
      }
      const dispositivo = dispositivos.find((d) => d.is_active) ?? dispositivos[0];
      await this.spotify.tocar(dispositivo.id, faixa.uri);
      notificar("Spotify", faixa.name, "dancing", 3000);
      await this.voz.falar(`Tocando agora ${faixa.name}.`);
    } catch (e) {
      console.error("Erro no Spotify:", e);
      notificar("Falha no Spotify", "Verifique se o app está ativo", "error", 2800);
      await this.voz.falar("Não consegui dar o play. Verifique se o Spotify está ativo.");
    }
  }

  async enviarWhatsapp(contato: string, mensagem: string): Promise<void> {
    const numero = CONTATOS[contato.toLowerCase().trim()];
    if (numero === undefined) {
      await this.voz.falar(`O contato ${contato} não está cadastrado na minha agenda.`);
      return;
    }
    if (!mensagem.trim()) {
      await this.voz.falar("Não entendi qual mensagem enviar.");
      return;
    }
    try {
      const r = await fetch(URL_WHATSAPP, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero, mensagem }),
        signal: AbortSignal.timeout(TIMEOUT_WHATSAPP_MS),
      });
      if (r.ok) {
        notificar("WhatsApp", `Enviado para ${contato}`, "success", 2600);
        await this.voz.falar(`Mensagem enviada para ${contato}.`);
      } else {
        notificar("Falha no WhatsApp", "Erro no servidor de envio", "error", 2800);
        await this.voz.falar("Erro ao processar o envio no servidor do WhatsApp.");
      }
    } catch (e) {
      console.error("Erro de conexão com o servidor do WhatsApp:", e);
      notificar("WhatsApp indisponível", "Servidor local não respondeu", "error", 2800);
      await this.voz.falar("O servidor oculto do WhatsApp não está rodando.");
    }
  }
}

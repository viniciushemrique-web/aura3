/** Monitoramento de ergonomia (20-20-20) e hidratação (port de saude.py). */
import { invoke } from "@tauri-apps/api/core";
import { ESTADO, notificar } from "./estado";

const hojeChave = () => new Date().toDateString();

export class MonitorSaude {
  static readonly META_COPOS = 8;
  static readonly INTERVALO_OLHOS_S = 1200;    // 20 minutos
  static readonly INTERVALO_POSTURA_S = 3600;  // 1 hora
  static readonly LIMITE_ESFORCO_HORA = 1500;
  static readonly LIMITE_ESFORCO_TOTAL = 2500;

  copos = 0;
  cliques = 0;
  teclas = 0;
  segundosAtivos = 0;
  private diaAgua = hojeChave();
  private esforcoUltimoCheckpoint = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private falar: (t: string) => Promise<void>) {}

  iniciar(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  parar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Contadores globais de teclado/mouse vêm do Rust (rdev). */
  private async lerEntrada(): Promise<void> {
    try {
      const [cliques, teclas] = await invoke<[number, number]>("contadores_entrada");
      this.cliques = cliques;
      this.teclas = teclas;
    } catch {
      /* fora do Tauri ou monitor indisponível */
    }
  }

  private publicar(): void {
    ESTADO.atualizar({
      agua_copos: this.copos,
      agua_meta: MonitorSaude.META_COPOS,
      ativo_segundos: this.segundosAtivos,
      cliques: this.cliques,
      teclas: this.teclas,
      limite_esforco: MonitorSaude.LIMITE_ESFORCO_TOTAL,
    });
  }

  private async tick(): Promise<void> {
    await this.lerEntrada();
    this.segundosAtivos += 1;
    const t = this.segundosAtivos;
    let mensagem: string | null = null;

    if (t % MonitorSaude.INTERVALO_POSTURA_S === 0) {
      const total = this.cliques + this.teclas;
      const esforcoHora = total - this.esforcoUltimoCheckpoint;
      this.esforcoUltimoCheckpoint = total;
      mensagem = esforcoHora > MonitorSaude.LIMITE_ESFORCO_HORA
        ? "Identifiquei um alto volume de digitação na última hora. Por favor, levante-se, alongue os pulsos e descanse a postura."
        : "Você está há uma hora em frente ao computador. Que tal uma pausa rápida para esticar as pernas?";
    } else if (t % MonitorSaude.INTERVALO_OLHOS_S === 0) {
      mensagem = "Atenção! Você está focado na tela há vinte minutos. Olhe para longe por vinte segundos para descansar os olhos.";
    }

    this.publicar();

    if (mensagem) {
      notificar("Pausa recomendada", "Descanse os olhos ou a postura", "notification", 4000);
      try {
        await this.falar(mensagem);
      } catch (e) {
        console.error("Erro no alerta de saúde:", e);
      }
    }
  }

  private resetarAguaSeNovoDia(): void {
    const hoje = hojeChave();
    if (hoje !== this.diaAgua) {
      this.diaAgua = hoje;
      this.copos = 0;
    }
  }

  registrarCopoAgua(): string {
    this.resetarAguaSeNovoDia();
    if (this.copos >= MonitorSaude.META_COPOS) {
      return "Parabéns! Você já atingiu a meta de oito copos de água recomendados para hoje!";
    }
    this.copos += 1;
    this.publicar();
    return `Copo de água registrado. Você já bebeu ${this.copos} de ${MonitorSaude.META_COPOS} copos hoje. Continue assim!`;
  }

  statusAgua(): string {
    this.resetarAguaSeNovoDia();
    if (this.copos === 0) return "Você ainda não registrou nenhum copo de água hoje. Lembre-se de se hidratar.";
    return `Até o momento você consumiu ${this.copos} copos de água hoje.`;
  }

  relatorioErgonomia(): string {
    const horas = Math.floor(this.segundosAtivos / 3600);
    const minutos = Math.floor((this.segundosAtivos % 3600) / 60);
    let r = `Você está ativo no computador há ${horas} horas e ${minutos} minutos. ` +
      `Registrei ${this.cliques} cliques e ${this.teclas} teclas pressionadas.`;
    r += this.cliques + this.teclas > MonitorSaude.LIMITE_ESFORCO_TOTAL
      ? " Seu nível de esforço repetitivo está alto. Sugiro fazer uma pausa."
      : " Seu nível de esforço está dentro de um limite seguro.";
    return r;
  }
}

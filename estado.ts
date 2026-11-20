/**
 * Estado compartilhado entre o assistente e a interface (port de servidor_web.py).
 * Não há mais servidor HTTP: lógica e HTML vivem no mesmo webview do Tauri.
 */

export type EstadoAssistente = "ocioso" | "ouvindo" | "pensando" | "falando";
export type TipoNotificacao = "success" | "error" | "notification" | "swallow" | "dancing";

export interface Dados {
  estado: EstadoAssistente;
  nome: string;
  foco: boolean;
  timer_minutos: number;
  agua_copos: number;
  agua_meta: number;
  ativo_segundos: number;
  cliques: number;
  teclas: number;
  limite_esforco: number;
  visivel: boolean;
}

export interface Envelope {
  passo_ms: number;
  valores: number[];
  inicio_ms?: number;
}

export interface Notificacao {
  id: number;
  titulo: string;
  mensagem: string;
  tipo: TipoNotificacao;
  duracao_ms: number;
}

export interface Mensagem {
  id: number;
  de: "user" | "ai";
  texto: string;
}

const MAX_NOTIFICACOES = 50;
const MAX_MENSAGENS = 100;
const HISTORICO_INICIAL = 20;

class EstadoCompartilhado {
  readonly sessao = Math.random().toString(16).slice(2, 10);
  private dados: Dados = {
    estado: "ocioso",
    nome: "Assistente",
    foco: false,
    timer_minutos: 0,
    agua_copos: 0,
    agua_meta: 8,
    ativo_segundos: 0,
    cliques: 0,
    teclas: 0,
    limite_esforco: 2500,
    visivel: true,
  };
  private notificacoes: Notificacao[] = [];
  private mensagens: Mensagem[] = [];
  private seqNotif = 0;
  private seqMsg = 0;
  private fala: Envelope | null = null;
  private ouvintes = new Set<() => void>();

  /** Registra um callback chamado a cada mudança. Devolve a função de cancelar. */
  assinar(fn: () => void): () => void {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  private emitir(): void {
    this.ouvintes.forEach((fn) => {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  atualizar(campos: Partial<Dados>): void {
    Object.assign(this.dados, campos);
    this.emitir();
  }

  ler(): Dados {
    return { ...this.dados };
  }

  definirFala(envelope: Envelope): void {
    this.fala = { ...envelope, inicio_ms: Date.now() };
    this.emitir();
  }

  limparFala(): void {
    this.fala = null;
    this.emitir();
  }

  adicionarNotificacao(titulo: string, mensagem: string, tipo: TipoNotificacao, duracao_ms: number): void {
    this.notificacoes.push({ id: ++this.seqNotif, titulo, mensagem, tipo, duracao_ms });
    this.notificacoes = this.notificacoes.slice(-MAX_NOTIFICACOES);
    this.emitir();
  }

  adicionarMensagem(de: "user" | "ai", texto: string): void {
    const limpo = String(texto).split(/\s+/).filter(Boolean).join(" ");
    if (!limpo) return;
    this.mensagens.push({ id: ++this.seqMsg, de, texto: limpo });
    this.mensagens = this.mensagens.slice(-MAX_MENSAGENS);
    this.emitir();
  }

  /** Mesmo formato do antigo GET /api/estado. */
  instantaneo(desdeNotif: number, desdeMsg: number) {
    const notificacoes = desdeNotif < 0 ? [] : this.notificacoes.filter((n) => n.id > desdeNotif);
    const mensagens = desdeMsg <= 0
      ? this.mensagens.slice(-HISTORICO_INICIAL)
      : this.mensagens.filter((m) => m.id > desdeMsg);
    return {
      ...this.dados,
      sessao: this.sessao,
      fala: this.fala ? { ...this.fala } : null,
      notificacoes,
      mensagens,
      seq_notif: this.seqNotif,
    };
  }
}

export const ESTADO = new EstadoCompartilhado();

/** Dispara um banner na Dynamic Island. */
export function notificar(
  titulo: string,
  mensagem: string,
  tipo: TipoNotificacao = "notification",
  duracao_ms = 3000,
): void {
  ESTADO.adicionarNotificacao(titulo, mensagem, tipo, duracao_ms);
}

/** Curva de amplitude (0 a 1) a partir de PCM, para animar a boca do mascote. */
export function calcularEnvelope(amostras: Float32Array, taxa: number, fps = 30): Envelope {
  const passo = Math.max(1, Math.floor(taxa / fps));
  const janelas = Math.floor(amostras.length / passo);
  const passo_ms = (1000 * passo) / taxa;
  if (janelas === 0) return { passo_ms, valores: [] };

  const rms: number[] = [];
  for (let j = 0; j < janelas; j++) {
    let soma = 0;
    for (let i = j * passo; i < (j + 1) * passo; i++) soma += amostras[i] * amostras[i];
    rms.push(Math.sqrt(soma / passo));
  }
  const ordenado = [...rms].sort((a, b) => a - b);
  const p95 = ordenado[Math.min(ordenado.length - 1, Math.floor(0.95 * (ordenado.length - 1)))];
  const ref = Math.max(p95, 1e-6);
  const norm = rms.map((v) => Math.min(1, Math.max(0, v / ref)));
  const valores = norm.map((v, i) =>
    Math.round((0.25 * (norm[i - 1] ?? 0) + 0.5 * v + 0.25 * (norm[i + 1] ?? 0)) * 1000) / 1000);
  return { passo_ms, valores };
}

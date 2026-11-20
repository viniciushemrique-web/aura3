/**
 * Síntese de voz (port de voz.py).
 * Usa as vozes pt-BR do sistema via Web Speech API (offline com vozes do Windows).
 * Para Kokoro/ONNX real, implemente a mesma interface em um sidecar e troque `reproduzir`.
 */
import { ESTADO, calcularEnvelope, type Envelope } from "./estado";
import { IDIOMA_VOZ, VELOCIDADE_VOZ, VOZ_PADRAO } from "./config";

export { calcularEnvelope };

const NOMES_FEMININOS = ["francisca", "maria", "heloisa", "thalita", "luciana", "fernanda", "camila", "vitoria", "brenda", "leticia", "yara"];
const NOMES_MASCULINOS = ["antonio", "daniel", "felipe", "donato", "humberto", "julio", "valerio", "fabio", "ricardo", "nicolau"];

/** Aproximação de envelope quando não há PCM disponível (Web Speech não expõe o áudio). */
function envelopeSintetico(texto: string, velocidade: number): Envelope {
  const duracaoMs = Math.max(600, (texto.length * 62) / velocidade);
  const passo_ms = 33;
  const n = Math.floor(duracaoMs / passo_ms);
  const valores: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = Math.abs(Math.sin(i * 0.9)) * 0.6 + Math.abs(Math.sin(i * 0.37)) * 0.4;
    valores.push(Math.round(v * 1000) / 1000);
  }
  return { passo_ms, valores };
}

export class Voz {
  perfil: string;
  private catalogo: Record<string, string> = {};
  private fila: Promise<void> = Promise.resolve();

  constructor(readonly nomeAssistente: string, perfil: string = VOZ_PADRAO) {
    this.perfil = perfil;
    this.construirCatalogo();
    if ("speechSynthesis" in window) {
      // As vozes carregam de forma assíncrona no WebView2.
      speechSynthesis.addEventListener("voiceschanged", () => this.construirCatalogo());
    } else {
      console.error("❌ speechSynthesis indisponível. Fala desativada.");
    }
  }

  private construirCatalogo(): void {
    if (!("speechSynthesis" in window)) return;
    const vozes = speechSynthesis.getVoices()
      .filter((v) => v.lang.toLowerCase().startsWith("pt"))
      .sort((a, b) => Number(b.lang === IDIOMA_VOZ) - Number(a.lang === IDIOMA_VOZ));

    const catalogo: Record<string, string> = {};
    const generoDe = (nome: string) => {
      const n = nome.toLowerCase();
      if (NOMES_FEMININOS.some((x) => n.includes(x))) return "f";
      if (NOMES_MASCULINOS.some((x) => n.includes(x))) return "m";
      return "?";
    };
    const masc = vozes.find((v) => generoDe(v.name) === "m");
    const fem = vozes.find((v) => generoDe(v.name) === "f");
    if (masc) catalogo["masculina"] = masc.name;
    if (fem) catalogo["feminina"] = fem.name;

    for (const v of vozes) {
      const apelido = v.name.match(/^(?:Microsoft|Google)\s+(\S+)/)?.[1] ?? v.name;
      const chave = apelido in catalogo ? v.name : apelido;
      catalogo[chave] = v.name;
    }
    this.catalogo = catalogo;
    if (!(this.perfil in catalogo)) this.perfil = Object.keys(catalogo)[0] ?? this.perfil;
  }

  listarPerfis(): string[] {
    return Object.keys(this.catalogo);
  }

  /** Troca para um perfil específico (ou por gênero) ou alterna para o próximo. */
  trocarPerfil(perfil?: string | null): string | null {
    const chaves = this.listarPerfis();
    if (!chaves.length) return null;

    if (!perfil) {
      const idx = chaves.indexOf(this.perfil);
      this.perfil = chaves[(idx + 1) % chaves.length];
      return this.perfil;
    }

    const alvo = perfil.toLowerCase().trim();
    if (["feminina", "mulher", "garota"].some((p) => alvo.includes(p)) && this.catalogo["feminina"]) {
      return (this.perfil = "feminina");
    }
    if (["masculina", "homem", "rapaz"].some((p) => alvo.includes(p)) && this.catalogo["masculina"]) {
      return (this.perfil = "masculina");
    }
    const achado = chaves.find(
      (c) => alvo === c.toLowerCase() || alvo === this.catalogo[c].toLowerCase() || c.toLowerCase().includes(alvo),
    );
    if (achado) return (this.perfil = achado);
    return null;
  }

  /** Imprime e fala o texto sem propagar exceções. Falas são enfileiradas. */
  falar(texto: string): Promise<void> {
    console.log(`🤖 ${this.nomeAssistente}: ${texto}`);
    ESTADO.adicionarMensagem("ai", texto);
    this.fila = this.fila.then(async () => {
      ESTADO.atualizar({ estado: "falando" });
      try {
        await this.reproduzir(texto);
      } finally {
        ESTADO.limparFala();
        ESTADO.atualizar({ estado: "ocioso" });
      }
    });
    return this.fila;
  }

  private reproduzir(texto: string): Promise<void> {
    const limpo = texto.split(/\s+/).filter(Boolean).join(" ");
    if (!limpo || !("speechSynthesis" in window)) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(limpo);
      u.lang = IDIOMA_VOZ;
      u.rate = VELOCIDADE_VOZ;
      const nomeVoz = this.catalogo[this.perfil];
      const voz = speechSynthesis.getVoices().find((v) => v.name === nomeVoz);
      if (voz) u.voice = voz;

      const seguranca = setTimeout(done, (limpo.length * 62) / VELOCIDADE_VOZ * 2 + 3000);
      function done() {
        clearTimeout(seguranca);
        resolve();
      }
      u.onstart = () => ESTADO.definirFala(envelopeSintetico(limpo, VELOCIDADE_VOZ));
      u.onend = done;
      u.onerror = (e) => {
        console.error("Erro ao reproduzir a voz:", e.error);
        done();
      };
      speechSynthesis.speak(u);
    });
  }
}

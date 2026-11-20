/**
 * Escuta contínua de voz.
 *
 * Por que não usar webkitSpeechRecognition: no WebView2 ele depende do serviço de voz
 * do Google, que não vem habilitado no webview. Ele falha (erro "network") sem avisar
 * e o assistente nunca recebe nada.
 *
 * Aqui o microfone é lido direto (getUserMedia), a fala é cortada por volume e cada
 * trecho falado é transcrito pelo Gemini, que já é usado pelo projeto.
 */
import { ModeloIA } from "./ia";

const TAXA_ALVO = 16_000;   // taxa usada no WAV enviado ao Gemini
const BLOCO = 4096;         // amostras por bloco do processador de áudio
const PAUSA_FIM_MS = 700;   // silêncio que encerra uma frase
const MIN_FALA_MS = 350;    // trechos menores são ruído
const MAX_FALA_MS = 12_000; // corte de segurança
const PRE_ROLL_MS = 250;    // áudio guardado antes do início detectado da fala

export class Reconhecedor {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processador: ScriptProcessorNode | null = null;
  private ia: ModeloIA | null = ModeloIA.configurado() ? new ModeloIA() : null;
  private fila: Promise<void> = Promise.resolve();

  /** Devolve true se o microfone foi aberto e a escuta começou. */
  async iniciar(aoTexto: (texto: string) => void, deveIgnorar: () => boolean = () => false): Promise<boolean> {
    if (!this.ia) {
      console.error("❌ Gemini não configurado: sem chave, não há transcrição de voz.");
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      console.error("❌ getUserMedia indisponível neste webview.");
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      console.error("❌ Microfone indisponível ou negado:", e);
      return false;
    }

    this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    const fonte = this.ctx.createMediaStreamSource(this.stream);
    const processador = this.ctx.createScriptProcessor(BLOCO, 1, 1);
    this.processador = processador;
    // Ligado ao destino com ganho zero: alguns motores só disparam o evento assim, sem ecoar o microfone.
    const mudo = this.ctx.createGain();
    mudo.gain.value = 0;
    fonte.connect(processador);
    processador.connect(mudo);
    mudo.connect(this.ctx.destination);

    const taxa = this.ctx.sampleRate;
    const blocoMs = (BLOCO / taxa) * 1000;
    const preRollMax = Math.ceil(PRE_ROLL_MS / blocoMs);
    const pausaBlocos = Math.ceil(PAUSA_FIM_MS / blocoMs);
    const maxBlocos = Math.ceil(MAX_FALA_MS / blocoMs);
    const minBlocos = Math.ceil(MIN_FALA_MS / blocoMs);

    let ruidoBase = 0.01;
    let falando = false;
    let silencio = 0;
    let trecho: Float32Array[] = [];
    let preRoll: Float32Array[] = [];

    processador.onaudioprocess = (ev) => {
      const bloco = new Float32Array(ev.inputBuffer.getChannelData(0));

      if (deveIgnorar()) {
        // Ex.: o assistente está falando. Descarta o que estava em andamento.
        falando = false;
        trecho = [];
        preRoll = [];
        return;
      }

      let soma = 0;
      for (let i = 0; i < bloco.length; i++) soma += bloco[i] * bloco[i];
      const volume = Math.sqrt(soma / bloco.length);
      const limiar = Math.max(0.012, ruidoBase * 3.5);

      if (!falando) {
        ruidoBase = ruidoBase * 0.95 + volume * 0.05; // acompanha o ruído ambiente
        preRoll.push(bloco);
        if (preRoll.length > preRollMax) preRoll.shift();
        if (volume > limiar) {
          falando = true;
          trecho = [...preRoll];
          silencio = 0;
        }
        return;
      }

      trecho.push(bloco);
      silencio = volume > limiar ? 0 : silencio + 1;

      if (silencio >= pausaBlocos || trecho.length >= maxBlocos) {
        const pronto = trecho;
        const falaBlocos = pronto.length - silencio;
        falando = false;
        trecho = [];
        preRoll = [];
        if (falaBlocos >= minBlocos) this.enfileirarTranscricao(pronto, taxa, aoTexto);
      }
    };

    return true;
  }

  private enfileirarTranscricao(blocos: Float32Array[], taxaOrigem: number, aoTexto: (t: string) => void): void {
    this.fila = this.fila.then(async () => {
      try {
        const pcm = reamostrar(concatenar(blocos), taxaOrigem, TAXA_ALVO);
        const wav = codificarWav(pcm, TAXA_ALVO);
        const texto = (await this.ia?.transcrever(paraBase64(wav))) ?? "";
        if (texto) {
          console.log(`🗣️ Captado: ${texto}`);
          aoTexto(texto);
        }
      } catch (e) {
        console.error("Erro na transcrição de voz:", e);
      }
    });
  }

  parar(): void {
    this.processador?.disconnect();
    this.processador = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}

function concatenar(blocos: Float32Array[]): Float32Array {
  const total = blocos.reduce((soma, b) => soma + b.length, 0);
  const saida = new Float32Array(total);
  let pos = 0;
  for (const b of blocos) {
    saida.set(b, pos);
    pos += b.length;
  }
  return saida;
}

/** Reduz a taxa por média de janelas (suficiente para voz). */
function reamostrar(entrada: Float32Array, taxaOrigem: number, taxaAlvo: number): Float32Array {
  if (taxaOrigem === taxaAlvo) return entrada;
  const razao = taxaOrigem / taxaAlvo;
  const n = Math.floor(entrada.length / razao);
  const saida = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ini = Math.floor(i * razao);
    const fim = Math.min(entrada.length, Math.floor((i + 1) * razao));
    let soma = 0;
    for (let j = ini; j < fim; j++) soma += entrada[j];
    saida[i] = fim > ini ? soma / (fim - ini) : 0;
  }
  return saida;
}

function codificarWav(amostras: Float32Array, taxa: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + amostras.length * 2);
  const v = new DataView(buffer);
  const texto = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  texto(0, "RIFF");
  v.setUint32(4, 36 + amostras.length * 2, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);            // PCM
  v.setUint16(22, 1, true);            // mono
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);           // 16 bits
  texto(36, "data");
  v.setUint32(40, amostras.length * 2, true);
  for (let i = 0; i < amostras.length; i++) {
    const s = Math.max(-1, Math.min(1, amostras[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function paraBase64(bytes: Uint8Array): string {
  let bin = "";
  const tamanho = 0x8000;
  for (let i = 0; i < bytes.length; i += tamanho) {
    bin += String.fromCharCode(...bytes.subarray(i, i + tamanho));
  }
  return btoa(bin);
}

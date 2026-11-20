/**
 * Cliente Spotify Web API (substitui spotipy).
 * Usa um refresh token obtido uma única vez via Authorization Code + PKCE
 * (escopos: user-modify-playback-state user-read-playback-state).
 */
import { fetch } from "@tauri-apps/plugin-http";
import { SPOTIFY } from "./config";

export class ErroSpotify extends Error {}

interface Faixa { uri: string; name: string }
interface Dispositivo { id: string; is_active?: boolean }

export class SpotifyCliente {
  private token = "";
  private expiraEm = 0;

  static configurado(): boolean {
    return Boolean(SPOTIFY.clientId && SPOTIFY.refreshToken);
  }

  private async tokenValido(): Promise<string> {
    if (this.token && Date.now() < this.expiraEm - 30_000) return this.token;
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: SPOTIFY.refreshToken,
        client_id: SPOTIFY.clientId,
      }).toString(),
    });
    if (!r.ok) throw new ErroSpotify(`Falha ao renovar token (${r.status})`);
    const j = await r.json();
    this.token = j.access_token;
    this.expiraEm = Date.now() + j.expires_in * 1000;
    return this.token;
  }

  private async api(caminho: string, init: RequestInit = {}) {
    const r = await fetch(`https://api.spotify.com/v1${caminho}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${await this.tokenValido()}`,
        "Content-Type": "application/json",
      },
    });
    if (!r.ok) throw new ErroSpotify(`Spotify ${r.status}`);
    return r.status === 204 ? null : r.json();
  }

  async buscarFaixa(q: string): Promise<Faixa | null> {
    const j = await this.api(`/search?type=track&limit=1&q=${encodeURIComponent(q)}`);
    return j?.tracks?.items?.[0] ?? null;
  }

  async dispositivos(): Promise<Dispositivo[]> {
    const j = await this.api("/me/player/devices");
    return j?.devices ?? [];
  }

  async tocar(deviceId: string, uri: string): Promise<void> {
    await this.api(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: "PUT",
      body: JSON.stringify({ uris: [uri] }),
    });
  }
}

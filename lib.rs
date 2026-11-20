use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

/// Sessão de mídia atual do sistema (a mesma que aparece na barra de volume do Windows).
#[derive(Clone, Serialize)]
pub struct Midia {
    pub titulo: String,
    pub artista: String,
    pub app: String,
    pub tocando: bool,
    pub posicao_s: f64,
    pub duracao_s: f64,
}

/// Preenchido pela thread de monitoramento (win::iniciar_monitor).
static MIDIA: std::sync::Mutex<Option<Midia>> = std::sync::Mutex::new(None);

#[tauri::command]
fn midia_atual() -> Option<Midia> {
    MIDIA.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
fn midia_controle(acao: String) {
    #[cfg(windows)]
    win::midia_controle(&acao);
    #[cfg(not(windows))]
    let _ = acao;
}

static CLIQUES: AtomicU64 = AtomicU64::new(0);
static TECLAS: AtomicU64 = AtomicU64::new(0);

/// Cliques e teclas globais (substitui pynput).
#[tauri::command]
fn contadores_entrada() -> (u64, u64) {
    (CLIQUES.load(Ordering::Relaxed), TECLAS.load(Ordering::Relaxed))
}

#[tauri::command]
fn alterar_volume(aumentar: bool) {
    #[cfg(windows)]
    win::tecla_midia(if aumentar { 0xAF } else { 0xAE }, 5); // VK_VOLUME_UP / DOWN
    #[cfg(not(windows))]
    let _ = aumentar;
}

fn executar_shutdown(args: &[&str]) -> Result<(), String> {
    let mut cmd = std::process::Command::new("shutdown");
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    match cmd.status() {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("shutdown retornou {s}")),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn agendar_desligamento(minutos: u32) -> Result<(), String> {
    if minutos == 0 {
        return Err("minutos inválidos".into());
    }
    executar_shutdown(&["/s", "/t", &(minutos as u64 * 60).to_string()])
}

#[tauri::command]
fn cancelar_desligamento() -> Result<(), String> {
    executar_shutdown(&["/a"])
}

/// true se a janela em primeiro plano é do próprio app, do desktop/barra de tarefas,
/// invisível ou minimizada (a ilha só aparece nesses casos).
#[tauri::command]
fn primeiro_plano_e_area_de_trabalho() -> bool {
    #[cfg(windows)]
    {
        win::primeiro_plano_e_desktop()
    }
    #[cfg(not(windows))]
    {
        true
    }
}

#[cfg(windows)]
mod win {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Gerenciador,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
    use windows::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    };

    const CLASSES: [&str; 6] = [
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd",
        "NotifyIconOverflowWindow", "Windows.UI.Core.CoreWindow",
    ];

    pub fn tecla_midia(vk: u8, vezes: u8) {
        unsafe {
            for _ in 0..vezes {
                keybd_event(vk, 0, KEYBD_EVENT_FLAGS(0), 0);
                keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
            }
        }
    }

    /// Lê a sessão de mídia atual do Windows (chamado pela thread de monitoramento).
    fn ler_midia() -> windows::core::Result<Option<super::Midia>> {
        let gerenciador = Gerenciador::RequestAsync()?.get()?;
        let sessao = match gerenciador.GetCurrentSession() {
            Ok(s) => s,
            Err(_) => return Ok(None),
        };
        let props = sessao.TryGetMediaPropertiesAsync()?.get()?;
        let info = sessao.GetPlaybackInfo()?;
        let tempo = sessao.GetTimelineProperties()?;
        Ok(Some(super::Midia {
            titulo: props.Title()?.to_string(),
            artista: props.Artist()?.to_string(),
            app: sessao.SourceAppUserModelId()?.to_string(),
            tocando: info.PlaybackStatus()? == Status::Playing,
            // TimeSpan é contado em intervalos de 100 ns
            posicao_s: tempo.Position()?.Duration as f64 / 1e7,
            duracao_s: tempo.EndTime()?.Duration as f64 / 1e7,
        }))
    }

    /// Thread própria (COM/WinRT em MTA) que atualiza o snapshot a cada ~0,8 s.
    pub fn iniciar_monitor() {
        std::thread::spawn(|| {
            unsafe {
                let _ = RoInitialize(RO_INIT_MULTITHREADED);
            }
            loop {
                let atual = ler_midia().unwrap_or(None);
                if let Ok(mut guarda) = super::MIDIA.lock() {
                    *guarda = atual;
                }
                std::thread::sleep(std::time::Duration::from_millis(800));
            }
        });
    }

    /// Envia play/pausa, próxima ou anterior para a sessão atual (em thread própria, sem travar a UI).
    pub fn midia_controle(acao: &str) {
        let acao = acao.to_string();
        std::thread::spawn(move || {
            unsafe {
                let _ = RoInitialize(RO_INIT_MULTITHREADED);
            }
            let Ok(gerenciador) = Gerenciador::RequestAsync().and_then(|op| op.get()) else {
                return;
            };
            let Ok(sessao) = gerenciador.GetCurrentSession() else {
                return;
            };
            let _ = match acao.as_str() {
                "playpause" => sessao.TryTogglePlayPauseAsync().and_then(|op| op.get()),
                "next" => sessao.TrySkipNextAsync().and_then(|op| op.get()),
                "prev" => sessao.TrySkipPreviousAsync().and_then(|op| op.get()),
                _ => return,
            };
        });
    }

    pub fn primeiro_plano_e_desktop() -> bool {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_invalid() {
                return true;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == std::process::id() {
                return true;
            }
            let mut buf = [0u16; 256];
            let n = GetClassNameW(hwnd, &mut buf).max(0) as usize;
            if CLASSES.contains(&String::from_utf16_lossy(&buf[..n]).as_str()) {
                return true;
            }
            !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool()
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    win::iniciar_monitor();

    std::thread::spawn(|| {
        use rdev::{listen, EventType};
        let _ = listen(|e| match e.event_type {
            EventType::ButtonPress(_) => { CLIQUES.fetch_add(1, Ordering::Relaxed); }
            EventType::KeyPress(_) => { TECLAS.fetch_add(1, Ordering::Relaxed); }
            _ => {}
        });
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            contadores_entrada,
            alterar_volume,
            agendar_desligamento,
            cancelar_desligamento,
            primeiro_plano_e_area_de_trabalho,
            midia_atual,
            midia_controle
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Tauri");
}

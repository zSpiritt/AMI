#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Stdio, Child};
use std::fs;
use std::path::PathBuf;
use std::io::Write;
use std::sync::{Mutex, Arc};
use std::collections::HashMap;
use tauri::State;

struct ServerProcesses(Arc<Mutex<HashMap<String, Child>>>);

fn servers_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Impossible de trouver le dossier home");
    home.join("AMI").join("servers")
}

fn php_bin(server_path: &PathBuf) -> PathBuf {
    if cfg!(target_os = "windows") {
        server_path.join("bin").join("bin").join("php").join("php.exe")
    } else if cfg!(target_os = "macos") {
        server_path.join("bin").join("bin").join("php7").join("bin").join("php")
    } else {
        server_path.join("bin").join("bin").join("php7").join("bin").join("php")
    }
}
#[tauri::command]
fn get_servers() -> Vec<String> {
    let dir = servers_dir();
    if !dir.exists() { return vec![]; }
    fs::read_dir(dir).unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
fn create_server(name: String) -> Result<String, String> {
    let path = servers_dir().join(&name);
    if path.exists() { return Err("Un serveur avec ce nom existe déjà".to_string()); }
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(format!("Serveur '{}' créé", name))
}

#[tauri::command]
fn setup_server(name: String) -> Result<String, String> {
    let path = servers_dir().join(&name);
    let bin_dir = path.join("bin");
    fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;

    let is_windows = cfg!(target_os = "windows");
    let is_macos = cfg!(target_os = "macos");

    let php_url = if cfg!(target_os = "windows") {
           "https://github.com/pmmp/PHP-Binaries/releases/download/pm5-php-8.4-latest/PHP-8.4-Windows-x64-PM5.zip"
    } else if cfg!(target_os = "macos") {
          "https://github.com/pmmp/PHP-Binaries/releases/download/pm5-php-8.4-latest/PHP-8.4-MacOS-x86_64-PM5.tar.gz"
     } else {
          "https://github.com/pmmp/PHP-Binaries/releases/download/pm5-php-8.4-latest/PHP-8.4-Linux-x86_64-PM5.tar.gz"
     };

    let archive_ext = if is_windows { "zip" } else { "tar.gz" };
    let php_archive = bin_dir.join(format!("php.{}", archive_ext));

    let status = Command::new("curl")
        .args(["-L", "-o", php_archive.to_str().unwrap(), php_url])
        .status().map_err(|e| e.to_string())?;
    if !status.success() { return Err("Échec téléchargement PHP".to_string()); }

    if is_windows {
        Command::new("powershell")
            .args(["-Command", &format!(
                "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                php_archive.to_str().unwrap(), bin_dir.to_str().unwrap()
            )]).status().map_err(|e| e.to_string())?;
    } else {
        Command::new("tar")
            .args(["-xzf", php_archive.to_str().unwrap(), "-C", bin_dir.to_str().unwrap(), "--strip-components=0"])
            .status().map_err(|e| e.to_string())?;
    }
    fs::remove_file(&php_archive).ok();
    let phar_url = "https://github.com/pmmp/PocketMine-MP/releases/latest/download/PocketMine-MP.phar";
    let phar_path = path.join("PocketMine-MP.phar");
    let status = Command::new("curl")
        .args(["-L", "-o", phar_path.to_str().unwrap(), phar_url])
        .status().map_err(|e| e.to_string())?;
    if !status.success() { return Err("Échec téléchargement PocketMine".to_string()); }

    let mut eula = fs::File::create(path.join("eula.txt")).map_err(|e| e.to_string())?;
    eula.write_all(b"eula=true\n").map_err(|e| e.to_string())?;

    if !is_windows {
        Command::new("chmod").args(["-R", "+x", bin_dir.to_str().unwrap()]).status().ok();
    }

    Ok("Installation terminée".to_string())
}

#[tauri::command]
fn start_server(name: String, state: State<ServerProcesses>) -> Result<String, String> {
    let path = servers_dir().join(&name);
    let php = php_bin(&path);
    let phar = path.join("PocketMine-MP.phar");

    if !php.exists() || !phar.exists() {
        return Err("PHP ou PocketMine non installé".to_string());
    }

    let log_path = path.join("server.log");
    fs::write(&log_path, "").map_err(|e| e.to_string())?;

    let child = if cfg!(target_os = "windows") {
        let log_file = fs::File::create(&log_path).map_err(|e| e.to_string())?;
        let log_stderr = log_file.try_clone().map_err(|e| e.to_string())?;
        Command::new(&php)
            .arg(&phar)
            .arg("--no-wizard")
            .current_dir(&path)
            .stdin(Stdio::piped())
            .stdout(log_file)
            .stderr(log_stderr)
            .spawn()
            .map_err(|e| e.to_string())?
    } else {

        Command::new("script")
            .args([
                "-q", "-f",
                log_path.to_str().unwrap(),
                "-c",
                &format!(
                    "{} {} --no-wizard",
                    php.to_str().unwrap(),
                    phar.to_str().unwrap()
                ),
            ])
            .current_dir(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?
    };

    let mut map = state.0.lock().unwrap();
    map.insert(name.clone(), child);
    Ok(format!("Serveur '{}' démarré", name))
}

#[tauri::command]
fn stop_server(name: String, state: State<ServerProcesses>) -> Result<String, String> {
    let mut map = state.0.lock().unwrap();
    if let Some(child) = map.get_mut(&name) {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = stdin.write_all(b"stop\n");
        }
        std::thread::sleep(std::time::Duration::from_millis(2000));
        let _ = child.kill();
        map.remove(&name);
    } else {
        if cfg!(target_os = "windows") {
            Command::new("taskkill")
                .args(["/F", "/IM", "php.exe"])
                .status().ok();
        } else {
            Command::new("pkill")
                .args(["-f", "PocketMine-MP.phar"])
                .status().ok();
        }
    }
    Ok("Serveur arrêté".to_string())
}

#[tauri::command]
fn send_server_command(name: String, command: String, state: State<ServerProcesses>) -> Result<String, String> {
    let mut map = state.0.lock().unwrap();
    if let Some(child) = map.get_mut(&name) {
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(format!("{}\n", command).as_bytes()).map_err(|e| e.to_string())?;
            return Ok("Commande envoyée".to_string());
        }
    }
    Err("Serveur non accessible".to_string())
}

#[tauri::command]
fn is_server_ready(name: String) -> bool {
    let path = servers_dir().join(&name);
    php_bin(&path).exists() && path.join("PocketMine-MP.phar").exists()
}

#[tauri::command]
fn is_server_running(name: String, state: State<ServerProcesses>) -> bool {
    let mut map = state.0.lock().unwrap();
    if let Some(child) = map.get_mut(&name) {
        match child.try_wait() {
            Ok(None) => true,
            _ => { map.remove(&name); false }
        }
    } else { false }
}

#[tauri::command]
fn get_server_logs(name: String) -> String {
    let path = servers_dir().join(&name).join("server.log");
    if path.exists() {
        let raw = fs::read_to_string(&path).unwrap_or_default();
        raw.lines()
            .map(|l| l.trim_end_matches('\r'))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        "".to_string()
    }
}

#[tauri::command]
fn get_log_size(name: String) -> u64 {
    let path = servers_dir().join(&name).join("server.log");
    fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

#[tauri::command]
fn clear_server_logs(name: String) -> Result<String, String> {
    let path = servers_dir().join(&name).join("server.log");
    fs::write(&path, "").map_err(|e| e.to_string())?;
    Ok("Console clear".to_string())
}

#[tauri::command]
fn list_dir_files(name: String, subpath: String) -> Vec<serde_json::Value> {
    let base = servers_dir().join(&name);
    let path = if subpath.is_empty() { base.clone() } else { base.join(&subpath) };
    if !path.exists() { return vec![]; }
    let mut entries: Vec<serde_json::Value> = fs::read_dir(&path).unwrap()
        .filter_map(|e| e.ok())
        .map(|e| {
            let meta = e.metadata().unwrap();
            serde_json::json!({
                "name": e.file_name().to_string_lossy().to_string(),
                "is_dir": meta.is_dir(),
                "size": meta.len()
            })
        }).collect();
    entries.sort_by(|a, b| {
        let ad = a["is_dir"].as_bool().unwrap_or(false);
        let bd = b["is_dir"].as_bool().unwrap_or(false);
        if ad && !bd { return std::cmp::Ordering::Less; }
        if !ad && bd { return std::cmp::Ordering::Greater; }
        a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
    });
    entries
}

#[tauri::command]
fn read_server_file(name: String, subpath: String) -> Result<String, String> {
    fs::read_to_string(servers_dir().join(&name).join(&subpath)).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_server_file(name: String, subpath: String, content: String) -> Result<String, String> {
    fs::write(servers_dir().join(&name).join(&subpath), content).map_err(|e| e.to_string())?;
    Ok("Sauvegardé".to_string())
}

#[tauri::command]
fn create_server_file(name: String, subpath: String, file_name: String) -> Result<String, String> {
    let base = servers_dir().join(&name);
    let path = if subpath.is_empty() { base.join(&file_name) } else { base.join(&subpath).join(&file_name) };
    fs::write(&path, "").map_err(|e| e.to_string())?;
    Ok("Fichier créé".to_string())
}

#[tauri::command]
fn create_server_folder(name: String, subpath: String, folder_name: String) -> Result<String, String> {
    let base = servers_dir().join(&name);
    let path = if subpath.is_empty() { base.join(&folder_name) } else { base.join(&subpath).join(&folder_name) };
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok("Dossier créé".to_string())
}

#[tauri::command]
fn delete_server_files(name: String, paths: Vec<String>) -> Result<String, String> {
    for subpath in &paths {
        let path = servers_dir().join(&name).join(subpath);
        if path.is_dir() { fs::remove_dir_all(&path).map_err(|e| e.to_string())?; }
        else { fs::remove_file(&path).map_err(|e| e.to_string())?; }
    }
    Ok("Supprimé".to_string())
}

#[tauri::command]
fn get_server_info(name: String) -> serde_json::Value {
    let path = servers_dir().join(&name);
    let props = path.join("server.properties");
    let mut port = "19132".to_string();
    if let Ok(content) = fs::read_to_string(&props) {
        for line in content.lines() {
            if line.starts_with("server-port=") {
                port = line.replace("server-port=", "").trim().to_string();
            }
        }
    }
    serde_json::json!({ "ram": "512 Mo", "port": port })
}

#[tauri::command]
fn get_available_versions() -> Vec<String> {
    let output = Command::new("curl")
        .args(["-s", "https://api.github.com/repos/pmmp/PocketMine-MP/releases"])
        .output();
    match output {
        Ok(out) => {
            let body = String::from_utf8_lossy(&out.stdout);
            body.lines()
                .filter(|l| l.contains("\"tag_name\""))
                .take(10)
                .map(|l| l.replace("\"tag_name\":", "").replace("\"", "").replace(",", "").trim().to_string())
                .collect()
        }
        Err(_) => vec!["5.41.1".to_string(), "5.41.0".to_string(), "5.40.0".to_string()]
    }
}

#[tauri::command]
fn get_server_version(name: String) -> String {
    let path = servers_dir().join(&name).join("version.txt");
    fs::read_to_string(path).unwrap_or_else(|_| "5.41.1".to_string())
}

#[tauri::command]
fn update_server_version(name: String, version: String) -> Result<String, String> {
    let phar_url = format!(
        "https://github.com/pmmp/PocketMine-MP/releases/download/{}/PocketMine-MP.phar",
        version
    );
    let phar_path = servers_dir().join(&name).join("PocketMine-MP.phar");
    let status = Command::new("curl")
        .args(["-L", "-o", phar_path.to_str().unwrap(), &phar_url])
        .status().map_err(|e| e.to_string())?;
    if !status.success() { return Err("Échec du téléchargement".to_string()); }
    fs::write(servers_dir().join(&name).join("version.txt"), &version).map_err(|e| e.to_string())?;
    Ok(format!("Mis à jour vers {}", version))
}

fn main() {
    tauri::Builder::default()
        .manage(ServerProcesses(Arc::new(Mutex::new(HashMap::new()))))
        .invoke_handler(tauri::generate_handler![
            get_servers,
            create_server,
            setup_server,
            start_server,
            stop_server,
            send_server_command,
            is_server_ready,
            is_server_running,
            get_server_logs,
            get_log_size,
            clear_server_logs,
            list_dir_files,
            read_server_file,
            write_server_file,
            create_server_file,
            create_server_folder,
            delete_server_files,
            get_server_info,
            get_available_versions,
            get_server_version,
            update_server_version,
        ])
        .run(tauri::generate_context!())
        .expect("Erreur au lancement de AMI");
}

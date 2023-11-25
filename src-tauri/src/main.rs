// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io, path::Path};

use tauri::Window;

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command(async)]
fn extract(window: Window, path: &str) -> Result<(), tauri::Error> {
    Ok(_extract(window, path)?)
}

fn _extract(window: Window, path: &str) -> io::Result<()> {
    let path: &Path = path.as_ref();
    let file_name: &Path = path.file_stem().unwrap_or("pna".as_ref()).as_ref();
    let dir = if let Some(parent) = path.parent() {
        parent.join(file_name)
    } else {
        file_name.to_owned()
    };
    let file = fs::File::open(path)?;
    let mut archive = libpna::Archive::read_header(file)?;
    for entry in archive.entries() {
        let entry = entry?;
        if libpna::DataKind::File != entry.header().data_kind() {
            continue;
        }
        let name = entry.header().path().as_path();
        let _ = window.emit("extract_processing", name);
        let name = dir.join(name);
        if let Some(parent) = name.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut writer = fs::File::create(name)?;
        let mut reader = entry.into_reader(libpna::ReadOption::with_password::<String>(None))?;
        io::copy(&mut reader, &mut writer)?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet, extract])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod utils;

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use libpna::{Archive, EntryBuilder, EntryName, WriteOptions};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItem},
    Emitter, Window,
};

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
#[tauri::command]
async fn create(
    window: Window,
    archive_finish_event: String,
    entry_start_event: String,
    name: &str,
    files: Vec<PathBuf>,
    save_dir: PathBuf,
    option: PnaOption,
) -> tauri::Result<()> {
    Ok(_create(
        name,
        files,
        &save_dir,
        option,
        |e, path| {
            match e {
                Event::Start => (),
                Event::Finish => {
                    window.emit(&archive_finish_event, path).unwrap();
                    open::that(&save_dir).unwrap();
                }
            };
        },
        |e, path| match e {
            Event::Start => window.emit(&entry_start_event, path).unwrap(),
            Event::Finish => (),
        },
    )?)
}

#[tauri::command]
async fn extract(
    window: Window,
    event: String,
    path: &str,
    password: Option<String>,
) -> tauri::Result<()> {
    if password.is_none() && utils::is_encrypted(path)? {
        return Err(tauri::Error::Io(io::Error::other("encrypted")));
    }
    Ok(_extract(
        path.as_ref(),
        password.as_deref(),
        |e, name| match e {
            Event::Start => (),
            Event::Finish => open::that(name).unwrap(),
        },
        |e, name| match e {
            Event::Start => window.emit(&event, name).unwrap(),
            Event::Finish => (),
        },
    )?)
}

enum Event {
    Start,
    Finish,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
enum Compression {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "zlib")]
    Zlib,
    #[serde(rename = "zstd")]
    ZStandard,
    #[serde(rename = "xz")]
    XZ,
}

impl From<Compression> for libpna::Compression {
    fn from(value: Compression) -> Self {
        match value {
            Compression::None => Self::No,
            Compression::Zlib => Self::Deflate,
            Compression::ZStandard => Self::ZStandard,
            Compression::XZ => Self::XZ,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
enum Encryption {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "aes")]
    Aes,
    #[serde(rename = "camellia")]
    Camellia,
}

impl From<Encryption> for libpna::Encryption {
    fn from(value: Encryption) -> Self {
        match value {
            Encryption::None => Self::No,
            Encryption::Aes => Self::Aes,
            Encryption::Camellia => Self::Camellia,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct PnaOption {
    solid: bool,
    compression: Compression,
    encryption: Encryption,
    password: Option<String>,
}

fn _create<OnChangeArchive, OnChangeEntry>(
    name: &str,
    files: Vec<PathBuf>,
    save_dir: &Path,
    option: PnaOption,
    on_change_archive: OnChangeArchive,
    on_change_entry: OnChangeEntry,
) -> io::Result<()>
where
    OnChangeArchive: Fn(Event, &Path),
    OnChangeEntry: Fn(Event, &Path),
{
    fs::create_dir_all(save_dir)?;
    if option.solid {
        _create_solid(
            name,
            files,
            save_dir,
            option,
            on_change_archive,
            on_change_entry,
        )
    } else {
        _create_regular(
            name,
            files,
            save_dir,
            option,
            on_change_archive,
            on_change_entry,
        )
    }
}
fn _create_regular<OnChangeArchive, OnChangeEntry>(
    name: &str,
    files: Vec<PathBuf>,
    save_dir: &Path,
    option: PnaOption,
    on_change_archive: OnChangeArchive,
    on_change_entry: OnChangeEntry,
) -> io::Result<()>
where
    OnChangeArchive: Fn(Event, &Path),
    OnChangeEntry: Fn(Event, &Path),
{
    let archive_file_path = save_dir.join(name);
    on_change_archive(Event::Start, &archive_file_path);
    let archive_file = fs::File::create(&archive_file_path)?;
    let mut archive = Archive::write_header(archive_file)?;
    for file in files.iter() {
        on_change_entry(Event::Start, file.as_ref());
        let mut f = fs::File::open(file)?;
        let option = WriteOptions::builder()
            .compression(option.compression.into())
            .encryption(option.encryption.into())
            .password(option.password.as_ref())
            .build();
        let mut entry = EntryBuilder::new_file(EntryName::from_lossy(file), option)?;
        io::copy(&mut f, &mut entry)?;
        archive.add_entry(entry.build()?)?;
        on_change_entry(Event::Finish, file.as_ref());
    }
    archive.finalize()?;
    on_change_archive(Event::Finish, &archive_file_path);
    Ok(())
}

fn _create_solid<OnChangeArchive, OnChangeEntry>(
    name: &str,
    files: Vec<PathBuf>,
    save_dir: &Path,
    option: PnaOption,
    on_change_archive: OnChangeArchive,
    on_change_entry: OnChangeEntry,
) -> io::Result<()>
where
    OnChangeArchive: Fn(Event, &Path),
    OnChangeEntry: Fn(Event, &Path),
{
    let archive_file_path = save_dir.join(name);
    on_change_archive(Event::Start, &archive_file_path);
    let archive_file = fs::File::create(&archive_file_path)?;
    let option = WriteOptions::builder()
        .compression(option.compression.into())
        .encryption(option.encryption.into())
        .password(option.password.as_ref())
        .build();
    let mut archive = Archive::write_solid_header(archive_file, option)?;
    for file in files.iter() {
        on_change_entry(Event::Start, file.as_ref());
        let mut f = fs::File::open(file)?;
        let mut entry = EntryBuilder::new_file(EntryName::from_lossy(file), WriteOptions::store())?;
        io::copy(&mut f, &mut entry)?;
        archive.add_entry(entry.build()?)?;
        on_change_entry(Event::Finish, file.as_ref());
    }
    archive.finalize()?;
    on_change_archive(Event::Finish, &archive_file_path);
    Ok(())
}

fn _extract<OnChangeArchive, OnChangeEntry>(
    path: &Path,
    password: Option<&str>,
    on_change_archive: OnChangeArchive,
    on_change_entry: OnChangeEntry,
) -> io::Result<()>
where
    OnChangeEntry: Fn(Event, &Path),
    OnChangeArchive: Fn(Event, &Path),
{
    let file_name: &Path = path.file_stem().unwrap_or("pna".as_ref()).as_ref();
    let out_dir = if let Some(parent) = path.parent() {
        parent.join(file_name)
    } else {
        file_name.to_owned()
    };
    on_change_archive(Event::Start, &out_dir);
    let file = fs::File::open(path)?;
    let mut archive = libpna::Archive::read_header(file)?;
    for entry in archive.entries_with_password(password) {
        let entry = entry?;
        if libpna::DataKind::File != entry.header().data_kind() {
            continue;
        }
        let name = entry.header().path().as_path();
        on_change_entry(Event::Start, name);
        let out_path = out_dir.join(name);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut writer = fs::File::create(out_path)?;
        let mut reader = entry.reader(libpna::ReadOptions::with_password(password))?;
        io::copy(&mut reader, &mut writer)?;
        on_change_entry(Event::Finish, name);
    }
    on_change_archive(Event::Finish, &out_dir);
    Ok(())
}

const MENU_UPDATE_CHECK: &str = "update check";
const MENU_EXTRACT_TAB: &str = "extract tab";
const MENU_CREATE_TAB: &str = "create tab";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();

    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let update_check = MenuItem::with_id(
                app,
                MENU_UPDATE_CHECK,
                "Check for updates...",
                true,
                None::<&str>,
            )?;
            let extract_tab = MenuItem::with_id(
                app,
                MENU_EXTRACT_TAB,
                "Extract",
                true,
                Some(if cfg!(target_os = "macos") {
                    "Cmd+1"
                } else {
                    "Ctrl+1"
                }),
            )?;
            let create_tab = MenuItem::with_id(
                app,
                MENU_CREATE_TAB,
                "Create",
                true,
                Some(if cfg!(target_os = "macos") {
                    "Cmd+2"
                } else {
                    "Ctrl+2"
                }),
            )?;

            let menu = MenuBuilder::new(app)
                .close_window()
                .items(&[&update_check, &extract_tab, &create_tab])
                .build()?;
            let _tray = tauri::tray::TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|handle, event| {
                    match event.id().as_ref() {
                        MENU_UPDATE_CHECK => {
                            handle.emit("tauri://update", ()).unwrap();
                        }
                        MENU_EXTRACT_TAB => {
                            handle.emit("switch_tab", "extract").unwrap();
                        }
                        MENU_CREATE_TAB => {
                            handle.emit("switch_tab", "create").unwrap();
                        }
                        m => println!("{}", m),
                    };
                })
                .menu_on_left_click(true)
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![create, extract,])
        .run(context)
        .expect("error while running tauri application");
}

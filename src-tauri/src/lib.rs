// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod reader;
mod utils;

use std::{
    fs::{self, OpenOptions},
    io,
    path::{Component, Path, PathBuf},
};

use libpna::{Archive, EntryBuilder, EntryName, WriteOptions};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItem, SubmenuBuilder},
    Emitter, Manager, Window,
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
    out_dir: PathBuf,
) -> tauri::Result<()> {
    if password.is_none() && utils::is_encrypted(path)? {
        return Err(tauri::Error::Io(io::Error::other("encrypted")));
    }
    Ok(_extract(
        path.as_ref(),
        password.as_deref(),
        &out_dir,
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
    out_dir: &Path,
    on_change_archive: OnChangeArchive,
    on_change_entry: OnChangeEntry,
) -> io::Result<()>
where
    OnChangeEntry: Fn(Event, &Path),
    OnChangeArchive: Fn(Event, &Path),
{
    let file_name: &Path = path.file_stem().unwrap_or("pna".as_ref()).as_ref();
    fs::create_dir_all(out_dir)?;
    let canonical_selected = fs::canonicalize(out_dir)?;
    let root_name = safe_relative_entry_path(file_name)?;
    create_safe_directory(out_dir, &canonical_selected, &root_name)?;
    let out_dir = out_dir.join(root_name);
    let canonical_root = fs::canonicalize(&out_dir)?;
    on_change_archive(Event::Start, &out_dir);
    let file = fs::File::open(path)?;
    let mut archive = libpna::Archive::read_header(file)?;
    for entry in archive.entries_with_password(password.map(str::as_bytes)) {
        let entry = entry?;
        let name = entry.header().path().as_path();
        let relative = safe_relative_entry_path(name)?;
        match entry.header().data_kind() {
            libpna::DataKind::Directory => {
                create_safe_directory(&out_dir, &canonical_root, &relative)?;
            }
            libpna::DataKind::File => {
                on_change_entry(Event::Start, name);
                let out_path = prepare_safe_file_path(&out_dir, &canonical_root, &relative)?;
                let mut writer = OpenOptions::new()
                    .write(true)
                    .create(true)
                    .truncate(true)
                    .open(out_path)?;
                let mut reader = entry.reader(libpna::ReadOptions::with_password(password))?;
                io::copy(&mut reader, &mut writer)?;
                on_change_entry(Event::Finish, name);
            }
            libpna::DataKind::SymbolicLink | libpna::DataKind::HardLink => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "archive links are not extracted",
                ));
            }
        }
    }
    on_change_archive(Event::Finish, &out_dir);
    Ok(())
}

fn safe_relative_entry_path(name: &Path) -> io::Result<PathBuf> {
    let raw = name.to_string_lossy();
    if raw.is_empty() || raw.contains('\\') || raw.contains(':') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "archive entry path is not portable",
        ));
    }
    let mut relative = PathBuf::new();
    for component in name.components() {
        match component {
            Component::Normal(value) => relative.push(value),
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "archive entry path escapes the destination",
                ));
            }
        }
    }
    if relative.as_os_str().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "archive entry path is empty",
        ));
    }
    Ok(relative)
}

fn create_safe_directory(root: &Path, canonical_root: &Path, relative: &Path) -> io::Result<()> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        if matches!(component, Component::CurDir) {
            continue;
        }
        let Component::Normal(value) = component else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "archive entry path escapes the destination",
            ));
        };
        current.push(value);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "destination contains a symbolic link",
                ));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "destination component is not a directory",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => fs::create_dir(&current)?,
            Err(error) => return Err(error),
        }
        let canonical = fs::canonicalize(&current)?;
        if !canonical.starts_with(canonical_root) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "destination path escapes the selected folder",
            ));
        }
    }
    Ok(())
}

fn prepare_safe_file_path(
    root: &Path,
    canonical_root: &Path,
    relative: &Path,
) -> io::Result<PathBuf> {
    let parent = relative.parent().unwrap_or_else(|| Path::new("."));
    create_safe_directory(root, canonical_root, parent)?;
    let out_path = root.join(relative);
    if let Ok(metadata) = fs::symlink_metadata(&out_path) {
        if metadata.file_type().is_symlink() || metadata.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "destination file is not a regular file",
            ));
        }
    }
    Ok(out_path)
}

const MENU_UPDATE_CHECK: &str = "update check";
const MENU_EXTRACT_TAB: &str = "extract tab";
const MENU_CREATE_TAB: &str = "create tab";

const TRAY_UPDATE_CHECK: &str = "tray_update_check";
const TRAY_EXTRACT_TAB: &str = "tray_extract_tab";
const TRAY_CREATE_TAB: &str = "tray_create_tab";

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
            let app_data_dir = app.path().app_data_dir()?;
            app.manage(reader::ReaderState::new(app_data_dir.join("recent.json")));

            // --- Window Menu Bar (matching v1 Menu::os_default layout) ---
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

            #[cfg(target_os = "macos")]
            let app_menu = {
                // macOS: [AppName, Edit, View, Window, Help]
                // "Check for updates..." goes into AppName submenu
                // "Extract" and "Create" go into Window submenu
                let app_submenu = SubmenuBuilder::new(app, &app.package_info().name)
                    .about(None)
                    .item(&update_check)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;
                let edit_submenu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;
                let view_submenu = SubmenuBuilder::new(app, "View").fullscreen().build()?;
                let window_submenu =
                    SubmenuBuilder::with_id(app, tauri::menu::WINDOW_SUBMENU_ID, "Window")
                        .items(&[&extract_tab, &create_tab])
                        .separator()
                        .minimize()
                        .maximize()
                        .close_window()
                        .build()?;
                let help_submenu =
                    SubmenuBuilder::with_id(app, tauri::menu::HELP_SUBMENU_ID, "Help").build()?;
                MenuBuilder::new(app)
                    .items(&[
                        &app_submenu,
                        &edit_submenu,
                        &view_submenu,
                        &window_submenu,
                        &help_submenu,
                    ])
                    .build()?
            };

            #[cfg(not(target_os = "macos"))]
            let app_menu = {
                // Windows/Linux: OS-default-like + Tools submenu + Extract/Create
                let file_submenu = SubmenuBuilder::new(app, "File").close_window().build()?;
                let tools_submenu = SubmenuBuilder::new(app, "Tools")
                    .item(&update_check)
                    .build()?;
                let window_submenu = SubmenuBuilder::new(app, "Window")
                    .items(&[&extract_tab, &create_tab])
                    .build()?;
                MenuBuilder::new(app)
                    .items(&[&file_submenu, &tools_submenu, &window_submenu])
                    .build()?
            };

            app.set_menu(app_menu)?;

            app.on_menu_event(|handle, event| {
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
                    _ => {}
                };
            });

            // --- Tray Menu ---
            let tray_update_check = MenuItem::with_id(
                app,
                TRAY_UPDATE_CHECK,
                "Check for updates...",
                true,
                None::<&str>,
            )?;
            let tray_extract_tab =
                MenuItem::with_id(app, TRAY_EXTRACT_TAB, "Extract", true, None::<&str>)?;
            let tray_create_tab =
                MenuItem::with_id(app, TRAY_CREATE_TAB, "Create", true, None::<&str>)?;
            let tray_menu = MenuBuilder::new(app)
                .close_window()
                .items(&[&tray_update_check, &tray_extract_tab, &tray_create_tab])
                .build()?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .menu(&tray_menu)
                .on_menu_event(|handle, event| {
                    match event.id().as_ref() {
                        TRAY_UPDATE_CHECK => {
                            handle.emit("tauri://update", ()).unwrap();
                        }
                        TRAY_EXTRACT_TAB => {
                            handle.emit("switch_tab", "extract").unwrap();
                        }
                        TRAY_CREATE_TAB => {
                            handle.emit("switch_tab", "create").unwrap();
                        }
                        m => println!("{}", m),
                    };
                })
                .show_menu_on_left_click(true)
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create,
            extract,
            reader::app_bootstrap,
            reader::recent_remove,
            reader::archive_open,
            reader::archive_close,
            reader::archive_summary,
            reader::archive_children,
            reader::archive_search,
            reader::archive_entry_details,
            reader::archive_preview,
        ])
        .run(context)
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    use libpna::{EntryReference, ReadOptions};
    use tempfile::tempdir;

    const CREATE_CASES: [(&str, bool, Compression, Encryption); 24] = [
        (
            "BE-CREATE-NONE-NONE-NORMAL",
            false,
            Compression::None,
            Encryption::None,
        ),
        (
            "BE-CREATE-NONE-NONE-SOLID",
            true,
            Compression::None,
            Encryption::None,
        ),
        (
            "BE-CREATE-NONE-AES-NORMAL",
            false,
            Compression::None,
            Encryption::Aes,
        ),
        (
            "BE-CREATE-NONE-AES-SOLID",
            true,
            Compression::None,
            Encryption::Aes,
        ),
        (
            "BE-CREATE-NONE-CAMELLIA-NORMAL",
            false,
            Compression::None,
            Encryption::Camellia,
        ),
        (
            "BE-CREATE-NONE-CAMELLIA-SOLID",
            true,
            Compression::None,
            Encryption::Camellia,
        ),
        (
            "BE-CREATE-ZLIB-NONE-NORMAL",
            false,
            Compression::Zlib,
            Encryption::None,
        ),
        (
            "BE-CREATE-ZLIB-NONE-SOLID",
            true,
            Compression::Zlib,
            Encryption::None,
        ),
        (
            "BE-CREATE-ZLIB-AES-NORMAL",
            false,
            Compression::Zlib,
            Encryption::Aes,
        ),
        (
            "BE-CREATE-ZLIB-AES-SOLID",
            true,
            Compression::Zlib,
            Encryption::Aes,
        ),
        (
            "BE-CREATE-ZLIB-CAMELLIA-NORMAL",
            false,
            Compression::Zlib,
            Encryption::Camellia,
        ),
        (
            "BE-CREATE-ZLIB-CAMELLIA-SOLID",
            true,
            Compression::Zlib,
            Encryption::Camellia,
        ),
        (
            "BE-CREATE-ZSTD-NONE-NORMAL",
            false,
            Compression::ZStandard,
            Encryption::None,
        ),
        (
            "BE-CREATE-ZSTD-NONE-SOLID",
            true,
            Compression::ZStandard,
            Encryption::None,
        ),
        (
            "BE-CREATE-ZSTD-AES-NORMAL",
            false,
            Compression::ZStandard,
            Encryption::Aes,
        ),
        (
            "BE-CREATE-ZSTD-AES-SOLID",
            true,
            Compression::ZStandard,
            Encryption::Aes,
        ),
        (
            "BE-CREATE-ZSTD-CAMELLIA-NORMAL",
            false,
            Compression::ZStandard,
            Encryption::Camellia,
        ),
        (
            "BE-CREATE-ZSTD-CAMELLIA-SOLID",
            true,
            Compression::ZStandard,
            Encryption::Camellia,
        ),
        (
            "BE-CREATE-XZ-NONE-NORMAL",
            false,
            Compression::XZ,
            Encryption::None,
        ),
        (
            "BE-CREATE-XZ-NONE-SOLID",
            true,
            Compression::XZ,
            Encryption::None,
        ),
        (
            "BE-CREATE-XZ-AES-NORMAL",
            false,
            Compression::XZ,
            Encryption::Aes,
        ),
        (
            "BE-CREATE-XZ-AES-SOLID",
            true,
            Compression::XZ,
            Encryption::Aes,
        ),
        (
            "BE-CREATE-XZ-CAMELLIA-NORMAL",
            false,
            Compression::XZ,
            Encryption::Camellia,
        ),
        (
            "BE-CREATE-XZ-CAMELLIA-SOLID",
            true,
            Compression::XZ,
            Encryption::Camellia,
        ),
    ];

    #[test]
    fn create_roundtrips_every_supported_option_state() {
        for (case_id, solid, compression, encryption) in CREATE_CASES {
            let temp = tempdir().unwrap();
            let input = temp.path().join("input.txt");
            fs::write(&input, case_id).unwrap();
            let password = (!matches!(encryption, Encryption::None)).then(|| "secret".to_string());
            let name = format!("{case_id}.pna");
            let archive_events = std::sync::Mutex::new(Vec::new());
            let entry_events = std::sync::Mutex::new(Vec::new());

            _create(
                &name,
                vec![input],
                temp.path(),
                PnaOption {
                    solid,
                    compression,
                    encryption,
                    password: password.clone(),
                },
                |event, _| {
                    archive_events
                        .lock()
                        .unwrap()
                        .push(matches!(event, Event::Finish))
                },
                |event, _| {
                    entry_events
                        .lock()
                        .unwrap()
                        .push(matches!(event, Event::Finish))
                },
            )
            .unwrap_or_else(|error| panic!("{case_id}: {error}"));

            let file = fs::File::open(temp.path().join(&name)).unwrap();
            let mut archive = Archive::read_header(file).unwrap();
            let mut entries = archive.entries_with_password(password.as_deref().map(str::as_bytes));
            let entry = entries.next().unwrap().unwrap();
            let mut content = String::new();
            entry
                .reader(ReadOptions::with_password(password.as_deref()))
                .unwrap()
                .read_to_string(&mut content)
                .unwrap();
            assert_eq!(content, case_id, "{case_id}");
            assert!(entries.next().is_none(), "{case_id}");
            assert_eq!(*archive_events.lock().unwrap(), [false, true], "{case_id}");
            assert_eq!(*entry_events.lock().unwrap(), [false, true], "{case_id}");
        }
    }

    #[test]
    fn extract_requires_a_selected_destination_and_preserves_source() {
        // State coverage: BE-EXTRACT-DESTINATION, BE-EXTRACT-NESTED,
        // BE-EXTRACT-SOURCE-UNCHANGED, BE-EXTRACT-EVENTS.
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("sample.pna");
        write_file_archive(&archive_path, "nested/file.txt", b"payload");
        let source_bytes = fs::read(&archive_path).unwrap();
        let source_modified = fs::metadata(&archive_path).unwrap().modified().unwrap();
        let selected = temp.path().join("selected");
        let archive_events = std::sync::Mutex::new(Vec::new());
        let entry_events = std::sync::Mutex::new(Vec::new());

        _extract(
            &archive_path,
            None,
            &selected,
            |event, _| {
                archive_events
                    .lock()
                    .unwrap()
                    .push(matches!(event, Event::Finish))
            },
            |event, _| {
                entry_events
                    .lock()
                    .unwrap()
                    .push(matches!(event, Event::Finish))
            },
        )
        .unwrap();

        assert_eq!(
            fs::read(selected.join("sample/nested/file.txt")).unwrap(),
            b"payload"
        );
        assert_eq!(fs::read(&archive_path).unwrap(), source_bytes);
        assert_eq!(
            fs::metadata(&archive_path).unwrap().modified().unwrap(),
            source_modified
        );
        assert_eq!(*archive_events.lock().unwrap(), [false, true]);
        assert_eq!(*entry_events.lock().unwrap(), [false, true]);
    }

    #[test]
    fn extraction_rejects_nonportable_and_escaping_paths() {
        for (case_id, path) in [
            ("BE-SEC-EXTRACT-PARENT", "../escape.txt"),
            ("BE-SEC-EXTRACT-ABSOLUTE", "/tmp/escape.txt"),
            ("BE-SEC-EXTRACT-WINDOWS-DRIVE", "C:/escape.txt"),
            ("BE-SEC-EXTRACT-WINDOWS-SEPARATOR", "dir\\escape.txt"),
            ("BE-SEC-EXTRACT-EMPTY", ""),
        ] {
            assert!(
                safe_relative_entry_path(Path::new(path)).is_err(),
                "{case_id}: {path}"
            );
        }
        assert_eq!(
            safe_relative_entry_path(Path::new("nested/file.txt")).unwrap(),
            Path::new("nested/file.txt"),
            "BE-SEC-EXTRACT-NESTED-SAFE"
        );
    }

    #[test]
    fn extraction_never_writes_a_traversal_entry_outside_the_destination() {
        // State coverage: BE-SEC-EXTRACT-NO-OUTSIDE-WRITE.
        // libpna normalizes this entry name while reading. This integration test
        // therefore asserts the security boundary (no write outside the selected
        // destination), while extraction_rejects_nonportable_and_escaping_paths
        // tests the raw-path rejection policy before normalization.
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("malicious.pna");
        write_file_archive_preserving_root(&archive_path, "../escape.txt", b"escape");
        let selected = temp.path().join("selected");

        _extract(&archive_path, None, &selected, |_, _| {}, |_, _| {}).unwrap();

        assert!(!temp.path().join("escape.txt").exists());
        assert_eq!(
            fs::read(selected.join("malicious/escape.txt")).unwrap(),
            b"escape"
        );
    }

    #[test]
    fn extraction_rejects_archive_links() {
        for (case_id, hard_link) in [
            ("BE-SEC-EXTRACT-SYMLINK-ENTRY", false),
            ("BE-SEC-EXTRACT-HARDLINK-ENTRY", true),
        ] {
            let temp = tempdir().unwrap();
            let archive_path = temp.path().join("links.pna");
            let file = fs::File::create(&archive_path).unwrap();
            let mut archive = Archive::write_header(file).unwrap();
            let entry = if hard_link {
                EntryBuilder::new_hard_link(EntryName::from("link"), EntryReference::from("target"))
                    .unwrap()
            } else {
                EntryBuilder::new_symlink(
                    EntryName::from("link"),
                    EntryReference::from("../outside"),
                )
                .unwrap()
            };
            archive.add_entry(entry.build().unwrap()).unwrap();
            archive.finalize().unwrap();

            let error = _extract(
                &archive_path,
                None,
                &temp.path().join("selected"),
                |_, _| {},
                |_, _| {},
            )
            .unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidData, "{case_id}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn extraction_rejects_a_preexisting_destination_symlink() {
        // State coverage: BE-SEC-EXTRACT-DESTINATION-SYMLINK.
        use std::os::unix::fs::symlink;

        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("sample.pna");
        write_file_archive(&archive_path, "linked/escape.txt", b"escape");
        let selected = temp.path().join("selected");
        let root = selected.join("sample");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("linked")).unwrap();

        let error = _extract(&archive_path, None, &selected, |_, _| {}, |_, _| {}).unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(!outside.join("escape.txt").exists());
    }

    fn write_file_archive(path: &Path, name: &str, content: &[u8]) {
        let file = fs::File::create(path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let mut entry =
            EntryBuilder::new_file(EntryName::from(name), WriteOptions::store()).unwrap();
        entry.write_all(content).unwrap();
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();
    }

    fn write_file_archive_preserving_root(path: &Path, name: &str, content: &[u8]) {
        let file = fs::File::create(path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let mut entry = EntryBuilder::new_file(
            EntryName::from_utf8_preserve_root(name),
            WriteOptions::store(),
        )
        .unwrap();
        entry.write_all(content).unwrap();
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();
    }
}

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub(crate) struct UpdateState {
    pending: Mutex<Option<Update>>,
    busy: AtomicBool,
}

struct UpdateGuard<'a>(&'a AtomicBool);

impl UpdateState {
    fn begin(&self) -> Result<UpdateGuard<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "an update operation is already in progress".to_string())?;
        Ok(UpdateGuard(&self.busy))
    }
}

impl Drop for UpdateGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Serialize)]
pub(crate) struct AvailableUpdate {
    version: String,
}

#[tauri::command]
pub(crate) async fn update_check(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<Option<AvailableUpdate>, String> {
    let _guard = state.begin()?;
    let update = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    let available = update.as_ref().map(|update| AvailableUpdate {
        version: update.version.clone(),
    });
    *state.pending.lock().unwrap() = update;
    Ok(available)
}

#[tauri::command]
pub(crate) async fn update_install(
    state: State<'_, UpdateState>,
    version: String,
) -> Result<(), String> {
    let _guard = state.begin()?;
    let update = state
        .pending
        .lock()
        .unwrap()
        .as_ref()
        .filter(|update| update.version == version)
        .cloned()
        .ok_or_else(|| "the selected update is no longer available; check again".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    *state.pending.lock().unwrap() = None;
    Ok(())
}

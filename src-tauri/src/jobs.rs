use std::{
    any::Any,
    collections::BTreeMap,
    io,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
};

use serde::{Deserialize, Serialize};

use crate::operations::{CreateRequest, ExtractRequest};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    CancelRequested,
    Cancelled,
    Succeeded,
    Failed,
    Interrupted,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobKind {
    Create,
    Extract,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub id: String,
    pub kind: JobKind,
    pub status: JobStatus,
    pub phase: String,
    pub current_item: Option<String>,
    pub completed_units: u64,
    pub total_units: Option<u64>,
    pub output_path: Option<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Clone)]
pub enum JobRequest {
    Create(CreateRequest),
    Extract(ExtractRequest),
}

struct JobRecord {
    snapshot: JobSnapshot,
    request: JobRequest,
    cancelled: Arc<AtomicBool>,
    observer: Arc<dyn Fn(JobSnapshot) + Send + Sync>,
}

#[derive(Default)]
struct JobManagerInner {
    next_id: AtomicU64,
    records: Mutex<BTreeMap<String, JobRecord>>,
}

#[derive(Clone, Default)]
pub struct JobManager {
    inner: Arc<JobManagerInner>,
}

type JobWorker = Box<dyn FnOnce() + Send + 'static>;

impl JobManager {
    pub fn start(
        &self,
        request: JobRequest,
        observer: Arc<dyn Fn(JobSnapshot) + Send + Sync>,
    ) -> io::Result<JobSnapshot> {
        self.start_with_spawner(request, observer, |name, worker| {
            thread::Builder::new().name(name).spawn(worker).map(|_| ())
        })
    }

    fn start_with_spawner(
        &self,
        request: JobRequest,
        observer: Arc<dyn Fn(JobSnapshot) + Send + Sync>,
        spawn: impl FnOnce(String, JobWorker) -> io::Result<()>,
    ) -> io::Result<JobSnapshot> {
        let id = format!(
            "job-{}",
            self.inner.next_id.fetch_add(1, Ordering::Relaxed) + 1
        );
        let kind = match &request {
            JobRequest::Create(_) => JobKind::Create,
            JobRequest::Extract(_) => JobKind::Extract,
        };
        let snapshot = JobSnapshot {
            id: id.clone(),
            kind,
            status: JobStatus::Queued,
            phase: "preparing".into(),
            current_item: None,
            completed_units: 0,
            total_units: None,
            output_path: None,
            error: None,
            warnings: Vec::new(),
        };
        let cancelled = Arc::new(AtomicBool::new(false));
        self.inner.records.lock().unwrap().insert(
            id.clone(),
            JobRecord {
                snapshot: snapshot.clone(),
                request: request.clone(),
                cancelled: cancelled.clone(),
                observer: observer.clone(),
            },
        );
        observer(snapshot.clone());

        let manager = self.clone();
        let panic_manager = manager.clone();
        let panic_id = id.clone();
        let panic_observer = observer.clone();
        let worker_observer = observer.clone();
        let worker = Box::new(move || {
            if let Err(payload) = catch_unwind(AssertUnwindSafe(|| {
                manager.run(id, request, cancelled, worker_observer)
            })) {
                panic_manager.fail_after_panic(&panic_id, &panic_observer, payload);
            }
        });
        if let Err(error) = spawn(format!("pna-{}", snapshot.id), worker) {
            let failed = {
                let mut records = self.inner.records.lock().unwrap();
                let mut failed = records
                    .remove(&snapshot.id)
                    .map(|record| record.snapshot)
                    .unwrap_or_else(|| snapshot.clone());
                failed.status = JobStatus::Failed;
                failed.phase = "failed".into();
                failed.error = Some(format!("failed to spawn job worker: {error}"));
                failed
            };
            observer(failed);
            return Err(error);
        }
        Ok(snapshot)
    }

    pub fn list(&self) -> Vec<JobSnapshot> {
        self.inner
            .records
            .lock()
            .unwrap()
            .values()
            .map(|record| record.snapshot.clone())
            .collect()
    }

    pub fn cancel(&self, id: &str) -> io::Result<JobSnapshot> {
        let (snapshot, observer) = {
            let mut records = self.inner.records.lock().unwrap();
            let record = records
                .get_mut(id)
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "job not found"))?;
            if !matches!(
                record.snapshot.status,
                JobStatus::Queued | JobStatus::Running
            ) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "job is not cancellable",
                ));
            }
            record.cancelled.store(true, Ordering::Release);
            record.snapshot.status = JobStatus::CancelRequested;
            record.snapshot.phase = "cleaning_up".into();
            (record.snapshot.clone(), record.observer.clone())
        };
        observer(snapshot.clone());
        Ok(snapshot)
    }

    pub fn retry(
        &self,
        id: &str,
        observer: Arc<dyn Fn(JobSnapshot) + Send + Sync>,
    ) -> io::Result<JobSnapshot> {
        let request = {
            let records = self.inner.records.lock().unwrap();
            let record = records
                .get(id)
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "job not found"))?;
            if !matches!(
                record.snapshot.status,
                JobStatus::Failed | JobStatus::Cancelled | JobStatus::Interrupted
            ) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "only failed, cancelled, or interrupted jobs can be retried",
                ));
            }
            record.request.clone()
        };
        self.start(request, observer)
    }

    pub fn dismiss(&self, id: &str) -> io::Result<Vec<JobSnapshot>> {
        let mut records = self.inner.records.lock().unwrap();
        let record = records
            .get(id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "job not found"))?;
        if matches!(
            record.snapshot.status,
            JobStatus::Queued | JobStatus::Running | JobStatus::CancelRequested
        ) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "an active job cannot be dismissed",
            ));
        }
        records.remove(id);
        Ok(records
            .values()
            .map(|record| record.snapshot.clone())
            .collect())
    }

    pub fn output_path(&self, id: &str) -> io::Result<String> {
        let records = self.inner.records.lock().unwrap();
        let record = records
            .get(id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "job not found"))?;
        record
            .snapshot
            .output_path
            .clone()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "job has no output yet"))
    }

    fn run(
        &self,
        id: String,
        request: JobRequest,
        cancelled: Arc<AtomicBool>,
        observer: Arc<dyn Fn(JobSnapshot) + Send + Sync>,
    ) {
        self.update(&id, &observer, |snapshot| {
            if snapshot.status == JobStatus::Queued {
                snapshot.status = JobStatus::Running;
                snapshot.phase = match &request {
                    JobRequest::Create(_) => "scanning".into(),
                    JobRequest::Extract(_) => "reading".into(),
                };
            }
        });
        let manager = self.clone();
        let progress_id = id.clone();
        let progress_observer = observer.clone();
        let progress = move |completed: u64, total: u64, item: &str| {
            manager.update(&progress_id, &progress_observer, |snapshot| {
                if snapshot.status == JobStatus::Running {
                    snapshot.phase = match snapshot.kind {
                        JobKind::Create => "writing".into(),
                        JobKind::Extract => "extracting".into(),
                    };
                    snapshot.completed_units = completed;
                    snapshot.total_units = Some(total);
                    snapshot.current_item = Some(item.to_string());
                }
            });
        };
        let result = match &request {
            JobRequest::Create(request) => crate::operations::create_archive(
                request,
                || cancelled.load(Ordering::Acquire),
                progress,
            ),
            JobRequest::Extract(request) => crate::operations::extract_archive(
                request,
                || cancelled.load(Ordering::Acquire),
                progress,
            ),
        };
        self.update(&id, &observer, |snapshot| match result {
            Ok(outcome) => {
                snapshot.status = JobStatus::Succeeded;
                snapshot.phase = "completed".into();
                snapshot.completed_units = outcome.completed_items;
                snapshot.total_units = Some(outcome.completed_items);
                snapshot.output_path = Some(outcome.output_path.to_string_lossy().into_owned());
                snapshot.error = None;
                snapshot.warnings = outcome.warnings;
            }
            Err(error) if cancelled.load(Ordering::Acquire) => {
                snapshot.status = JobStatus::Cancelled;
                snapshot.phase = "cleaning_up".into();
                snapshot.error = Some(error.to_string());
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                snapshot.status = JobStatus::Interrupted;
                snapshot.phase = "failed".into();
                snapshot.error = Some(error.to_string());
            }
            Err(error) => {
                snapshot.status = JobStatus::Failed;
                snapshot.phase = "failed".into();
                snapshot.error = Some(error.to_string());
            }
        });
    }

    fn update(
        &self,
        id: &str,
        observer: &Arc<dyn Fn(JobSnapshot) + Send + Sync>,
        update: impl FnOnce(&mut JobSnapshot),
    ) {
        let snapshot = {
            let mut records = self.inner.records.lock().unwrap();
            let Some(record) = records.get_mut(id) else {
                return;
            };
            update(&mut record.snapshot);
            record.snapshot.clone()
        };
        observer(snapshot);
    }

    fn fail_after_panic(
        &self,
        id: &str,
        observer: &Arc<dyn Fn(JobSnapshot) + Send + Sync>,
        payload: Box<dyn Any + Send>,
    ) {
        let detail = if let Some(message) = payload.downcast_ref::<&str>() {
            (*message).to_string()
        } else if let Some(message) = payload.downcast_ref::<String>() {
            message.clone()
        } else {
            "unknown panic payload".to_string()
        };
        self.update(id, observer, |snapshot| {
            snapshot.status = JobStatus::Failed;
            snapshot.phase = "failed".into();
            snapshot.error = Some(format!("worker panicked: {detail}"));
        });
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{atomic::AtomicBool, Mutex},
        thread,
        time::{Duration, Instant},
    };

    use tempfile::tempdir;

    use crate::operations::{CreateCompression, CreateEncryption, CreateOptions, CreateRequest};

    use super::*;

    fn wait_for_terminal(manager: &JobManager, id: &str) -> JobSnapshot {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let snapshot = manager.list().into_iter().find(|job| job.id == id).unwrap();
            if matches!(
                snapshot.status,
                JobStatus::Succeeded
                    | JobStatus::Failed
                    | JobStatus::Cancelled
                    | JobStatus::Interrupted
            ) {
                return snapshot;
            }
            assert!(Instant::now() < deadline, "job did not finish");
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn worker_panic_becomes_a_dismissible_failed_job() {
        // BE-P2-JOB-WORKER-PANIC
        let temp = tempdir().unwrap();
        let source = temp.path().join("input.txt");
        let output = temp.path().join("output.pna");
        fs::write(&source, b"panic guard payload").unwrap();
        let manager = JobManager::default();

        let queued = manager
            .start(
                JobRequest::Create(CreateRequest {
                    sources: vec![source],
                    output_path: output,
                    overwrite: false,
                    options: CreateOptions {
                        solid: false,
                        compression: CreateCompression::Zstd,
                        encryption: CreateEncryption::None,
                        password: None,
                        preserve_permissions: true,
                        reproducible: false,
                    },
                }),
                Arc::new(|snapshot| {
                    if snapshot.status == JobStatus::Running {
                        panic!("simulated worker panic");
                    }
                }),
            )
            .unwrap();

        let failed = wait_for_terminal(&manager, &queued.id);
        assert_eq!(failed.status, JobStatus::Failed);
        assert!(failed.error.as_deref().unwrap().contains("worker panicked"));
        assert!(manager.dismiss(&queued.id).unwrap().is_empty());
    }

    #[test]
    fn cancelling_a_queued_job_never_returns_it_to_running() {
        // BE-P2-JOB-CANCEL-QUEUED-RACE
        let temp = tempdir().unwrap();
        let source = temp.path().join("input.txt");
        let output = temp.path().join("output.pna");
        fs::write(&source, b"cancel before worker start").unwrap();
        let manager = JobManager::default();
        let observer_manager = manager.clone();
        let cancelled_once = Arc::new(AtomicBool::new(false));
        let observer_cancelled_once = cancelled_once.clone();
        let observed = Arc::new(Mutex::new(Vec::new()));
        let observer_values = observed.clone();

        let queued = manager
            .start(
                JobRequest::Create(CreateRequest {
                    sources: vec![source],
                    output_path: output,
                    overwrite: false,
                    options: CreateOptions {
                        solid: false,
                        compression: CreateCompression::Zstd,
                        encryption: CreateEncryption::None,
                        password: None,
                        preserve_permissions: true,
                        reproducible: false,
                    },
                }),
                Arc::new(move |snapshot| {
                    observer_values.lock().unwrap().push(snapshot.clone());
                    if snapshot.status == JobStatus::Queued
                        && !observer_cancelled_once.swap(true, Ordering::AcqRel)
                    {
                        observer_manager.cancel(&snapshot.id).unwrap();
                    }
                }),
            )
            .unwrap();

        let terminal = wait_for_terminal(&manager, &queued.id);
        assert_eq!(terminal.status, JobStatus::Cancelled);
        let states = observed
            .lock()
            .unwrap()
            .iter()
            .map(|snapshot| snapshot.status)
            .collect::<Vec<_>>();
        let cancel_index = states
            .iter()
            .position(|status| *status == JobStatus::CancelRequested)
            .unwrap();
        assert!(!states[cancel_index + 1..].contains(&JobStatus::Running));
    }

    #[test]
    fn spawn_failure_removes_the_unrunnable_job_and_reports_failure() {
        // BE-P2-JOB-SPAWN-FAILURE
        let temp = tempdir().unwrap();
        let source = temp.path().join("input.txt");
        let output = temp.path().join("output.pna");
        fs::write(&source, b"spawn failure payload").unwrap();
        let manager = JobManager::default();
        let observed = Arc::new(Mutex::new(Vec::new()));
        let observer_values = observed.clone();

        let error = manager
            .start_with_spawner(
                JobRequest::Create(CreateRequest {
                    sources: vec![source],
                    output_path: output,
                    overwrite: false,
                    options: CreateOptions {
                        solid: false,
                        compression: CreateCompression::Zstd,
                        encryption: CreateEncryption::None,
                        password: None,
                        preserve_permissions: true,
                        reproducible: false,
                    },
                }),
                Arc::new(move |snapshot| observer_values.lock().unwrap().push(snapshot)),
                |_name, _worker| Err(io::Error::other("simulated spawn failure")),
            )
            .unwrap_err();

        assert!(error.to_string().contains("simulated spawn failure"));
        assert!(manager.list().is_empty());
        let snapshots = observed.lock().unwrap();
        assert_eq!(snapshots.last().unwrap().status, JobStatus::Failed);
        assert!(snapshots
            .last()
            .unwrap()
            .error
            .as_deref()
            .unwrap()
            .contains("spawn"));
    }

    #[test]
    fn create_job_reports_state_progress_and_output() {
        // BE-P2-JOB-CREATE-SUCCESS, BE-UX-JOB-DISMISS-OUTPUT
        let temp = tempdir().unwrap();
        let source = temp.path().join("input.txt");
        let output = temp.path().join("output.pna");
        fs::write(&source, b"job payload").unwrap();
        let observed = Arc::new(Mutex::new(Vec::new()));
        let observer_values = observed.clone();
        let manager = JobManager::default();

        let queued = manager
            .start(
                JobRequest::Create(CreateRequest {
                    sources: vec![source],
                    output_path: output.clone(),
                    overwrite: false,
                    options: CreateOptions {
                        solid: false,
                        compression: CreateCompression::Zstd,
                        encryption: CreateEncryption::None,
                        password: None,
                        preserve_permissions: true,
                        reproducible: false,
                    },
                }),
                Arc::new(move |snapshot| observer_values.lock().unwrap().push(snapshot)),
            )
            .unwrap();

        assert_eq!(queued.status, JobStatus::Queued);
        let succeeded = wait_for_terminal(&manager, &queued.id);
        assert_eq!(succeeded.status, JobStatus::Succeeded);
        assert_eq!(succeeded.completed_units, 1);
        assert_eq!(succeeded.total_units, Some(1));
        assert_eq!(succeeded.output_path.as_deref(), output.to_str());
        assert!(output.exists());
        let states = observed
            .lock()
            .unwrap()
            .iter()
            .map(|snapshot| snapshot.status)
            .collect::<Vec<_>>();
        assert!(states.contains(&JobStatus::Running));
        assert_eq!(states.last(), Some(&JobStatus::Succeeded));
        assert_eq!(
            manager.output_path(&queued.id).unwrap(),
            output.to_str().unwrap()
        );
        assert!(manager.dismiss(&queued.id).unwrap().is_empty());
        assert!(manager.list().is_empty());
    }

    #[test]
    fn failed_job_can_be_retried_after_the_external_input_is_repaired() {
        // BE-P2-JOB-RETRY
        let temp = tempdir().unwrap();
        let source = temp.path().join("later.txt");
        let output = temp.path().join("output.pna");
        let manager = JobManager::default();
        let request = JobRequest::Create(CreateRequest {
            sources: vec![source.clone()],
            output_path: output.clone(),
            overwrite: false,
            options: CreateOptions {
                solid: false,
                compression: CreateCompression::Zstd,
                encryption: CreateEncryption::None,
                password: None,
                preserve_permissions: true,
                reproducible: false,
            },
        });
        let failed = manager.start(request, Arc::new(|_| {})).unwrap();
        assert_eq!(
            wait_for_terminal(&manager, &failed.id).status,
            JobStatus::Failed
        );
        fs::write(source, b"now available").unwrap();
        let retry = manager.retry(&failed.id, Arc::new(|_| {})).unwrap();
        assert_eq!(
            wait_for_terminal(&manager, &retry.id).status,
            JobStatus::Succeeded
        );
        assert!(output.exists());
    }
}

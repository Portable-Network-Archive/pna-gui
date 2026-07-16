use std::{
    any::Any,
    collections::BTreeMap,
    io,
    panic::{catch_unwind, AssertUnwindSafe},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
};

use serde::{Deserialize, Serialize};

use crate::operations::{
    AppendRequest, ConcatRequest, CreateRequest, DeleteEntriesRequest, ExtractRequest,
    MigrateRequest, RenameEntryRequest, SortRequest, SplitRequest, StripMetadataRequest,
};
use crate::verification::{VerificationReport, VerifyRequest};

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
    Append,
    Delete,
    Rename,
    Split,
    Concat,
    Sort,
    Strip,
    Migrate,
    Verify,
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
    pub error_code: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub verification_report: Option<VerificationReport>,
}

#[derive(Clone)]
pub enum JobRequest {
    Create(CreateRequest),
    Extract(ExtractRequest),
    Append(AppendRequest),
    Delete(DeleteEntriesRequest),
    Rename(RenameEntryRequest),
    Split(SplitRequest),
    Concat(ConcatRequest),
    Sort(SortRequest),
    Strip(StripMetadataRequest),
    Migrate(MigrateRequest),
    Verify(VerifyRequest),
}

impl JobRequest {
    fn kind(&self) -> JobKind {
        match self {
            Self::Create(_) => JobKind::Create,
            Self::Extract(_) => JobKind::Extract,
            Self::Append(_) => JobKind::Append,
            Self::Delete(_) => JobKind::Delete,
            Self::Rename(_) => JobKind::Rename,
            Self::Split(_) => JobKind::Split,
            Self::Concat(_) => JobKind::Concat,
            Self::Sort(_) => JobKind::Sort,
            Self::Strip(_) => JobKind::Strip,
            Self::Migrate(_) => JobKind::Migrate,
            Self::Verify(_) => JobKind::Verify,
        }
    }

    fn intended_output(&self) -> Option<PathBuf> {
        match self {
            Self::Create(request) => Some(request.output_path.clone()),
            Self::Extract(request) => Some(request.destination.clone()),
            Self::Append(request) => Some(request.archive_path.clone()),
            Self::Delete(request) => Some(request.archive_path.clone()),
            Self::Rename(request) => Some(request.archive_path.clone()),
            Self::Split(request) => request
                .archive_path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(|stem| {
                    request
                        .output_directory
                        .join(crate::operations::split_part_name(stem, 1))
                }),
            Self::Concat(request) => Some(request.output_path.clone()),
            Self::Sort(request) => Some(request.output_path.clone()),
            Self::Strip(request) => Some(request.output_path.clone()),
            Self::Migrate(request) => Some(request.output_path.clone()),
            Self::Verify(_) => None,
        }
    }
}

enum JobExecutionOutcome {
    Operation(crate::operations::OperationOutcome),
    Verification(VerificationReport),
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
        let kind = request.kind();
        let intended_output = request.intended_output();
        let snapshot = JobSnapshot {
            id: id.clone(),
            kind,
            status: JobStatus::Queued,
            phase: "preparing".into(),
            current_item: None,
            completed_units: 0,
            total_units: None,
            output_path: intended_output.map(|path| path.to_string_lossy().into_owned()),
            error: None,
            error_code: None,
            warnings: Vec::new(),
            verification_report: None,
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
        let cancelled = Arc::new(AtomicBool::new(false));
        let (request, snapshot) = {
            let mut records = self.inner.records.lock().unwrap();
            let record = records
                .get_mut(id)
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
            record.cancelled = cancelled.clone();
            record.observer = observer.clone();
            record.snapshot.status = JobStatus::Queued;
            record.snapshot.phase = "preparing".into();
            record.snapshot.current_item = None;
            record.snapshot.completed_units = 0;
            record.snapshot.total_units = None;
            record.snapshot.error = None;
            record.snapshot.warnings.clear();
            record.snapshot.verification_report = None;
            (record.request.clone(), record.snapshot.clone())
        };
        observer(snapshot.clone());

        let manager = self.clone();
        let panic_manager = manager.clone();
        let retry_id = id.to_string();
        let panic_id = retry_id.clone();
        let panic_observer = observer.clone();
        let worker_observer = observer.clone();
        let worker = move || {
            if let Err(payload) = catch_unwind(AssertUnwindSafe(|| {
                manager.run(retry_id, request, cancelled, worker_observer)
            })) {
                panic_manager.fail_after_panic(&panic_id, &panic_observer, payload);
            }
        };
        if let Err(error) = thread::Builder::new()
            .name(format!("pna-{}", snapshot.id))
            .spawn(worker)
        {
            self.update(id, &observer, |current| {
                current.status = JobStatus::Failed;
                current.phase = "failed".into();
                current.error = Some(format!("failed to spawn job worker: {error}"));
            });
            return Err(error);
        }
        Ok(snapshot)
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
                    JobRequest::Append(_) => "scanning".into(),
                    JobRequest::Delete(_) | JobRequest::Rename(_) => "reading".into(),
                    JobRequest::Split(_)
                    | JobRequest::Concat(_)
                    | JobRequest::Sort(_)
                    | JobRequest::Strip(_)
                    | JobRequest::Migrate(_) => "reading".into(),
                    JobRequest::Verify(_) => "verifying".into(),
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
                        JobKind::Append => "writing".into(),
                        JobKind::Delete | JobKind::Rename => "writing".into(),
                        JobKind::Split
                        | JobKind::Concat
                        | JobKind::Sort
                        | JobKind::Strip
                        | JobKind::Migrate => "writing".into(),
                        JobKind::Verify => "verifying".into(),
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
            )
            .map(JobExecutionOutcome::Operation),
            JobRequest::Extract(request) => crate::operations::extract_archive(
                request,
                || cancelled.load(Ordering::Acquire),
                progress,
            )
            .map(JobExecutionOutcome::Operation),
            JobRequest::Append(request) => crate::operations::append_archive(
                request,
                || cancelled.load(Ordering::Acquire),
                progress,
            )
            .map(JobExecutionOutcome::Operation),
            JobRequest::Delete(request) => crate::operations::delete_archive_entries(
                request,
                || cancelled.load(Ordering::Acquire),
                progress,
            )
            .map(JobExecutionOutcome::Operation),
            JobRequest::Rename(request) => crate::operations::rename_archive_entry(
                request,
                || cancelled.load(Ordering::Acquire),
                progress,
            )
            .map(JobExecutionOutcome::Operation),
            JobRequest::Split(request) => crate::operations::split_archive(
                request,
                || cancelled.load(Ordering::Acquire),
                progress,
            )
            .map(JobExecutionOutcome::Operation),
            JobRequest::Concat(request) => crate::operations::concat_archives(
                request,
                || cancelled.load(Ordering::Acquire),
                progress,
            )
            .map(JobExecutionOutcome::Operation),
            JobRequest::Sort(request) => crate::operations::sort_archive(
                request,
                || cancelled.load(Ordering::Acquire),
                progress,
            )
            .map(JobExecutionOutcome::Operation),
            JobRequest::Strip(request) => crate::operations::strip_archive_metadata(
                request,
                || cancelled.load(Ordering::Acquire),
                progress,
            )
            .map(JobExecutionOutcome::Operation),
            JobRequest::Migrate(request) => crate::operations::migrate_archive(
                request,
                || cancelled.load(Ordering::Acquire),
                progress,
            )
            .map(JobExecutionOutcome::Operation),
            JobRequest::Verify(request) => crate::verification::verify_archive(
                request,
                || cancelled.load(Ordering::Acquire),
                progress,
            )
            .map(JobExecutionOutcome::Verification),
        };
        self.update(&id, &observer, |snapshot| match result {
            Ok(JobExecutionOutcome::Operation(outcome)) => {
                snapshot.status = JobStatus::Succeeded;
                snapshot.phase = "completed".into();
                snapshot.completed_units = outcome.completed_items;
                snapshot.total_units = Some(outcome.completed_items);
                snapshot.output_path = Some(outcome.output_path.to_string_lossy().into_owned());
                snapshot.error = None;
                snapshot.error_code = None;
                snapshot.warnings = outcome.warnings;
            }
            Ok(JobExecutionOutcome::Verification(report)) => {
                snapshot.status = JobStatus::Succeeded;
                snapshot.phase = "completed".into();
                snapshot.completed_units = report.entries_checked;
                snapshot.total_units = Some(report.entries_checked);
                snapshot.output_path = None;
                snapshot.error = None;
                snapshot.error_code = None;
                snapshot.warnings.clear();
                snapshot.verification_report = Some(report);
            }
            Err(error) if cancelled.load(Ordering::Acquire) => {
                snapshot.status = JobStatus::Cancelled;
                snapshot.phase = "cleaning_up".into();
                snapshot.error = Some(error.to_string());
                snapshot.error_code = Some("CANCELLED".into());
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                snapshot.status = JobStatus::Interrupted;
                snapshot.phase = "failed".into();
                snapshot.error = Some(error.to_string());
                snapshot.error_code = Some("INTERRUPTED".into());
            }
            Err(error) => {
                snapshot.status = JobStatus::Failed;
                snapshot.phase = "failed".into();
                snapshot.error = Some(error.to_string());
                snapshot.error_code = Some(job_error_code(snapshot.kind, &error).into());
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
            snapshot.error_code = Some("WORKER_PANIC".into());
        });
    }
}

fn job_error_code(kind: JobKind, error: &io::Error) -> &'static str {
    match (kind, error.kind()) {
        (
            JobKind::Create
            | JobKind::Split
            | JobKind::Concat
            | JobKind::Sort
            | JobKind::Strip
            | JobKind::Migrate,
            io::ErrorKind::AlreadyExists,
        ) => "OUTPUT_ALREADY_EXISTS",
        (JobKind::Append, io::ErrorKind::AlreadyExists) => "ARCHIVE_ENTRY_ALREADY_EXISTS",
        (_, io::ErrorKind::NotFound) => "NOT_FOUND",
        (_, io::ErrorKind::PermissionDenied) => "PERMISSION_DENIED",
        (_, io::ErrorKind::InvalidInput) => "INVALID_INPUT",
        (_, io::ErrorKind::InvalidData) => "INVALID_DATA",
        _ => "OPERATION_FAILED",
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

    use crate::operations::{
        CreateCompression, CreateEncryption, CreateOptions, CreateRequest, SplitRequest,
    };

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
    fn verification_job_retains_its_structured_report() {
        // BE-VERIFY-JOB-REPORT
        use std::io::Write;

        use libpna::{Archive, EntryBuilder, EntryName, WriteOptions};

        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("verify.pna");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let mut entry =
            EntryBuilder::new_file(EntryName::from("readme.txt"), WriteOptions::store()).unwrap();
        entry.write_all(b"job report").unwrap();
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();

        let manager = JobManager::default();
        let snapshot = manager
            .start(
                JobRequest::Verify(crate::verification::VerifyRequest {
                    archive_path,
                    password: None,
                    mode: crate::verification::VerificationMode::Complete,
                }),
                Arc::new(|_| {}),
            )
            .unwrap();
        let completed = wait_for_terminal(&manager, &snapshot.id);

        assert_eq!(completed.kind, JobKind::Verify);
        assert_eq!(completed.status, JobStatus::Succeeded);
        let report = completed.verification_report.unwrap();
        assert_eq!(
            report.conclusion,
            crate::verification::VerificationConclusion::Passed
        );
        assert_eq!(report.files_checked, 1);
        assert!(completed.output_path.is_none());
    }

    #[test]
    fn retrying_a_failed_verification_starts_clean_and_produces_a_fresh_report() {
        // BE-VERIFY-RETRY-REPORT
        use libpna::Archive;

        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("missing.pna");
        let manager = JobManager::default();
        let queued = manager
            .start(
                JobRequest::Verify(crate::verification::VerifyRequest {
                    archive_path: archive_path.clone(),
                    password: None,
                    mode: crate::verification::VerificationMode::Quick,
                }),
                Arc::new(|_| {}),
            )
            .unwrap();
        let failed = wait_for_terminal(&manager, &queued.id);
        assert_eq!(failed.status, JobStatus::Failed);
        assert!(failed.verification_report.is_none());

        let file = fs::File::create(&archive_path).unwrap();
        Archive::write_header(file).unwrap().finalize().unwrap();
        let retried = manager.retry(&queued.id, Arc::new(|_| {})).unwrap();
        assert!(retried.verification_report.is_none());
        let completed = wait_for_terminal(&manager, &queued.id);
        assert_eq!(completed.status, JobStatus::Succeeded);
        assert!(completed.verification_report.is_some());
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
        assert_eq!(retry.id, failed.id);
        assert_eq!(manager.list().len(), 1);
        assert_eq!(
            wait_for_terminal(&manager, &retry.id).status,
            JobStatus::Succeeded
        );
        assert_eq!(manager.list().len(), 1);
        assert!(output.exists());
    }

    #[test]
    fn failed_split_keeps_the_conflicting_output_discoverable() {
        // BE-VOLUME-SPLIT-CONFLICT-DISCOVERY
        let temp = tempdir().unwrap();
        let source = temp.path().join("backup.pna");
        let first_part = temp.path().join("backup.part1.pna");
        fs::write(&first_part, b"existing part").unwrap();
        let manager = JobManager::default();

        let queued = manager
            .start(
                JobRequest::Split(SplitRequest {
                    archive_path: source,
                    output_directory: temp.path().to_path_buf(),
                    max_part_bytes: 1024,
                }),
                Arc::new(|_| {}),
            )
            .unwrap();
        let failed = wait_for_terminal(&manager, &queued.id);

        assert_eq!(failed.status, JobStatus::Failed);
        assert_eq!(failed.output_path.as_deref(), first_part.to_str());
        assert!(failed.error.as_deref().unwrap().contains("already exists"));
        assert_eq!(failed.error_code.as_deref(), Some("OUTPUT_ALREADY_EXISTS"));
    }
}

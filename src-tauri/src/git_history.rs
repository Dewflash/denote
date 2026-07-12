// src-tauri/src/git_history.rs — pass-11 git-backed vault history using git2, never shelling out.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use git2::{
    build::CheckoutBuilder, Cred, FetchOptions, IndexAddOption, ObjectType, Oid, PushOptions,
    RemoteCallbacks, Repository, RepositoryInitOptions, Signature, TreeWalkMode, TreeWalkResult,
};
use serde::Serialize;

use crate::containment::contained_path;
use crate::fs_commands::VaultRoots;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDto {
    oid: String,
    summary: String,
    time: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusDto {
    enabled: bool,
    head: Option<String>,
    remote_url: Option<String>,
    dirty: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullDto {
    status: GitStatusDto,
    conflicts: Vec<String>,
}

const GITIGNORE: &str = ".denote/*\n!.denote/meta.json\n!.denote/ai/\n.denote/ai/*\n!.denote/ai/topics.json\n.denote/cache/\n.denote/annotations.json\n.denote/rejections.json\n.denote/snapshots/\n*.denote-tmp\n";

fn roots(state: &VaultRoots) -> Vec<PathBuf> {
    state.0.lock().unwrap().clone()
}

fn vault_root(root: &str, state: &VaultRoots) -> Result<PathBuf, String> {
    contained_path(&roots(state), root, "")
}

fn open_or_init(path: &Path) -> Result<Repository, String> {
    match Repository::open(path) {
        Ok(repo) => Ok(repo),
        Err(_) => {
            let mut opts = RepositoryInitOptions::new();
            opts.initial_head("main");
            Repository::init_opts(path, &opts).map_err(|e| e.message().to_string())
        }
    }
}

fn signature() -> Result<Signature<'static>, String> {
    Signature::now("DeNote", "denote@local").map_err(|e| e.message().to_string())
}

#[tauri::command]
pub fn git_history_enable(root: String, state: tauri::State<'_, VaultRoots>) -> Result<GitStatusDto, String> {
    let path = vault_root(&root, &state)?;
    let repo = open_or_init(&path)?;
    fs::write(path.join(".gitignore"), GITIGNORE).map_err(|e| e.to_string())?;
    let _ = commit_all_inner(&repo, "Initialize DeNote vault history");
    status_inner(&repo)
}

#[tauri::command]
pub fn git_history_status(root: String, state: tauri::State<'_, VaultRoots>) -> Result<GitStatusDto, String> {
    let path = vault_root(&root, &state)?;
    match Repository::open(path) {
        Ok(repo) => status_inner(&repo),
        Err(_) => Ok(GitStatusDto {
            enabled: false,
            head: None,
            remote_url: None,
            dirty: false,
        }),
    }
}

#[tauri::command]
pub fn git_commit_all(root: String, message: String, state: tauri::State<'_, VaultRoots>) -> Result<Option<GitCommitDto>, String> {
    let path = vault_root(&root, &state)?;
    let repo = open_or_init(&path)?;
    commit_all_inner(&repo, &message)
}

#[tauri::command]
pub fn git_file_history(root: String, rel_path: String, state: tauri::State<'_, VaultRoots>) -> Result<Vec<GitCommitDto>, String> {
    let path = vault_root(&root, &state)?;
    let repo = Repository::open(path).map_err(|e| e.message().to_string())?;
    let mut walk = repo.revwalk().map_err(|e| e.message().to_string())?;
    walk.push_head().map_err(|e| e.message().to_string())?;
    let mut out = Vec::new();
    let mut last_blob: Option<Oid> = None;
    for oid in walk.flatten() {
        let commit = repo.find_commit(oid).map_err(|e| e.message().to_string())?;
        let blob = blob_oid_for_path(&repo, &commit, &rel_path);
        if blob.is_some() && blob != last_blob {
            out.push(dto(&commit));
            last_blob = blob;
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn git_read_file_at(root: String, rel_path: String, commit: String, state: tauri::State<'_, VaultRoots>) -> Result<String, String> {
    let path = vault_root(&root, &state)?;
    let repo = Repository::open(path).map_err(|e| e.message().to_string())?;
    let oid = Oid::from_str(&commit).map_err(|e| e.message().to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.message().to_string())?;
    let tree = commit.tree().map_err(|e| e.message().to_string())?;
    let entry = tree.get_path(Path::new(&rel_path)).map_err(|e| e.message().to_string())?;
    let object = entry.to_object(&repo).map_err(|e| e.message().to_string())?;
    let blob = object.as_blob().ok_or_else(|| "history entry is not a file".to_string())?;
    String::from_utf8(blob.content().to_vec()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_set_remote(root: String, url: String, state: tauri::State<'_, VaultRoots>) -> Result<GitStatusDto, String> {
    let path = vault_root(&root, &state)?;
    let repo = Repository::open(path).map_err(|e| e.message().to_string())?;
    if repo.find_remote("origin").is_ok() {
        repo.remote_set_url("origin", &url).map_err(|e| e.message().to_string())?;
    } else {
        repo.remote("origin", &url).map_err(|e| e.message().to_string())?;
    }
    status_inner(&repo)
}

#[tauri::command]
pub fn git_push_origin(root: String, token: Option<String>, state: tauri::State<'_, VaultRoots>) -> Result<(), String> {
    let path = vault_root(&root, &state)?;
    let repo = Repository::open(path).map_err(|e| e.message().to_string())?;
    let mut remote = repo.find_remote("origin").map_err(|e| e.message().to_string())?;
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, username, _allowed| {
        if let Some(token) = token.as_deref() {
            Cred::userpass_plaintext(username.unwrap_or("x-access-token"), token)
        } else {
            Cred::default()
        }
    });
    let mut opts = PushOptions::new();
    opts.remote_callbacks(callbacks);
    remote
        .push(&["refs/heads/main:refs/heads/main"], Some(&mut opts))
        .map_err(|e| e.message().to_string())
}

#[tauri::command]
pub fn git_pull_fast_forward(root: String, token: Option<String>, state: tauri::State<'_, VaultRoots>) -> Result<GitPullDto, String> {
    let path = vault_root(&root, &state)?;
    let repo = Repository::open(&path).map_err(|e| e.message().to_string())?;
    let mut remote = repo.find_remote("origin").map_err(|e| e.message().to_string())?;
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, username, _allowed| {
        if let Some(token) = token.as_deref() {
            Cred::userpass_plaintext(username.unwrap_or("x-access-token"), token)
        } else {
            Cred::default()
        }
    });
    let mut fetch = FetchOptions::new();
    fetch.remote_callbacks(callbacks);
    remote
        .fetch(&["main"], Some(&mut fetch), None)
        .map_err(|e| e.message().to_string())?;
    let fetch_head = repo.find_reference("FETCH_HEAD").map_err(|e| e.message().to_string())?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| e.message().to_string())?;
    let analysis = repo.merge_analysis(&[&fetch_commit]).map_err(|e| e.message().to_string())?;
    if analysis.0.is_up_to_date() {
        return Ok(GitPullDto {
            status: status_inner(&repo)?,
            conflicts: Vec::new(),
        });
    }
    if !analysis.0.is_fast_forward() {
        let conflicts = materialize_remote_conflicts(&repo, &path, fetch_commit.id())?;
        return Ok(GitPullDto {
            status: status_inner(&repo)?,
            conflicts,
        });
    }
    let refname = "refs/heads/main";
    match repo.find_reference(refname) {
        Ok(mut r) => {
            r.set_target(fetch_commit.id(), "Fast-forward from origin/main")
                .map_err(|e| e.message().to_string())?;
        }
        Err(_) => {
            repo.reference(refname, fetch_commit.id(), true, "Create main from origin/main")
                .map_err(|e| e.message().to_string())?;
        }
    }
    repo.set_head(refname).map_err(|e| e.message().to_string())?;
    repo.checkout_head(Some(CheckoutBuilder::default().force()))
        .map_err(|e| e.message().to_string())?;
    Ok(GitPullDto {
        status: status_inner(&repo)?,
        conflicts: Vec::new(),
    })
}

fn commit_all_inner(repo: &Repository, message: &str) -> Result<Option<GitCommitDto>, String> {
    let mut index = repo.index().map_err(|e| e.message().to_string())?;
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(|e| e.message().to_string())?;
    index.write().map_err(|e| e.message().to_string())?;
    let tree_oid = index.write_tree().map_err(|e| e.message().to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.message().to_string())?;
    let sig = signature()?;
    let parent = repo.head().ok().and_then(|h| h.target()).and_then(|oid| repo.find_commit(oid).ok());
    if let Some(parent) = parent.as_ref() {
        if parent.tree_id() == tree_oid {
            return Ok(None);
        }
        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, message, &tree, &[parent])
            .map_err(|e| e.message().to_string())?;
        Ok(Some(dto(&repo.find_commit(oid).map_err(|e| e.message().to_string())?)))
    } else {
        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, message, &tree, &[])
            .map_err(|e| e.message().to_string())?;
        Ok(Some(dto(&repo.find_commit(oid).map_err(|e| e.message().to_string())?)))
    }
}

fn status_inner(repo: &Repository) -> Result<GitStatusDto, String> {
    let head = repo.head().ok().and_then(|h| h.target()).map(|oid| oid.to_string());
    let remote_url = repo
        .find_remote("origin")
        .ok()
        .and_then(|r| r.url().ok().map(str::to_string));
    let dirty = repo
        .statuses(None)
        .map_err(|e| e.message().to_string())?
        .iter()
        .any(|s| !s.status().is_ignored());
    Ok(GitStatusDto {
        enabled: true,
        head,
        remote_url,
        dirty,
    })
}

fn blob_oid_for_path(repo: &Repository, commit: &git2::Commit<'_>, rel_path: &str) -> Option<Oid> {
    commit
        .tree()
        .ok()?
        .get_path(Path::new(rel_path))
        .ok()?
        .to_object(repo)
        .ok()?
        .as_blob()
        .map(|b| b.id())
}

fn materialize_remote_conflicts(repo: &Repository, root: &Path, remote_oid: Oid) -> Result<Vec<String>, String> {
    let head_oid = repo.head().map_err(|e| e.message().to_string())?.target().ok_or_else(|| "local HEAD is unborn".to_string())?;
    let base_oid = repo.merge_base(head_oid, remote_oid).map_err(|e| e.message().to_string())?;
    let head = repo.find_commit(head_oid).map_err(|e| e.message().to_string())?;
    let base = repo.find_commit(base_oid).map_err(|e| e.message().to_string())?;
    let remote = repo.find_commit(remote_oid).map_err(|e| e.message().to_string())?;
    let head_tree = head.tree().map_err(|e| e.message().to_string())?;
    let base_tree = base.tree().map_err(|e| e.message().to_string())?;
    let remote_tree = remote.tree().map_err(|e| e.message().to_string())?;
    let date = today_ymd();
    let mut changed = Vec::<(String, Oid)>::new();

    remote_tree
        .walk(TreeWalkMode::PreOrder, |prefix, entry| {
            let Ok(name) = entry.name() else {
                return TreeWalkResult::Ok;
            };
            let rel = format!("{prefix}{name}");
            if entry.kind() != Some(ObjectType::Blob) || !rel.to_lowercase().ends_with(".md") {
                return TreeWalkResult::Ok;
            }
            let remote_blob = entry.id();
            let base_blob = blob_oid_for_tree(repo, &base_tree, &rel);
            let head_blob = blob_oid_for_tree(repo, &head_tree, &rel);
            if base_blob != Some(remote_blob) && head_blob != Some(remote_blob) {
                changed.push((rel, remote_blob));
            }
            TreeWalkResult::Ok
        })
        .map_err(|e| e.message().to_string())?;

    let mut conflicts = Vec::new();
    for (rel, oid) in changed {
        let blob = repo.find_blob(oid).map_err(|e| e.message().to_string())?;
        let content = match std::str::from_utf8(blob.content()) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let conflict_rel = unique_conflict_path(root, &rel, &date);
        if let Some(parent) = Path::new(&conflict_rel).parent() {
            fs::create_dir_all(root.join(parent)).map_err(|e| e.to_string())?;
        }
        fs::write(root.join(&conflict_rel), content).map_err(|e| e.to_string())?;
        conflicts.push(conflict_rel);
    }
    if conflicts.is_empty() {
        return Err("Remote changes are not a fast-forward, but no Markdown conflict files could be materialized.".into());
    }
    Ok(conflicts)
}

fn blob_oid_for_tree(repo: &Repository, tree: &git2::Tree<'_>, rel_path: &str) -> Option<Oid> {
    tree.get_path(Path::new(rel_path))
        .ok()?
        .to_object(repo)
        .ok()?
        .as_blob()
        .map(|b| b.id())
}

fn unique_conflict_path(root: &Path, rel: &str, date: &str) -> String {
    let path = Path::new(rel);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Note");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("md");
    let parent = path.parent().and_then(|p| p.to_str()).unwrap_or("");
    for n in 0..1000 {
        let suffix = if n == 0 { String::new() } else { format!(" {n}") };
        let file = format!("{stem} (conflict {date}){suffix}.{ext}");
        let candidate = if parent.is_empty() { file } else { format!("{parent}/{file}") };
        if !root.join(&candidate).exists() {
            return candidate;
        }
    }
    format!("{stem} (conflict {date} many).{ext}")
}

fn today_ymd() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096).div_euclid(365);
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2).div_euclid(153);
    let day = doy - (153 * mp + 2).div_euclid(5) + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year, month as u32, day as u32)
}

fn dto(commit: &git2::Commit<'_>) -> GitCommitDto {
    GitCommitDto {
        oid: commit.id().to_string(),
        summary: commit
            .summary()
            .ok()
            .flatten()
            .unwrap_or("Vault checkpoint")
            .to_string(),
        time: commit.time().seconds(),
    }
}

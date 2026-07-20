// src-tauri/src/embeddings.rs — the local embedding subsystem (D24/S14).
//
// Split into two concerns so the error-prone part is testable without the model:
//   1. `EmbeddingStore` — the on-disk vector store (S14 `embeddings.bin` + `embeddings.idx`
//      format, incremental upsert, free-slot reuse, compaction, brute-force cosine topK). It has
//      NO dependency on fastembed/ort, so `cargo test --lib` exercises the binary format and the
//      similarity math directly. This is where S14 bugs would otherwise hide.
//   2. `Embedder` — the fastembed model wrapper (inference only). Downloads the model to app
//      support on first use; L2-normalizes so cosine == dot product (S14).
//
// Persistence is per vault root, cached in `EmbeddingsState`. All file writes are atomic
// (tmp + rename, S7). Everything is contained to a registered vault root (S22) — the `.bin`/`.idx`
// live under `.denote/ai/`, which is inside the vault.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::containment::contained_path;
use crate::fs_commands::VaultRoots;

pub const BIN_REL: &str = ".denote/ai/embeddings.bin";
pub const IDX_REL: &str = ".denote/ai/embeddings.idx";
const MAGIC: &[u8; 4] = b"DENV";
const VERSION: u32 = 1;
/// Compact (rewrite dropping dead rows) once dead rows exceed this fraction of the total (S14).
const COMPACT_FRACTION: f64 = 0.25;
const EMBEDDING_STATUS_EVENT: &str = "denote://embedding-status";
const EMBEDDING_MODEL_ID: &str = "intfloat/multilingual-e5-small";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddingStatusEvent {
    status: &'static str,
    model_id: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    percent: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    downloaded_bytes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_bytes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

fn emit_embedding_status(
    app: &tauri::AppHandle,
    status: &'static str,
    percent: Option<u8>,
    file: Option<String>,
    downloaded_bytes: Option<usize>,
    total_bytes: Option<usize>,
    detail: Option<String>,
) {
    let _ = app.emit(
        EMBEDDING_STATUS_EVENT,
        EmbeddingStatusEvent {
            status,
            model_id: EMBEDDING_MODEL_ID,
            percent,
            file,
            downloaded_bytes,
            total_bytes,
            detail,
        },
    );
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdxRow {
    pub row: usize,
    pub rel_path: String,
    pub content_hash: String,
}

/// The `.idx` sidecar (JSON, S26 `version`). `model` is the exact embedding model id; a mismatch
/// at load means the whole store is invalid and must be re-embedded (S14) — the frontend drives
/// that by comparing this `model` to the app's current one.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdxFile {
    pub version: u32,
    pub model: String,
    pub dim: u32,
    pub rows: Vec<IdxRow>,
    pub free: Vec<usize>,
}

/// One entry to write, as it arrives from the frontend (vector already dim-length).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutEntry {
    pub rel_path: String,
    pub content_hash: String,
    pub vector: Vec<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Neighbor {
    pub rel_path: String,
    pub cos: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorRow {
    pub rel_path: String,
    pub vector: Vec<f32>,
}

/// The in-memory store: a flat f32 matrix (`row_count * dim`, row-major) plus the idx bookkeeping.
/// Dead rows (in `free`) keep their slot in `data` until a compaction rewrites the file.
pub struct EmbeddingStore {
    model: String,
    dim: usize,
    row_count: usize,
    data: Vec<f32>, // row_count * dim, row-major
    rows: Vec<IdxRow>,
    free: Vec<usize>,
}

impl EmbeddingStore {
    pub fn new(model: String, dim: usize) -> Self {
        Self {
            model,
            dim,
            row_count: 0,
            data: Vec::new(),
            rows: Vec::new(),
            free: Vec::new(),
        }
    }

    pub fn model(&self) -> &str {
        &self.model
    }
    pub fn dim(&self) -> usize {
        self.dim
    }
    #[allow(dead_code)] // used by tests; the command layer reads live rows via to_idx()
    pub fn live_len(&self) -> usize {
        self.rows.len()
    }

    // ── serialization (S14) ─────────────────────────────────────────────────────

    pub fn to_bin(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(16 + self.data.len() * 4);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&VERSION.to_le_bytes());
        out.extend_from_slice(&(self.dim as u32).to_le_bytes());
        out.extend_from_slice(&(self.row_count as u32).to_le_bytes());
        for v in &self.data {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out
    }

    pub fn to_idx(&self) -> IdxFile {
        IdxFile {
            version: VERSION,
            model: self.model.clone(),
            dim: self.dim as u32,
            rows: self.rows.clone(),
            free: self.free.clone(),
        }
    }

    /// Rebuild a store from its two files. Returns None if the bytes are malformed or the two
    /// files disagree (dim/rowCount) — the caller then treats the store as empty and re-embeds.
    pub fn from_files(bin: &[u8], idx: &IdxFile) -> Option<Self> {
        if bin.len() < 16 || &bin[0..4] != MAGIC {
            return None;
        }
        let version = u32::from_le_bytes(bin[4..8].try_into().ok()?);
        let dim = u32::from_le_bytes(bin[8..12].try_into().ok()?) as usize;
        let row_count = u32::from_le_bytes(bin[12..16].try_into().ok()?) as usize;
        if version != VERSION || dim != idx.dim as usize {
            return None;
        }
        let expected = 16 + row_count * dim * 4;
        if bin.len() < expected || dim == 0 {
            return None;
        }
        let mut data = Vec::with_capacity(row_count * dim);
        for i in 0..row_count * dim {
            let off = 16 + i * 4;
            data.push(f32::from_le_bytes(bin[off..off + 4].try_into().ok()?));
        }
        Some(Self {
            model: idx.model.clone(),
            dim,
            row_count,
            data,
            rows: idx.rows.clone(),
            free: idx.free.clone(),
        })
    }

    // ── mutation ─────────────────────────────────────────────────────────────────

    fn write_row(&mut self, row: usize, vector: &[f32]) {
        let base = row * self.dim;
        let normed = l2_normalize(vector);
        self.data[base..base + self.dim].copy_from_slice(&normed);
    }

    /// Insert or update the vector for `rel_path`. Reuses the existing row if the path is already
    /// present, else a free slot, else appends (S14). The vector is L2-normalized on write so
    /// similarity is a dot product. `vector.len()` must equal `dim`; mismatched vectors are ignored.
    pub fn put(&mut self, rel_path: &str, content_hash: &str, vector: &[f32]) {
        if vector.len() != self.dim {
            return;
        }
        if let Some(existing) = self.rows.iter().position(|r| r.rel_path == rel_path) {
            let row = self.rows[existing].row;
            self.write_row(row, vector);
            self.rows[existing].content_hash = content_hash.to_string();
            return;
        }
        let row = if let Some(free_row) = self.free.pop() {
            free_row
        } else {
            let r = self.row_count;
            self.row_count += 1;
            self.data.resize(self.row_count * self.dim, 0.0);
            r
        };
        self.write_row(row, vector);
        self.rows.push(IdxRow {
            row,
            rel_path: rel_path.to_string(),
            content_hash: content_hash.to_string(),
        });
    }

    /// Mark a path's row free (delete). The vector bytes remain until the next compaction.
    pub fn remove(&mut self, rel_path: &str) {
        if let Some(pos) = self.rows.iter().position(|r| r.rel_path == rel_path) {
            let removed = self.rows.remove(pos);
            self.free.push(removed.row);
        }
    }

    /// Re-key a path (D4a Finder move) without re-embedding — the vector row is unchanged.
    pub fn remap(&mut self, from: &str, to: &str) {
        if let Some(r) = self.rows.iter_mut().find(|r| r.rel_path == from) {
            r.rel_path = to.to_string();
        }
    }

    /// True when `rel_path` has no live row at this exact `content_hash` (needs (re)embedding).
    /// The frontend normally diffs via `embeddings_index` instead; kept + tested as the direct
    /// predicate the store guarantees.
    #[allow(dead_code)]
    pub fn needs(&self, rel_path: &str, content_hash: &str) -> bool {
        !self
            .rows
            .iter()
            .any(|r| r.rel_path == rel_path && r.content_hash == content_hash)
    }

    /// Whether dead rows exceed the S14 compaction threshold.
    pub fn should_compact(&self) -> bool {
        self.row_count > 0 && (self.free.len() as f64) > COMPACT_FRACTION * (self.row_count as f64)
    }

    /// Rewrite the matrix dropping all dead rows, renumbering live rows 0..n (S14 compaction).
    pub fn compact(&mut self) {
        let mut new_data: Vec<f32> = Vec::with_capacity(self.rows.len() * self.dim);
        let mut new_rows: Vec<IdxRow> = Vec::with_capacity(self.rows.len());
        for (new_row, r) in self.rows.iter().enumerate() {
            let base = r.row * self.dim;
            new_data.extend_from_slice(&self.data[base..base + self.dim]);
            new_rows.push(IdxRow {
                row: new_row,
                rel_path: r.rel_path.clone(),
                content_hash: r.content_hash.clone(),
            });
        }
        self.data = new_data;
        self.rows = new_rows;
        self.row_count = self.rows.len();
        self.free.clear();
    }

    // ── query ───────────────────────────────────────────────────────────────────

    fn row_slice(&self, row: usize) -> &[f32] {
        let base = row * self.dim;
        &self.data[base..base + self.dim]
    }

    /// Fetch the stored (L2-normalized) vectors for a set of relPaths, in request order; paths with
    /// no stored vector are skipped. Used for folder-centroid / misfit math (pass-8) which the TS
    /// ontology layer computes over raw vectors.
    pub fn vectors_for(&self, rel_paths: &[String]) -> Vec<VectorRow> {
        rel_paths
            .iter()
            .filter_map(|p| {
                self.rows
                    .iter()
                    .find(|r| &r.rel_path == p)
                    .map(|r| VectorRow {
                        rel_path: r.rel_path.clone(),
                        vector: self.row_slice(r.row).to_vec(),
                    })
            })
            .collect()
    }

    /// Brute-force cosine kNN for `rel_path` (D15/pass-7 brief: fine ≤10k notes). Vectors are
    /// L2-normalized, so cosine == dot product. Excludes the query note; keeps neighbors with
    /// cos ≥ `min_cos`; returns the top `k` sorted by cosine descending (ties by relPath).
    pub fn top_k(&self, rel_path: &str, k: usize, min_cos: f32) -> Vec<Neighbor> {
        let query = match self.rows.iter().find(|r| r.rel_path == rel_path) {
            Some(r) => self.row_slice(r.row).to_vec(),
            None => return Vec::new(),
        };
        let mut scored: Vec<Neighbor> = self
            .rows
            .iter()
            .filter(|r| r.rel_path != rel_path)
            .map(|r| Neighbor {
                rel_path: r.rel_path.clone(),
                cos: dot(&query, self.row_slice(r.row)),
            })
            .filter(|n| n.cos >= min_cos)
            .collect();
        scored.sort_by(|a, b| {
            b.cos
                .partial_cmp(&a.cos)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.rel_path.cmp(&b.rel_path))
        });
        scored.truncate(k);
        scored
    }

    /// Cosine topK for an EXTERNAL query vector (S24 cross-vault: a note in vault A queries vault
    /// B's store). The query note is not in this store, so nothing is excluded by relPath. The
    /// query is L2-normalized so cosine == dot even if the caller passed a raw vector.
    pub fn top_k_vector(&self, query: &[f32], k: usize, min_cos: f32) -> Vec<Neighbor> {
        if query.len() != self.dim {
            return Vec::new();
        }
        let q = l2_normalize(query);
        let mut scored: Vec<Neighbor> = self
            .rows
            .iter()
            .map(|r| Neighbor {
                rel_path: r.rel_path.clone(),
                cos: dot(&q, self.row_slice(r.row)),
            })
            .filter(|n| n.cos >= min_cos)
            .collect();
        scored.sort_by(|a, b| {
            b.cos
                .partial_cmp(&a.cos)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.rel_path.cmp(&b.rel_path))
        });
        scored.truncate(k);
        scored
    }
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn l2_normalize(v: &[f32]) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm <= f32::EPSILON {
        return v.to_vec();
    }
    v.iter().map(|x| x / norm).collect()
}

// ── persistence + Tauri state ───────────────────────────────────────────────────

#[derive(Default)]
pub struct EmbeddingsState {
    /// One store per canonical vault root; loaded lazily on first access.
    stores: Mutex<HashMap<PathBuf, EmbeddingStore>>,
    /// The fastembed model, initialized on first `embed_texts`. `Option` so app boot never pays
    /// the model-load cost and an unavailable model degrades gracefully.
    embedder: Mutex<Option<Embedder>>,
    /// The last lifecycle status emitted to the UI, so `ready` fires only on transition instead
    /// of once per `embed_texts` batch (R-1: the event stream stays meaningful).
    last_emitted: Mutex<Option<&'static str>>,
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    let tmp = PathBuf::from(format!("{}.denote-tmp", path.display()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("tmp create failed: {e}"))?;
        f.write_all(bytes).map_err(|e| format!("write failed: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync failed: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("atomic rename failed: {e}"))
}

fn load_store(bin_path: &Path, idx_path: &Path) -> Option<EmbeddingStore> {
    let idx_raw = fs::read_to_string(idx_path).ok()?;
    let idx: IdxFile = serde_json::from_str(&idx_raw).ok()?;
    let bin = fs::read(bin_path).ok()?;
    EmbeddingStore::from_files(&bin, &idx)
}

impl EmbeddingsState {
    /// Persist a store's two files atomically under the vault's `.denote/ai/`.
    fn persist(store: &EmbeddingStore, bin_path: &Path, idx_path: &Path) -> Result<(), String> {
        atomic_write(bin_path, &store.to_bin())?;
        let idx_json =
            serde_json::to_vec_pretty(&store.to_idx()).map_err(|e| format!("idx encode: {e}"))?;
        atomic_write(idx_path, &idx_json)
    }
}

// ── commands ─────────────────────────────────────────────────────────────────────

fn store_paths(roots: &[PathBuf], root: &str) -> Result<(PathBuf, PathBuf), String> {
    Ok((
        contained_path(roots, root, BIN_REL)?,
        contained_path(roots, root, IDX_REL)?,
    ))
}

/// Return the current `.idx` contents (model + rows{relPath, contentHash}) so the frontend can
/// diff against its note index and decide what to (re)embed. Missing store → an empty idx with
/// the model the caller last saw is not known here, so `model` is empty and `rows` empty.
#[tauri::command]
pub fn embeddings_index(
    root: String,
    state: tauri::State<'_, EmbeddingsState>,
    vaults: tauri::State<'_, VaultRoots>,
) -> Result<IdxFile, String> {
    let roots = vaults.0.lock().unwrap().clone();
    let (bin_path, idx_path) = store_paths(&roots, &root)?;
    let mut stores = state.stores.lock().unwrap();
    if !stores.contains_key(&bin_path) {
        if let Some(s) = load_store(&bin_path, &idx_path) {
            stores.insert(bin_path.clone(), s);
        }
    }
    Ok(stores.get(&bin_path).map(|s| s.to_idx()).unwrap_or(IdxFile {
        version: VERSION,
        model: String::new(),
        dim: 0,
        rows: Vec::new(),
        free: Vec::new(),
    }))
}

/// Upsert a batch of vectors. If the incoming `model` or `dim` differs from the stored one, the
/// store is discarded and rebuilt fresh (S14 model-mismatch invalidation). Persists atomically;
/// compacts opportunistically.
#[tauri::command]
pub fn embeddings_put(
    root: String,
    model: String,
    dim: u32,
    entries: Vec<PutEntry>,
    state: tauri::State<'_, EmbeddingsState>,
    vaults: tauri::State<'_, VaultRoots>,
) -> Result<(), String> {
    let roots = vaults.0.lock().unwrap().clone();
    let (bin_path, idx_path) = store_paths(&roots, &root)?;
    let mut stores = state.stores.lock().unwrap();

    let existing = stores.remove(&bin_path).or_else(|| load_store(&bin_path, &idx_path));
    let mut store = match existing {
        Some(s) if s.model() == model && s.dim() == dim as usize => s,
        _ => EmbeddingStore::new(model.clone(), dim as usize), // fresh: model/dim changed or absent
    };

    for e in &entries {
        store.put(&e.rel_path, &e.content_hash, &e.vector);
    }
    if store.should_compact() {
        store.compact();
    }
    EmbeddingsState::persist(&store, &bin_path, &idx_path)?;
    stores.insert(bin_path, store);
    Ok(())
}

#[tauri::command]
pub fn embeddings_remove(
    root: String,
    rel_path: String,
    state: tauri::State<'_, EmbeddingsState>,
    vaults: tauri::State<'_, VaultRoots>,
) -> Result<(), String> {
    mutate_store(&root, &state, &vaults, |s| s.remove(&rel_path))
}

#[tauri::command]
pub fn embeddings_remap(
    root: String,
    from: String,
    to: String,
    state: tauri::State<'_, EmbeddingsState>,
    vaults: tauri::State<'_, VaultRoots>,
) -> Result<(), String> {
    mutate_store(&root, &state, &vaults, |s| s.remap(&from, &to))
}

fn mutate_store(
    root: &str,
    state: &tauri::State<'_, EmbeddingsState>,
    vaults: &tauri::State<'_, VaultRoots>,
    f: impl FnOnce(&mut EmbeddingStore),
) -> Result<(), String> {
    let roots = vaults.0.lock().unwrap().clone();
    let (bin_path, idx_path) = store_paths(&roots, root)?;
    let mut stores = state.stores.lock().unwrap();
    let existing = stores.remove(&bin_path).or_else(|| load_store(&bin_path, &idx_path));
    let Some(mut store) = existing else {
        return Ok(()); // no store yet → nothing to mutate
    };
    f(&mut store);
    EmbeddingsState::persist(&store, &bin_path, &idx_path)?;
    stores.insert(bin_path, store);
    Ok(())
}

/// Brute-force cosine topK for a note (S15 retrieval front-end feeds `labelSimilarity`).
#[tauri::command]
pub fn embeddings_topk(
    root: String,
    rel_path: String,
    k: usize,
    min_cos: f32,
    state: tauri::State<'_, EmbeddingsState>,
    vaults: tauri::State<'_, VaultRoots>,
) -> Result<Vec<Neighbor>, String> {
    let roots = vaults.0.lock().unwrap().clone();
    let (bin_path, idx_path) = store_paths(&roots, &root)?;
    let mut stores = state.stores.lock().unwrap();
    if !stores.contains_key(&bin_path) {
        if let Some(s) = load_store(&bin_path, &idx_path) {
            stores.insert(bin_path.clone(), s);
        }
    }
    Ok(stores
        .get(&bin_path)
        .map(|s| s.top_k(&rel_path, k, min_cos))
        .unwrap_or_default())
}

/// Cosine topK for an external query vector against a vault's store (S24 cross-vault: vault A's
/// note vector retrieves neighbors in vault B). Feeds `labelSimilarity` like `embeddings_topk`.
#[tauri::command]
pub fn embeddings_topk_vector(
    root: String,
    vector: Vec<f32>,
    k: usize,
    min_cos: f32,
    state: tauri::State<'_, EmbeddingsState>,
    vaults: tauri::State<'_, VaultRoots>,
) -> Result<Vec<Neighbor>, String> {
    let roots = vaults.0.lock().unwrap().clone();
    let (bin_path, idx_path) = store_paths(&roots, &root)?;
    let mut stores = state.stores.lock().unwrap();
    if !stores.contains_key(&bin_path) {
        if let Some(s) = load_store(&bin_path, &idx_path) {
            stores.insert(bin_path.clone(), s);
        }
    }
    Ok(stores
        .get(&bin_path)
        .map(|s| s.top_k_vector(&vector, k, min_cos))
        .unwrap_or_default())
}

/// Fetch stored vectors for a set of relPaths (pass-8 folder-centroid / misfit math). Missing
/// paths are simply omitted from the result.
#[tauri::command]
pub fn embeddings_vectors(
    root: String,
    rel_paths: Vec<String>,
    state: tauri::State<'_, EmbeddingsState>,
    vaults: tauri::State<'_, VaultRoots>,
) -> Result<Vec<VectorRow>, String> {
    let roots = vaults.0.lock().unwrap().clone();
    let (bin_path, idx_path) = store_paths(&roots, &root)?;
    let mut stores = state.stores.lock().unwrap();
    if !stores.contains_key(&bin_path) {
        if let Some(s) = load_store(&bin_path, &idx_path) {
            stores.insert(bin_path.clone(), s);
        }
    }
    Ok(stores
        .get(&bin_path)
        .map(|s| s.vectors_for(&rel_paths))
        .unwrap_or_default())
}

/// Embed a batch of texts with the local fastembed model (D24/S14). Model is lazily downloaded
/// to app support on first call; vectors are L2-normalized. Returns a typed error string if the
/// model is unavailable (offline + not yet downloaded) — the frontend queues + surfaces a notice.
#[tauri::command]
pub fn embed_texts(
    texts: Vec<String>,
    state: tauri::State<'_, EmbeddingsState>,
    app: tauri::AppHandle,
) -> Result<EmbedResult, String> {
    let mut guard = state.embedder.lock().unwrap();
    if guard.is_none() {
        // No unconditional "downloading" emit here: `Embedder::try_new` streams real download
        // progress only when files are actually missing, so a cached model never flashes 0%.
        match Embedder::try_new(&app) {
            Ok(embedder) => *guard = Some(embedder),
            Err(error) => {
                *state.last_emitted.lock().unwrap() = Some("error");
                emit_embedding_status(
                    &app,
                    "error",
                    None,
                    None,
                    None,
                    None,
                    Some(error.clone()),
                );
                return Err(error);
            }
        }
    }
    let embedder = guard.as_mut().unwrap();
    let vectors = match embedder.embed(&texts) {
        Ok(vectors) => vectors,
        Err(error) => {
            *state.last_emitted.lock().unwrap() = Some("error");
            emit_embedding_status(
                &app,
                "error",
                None,
                None,
                None,
                None,
                Some(error.clone()),
            );
            return Err(error);
        }
    };
    // `ready` only on transition (first success, or recovery after an error) — not per batch.
    {
        let mut last = state.last_emitted.lock().unwrap();
        if *last != Some("ready") {
            *last = Some("ready");
            emit_embedding_status(&app, "ready", Some(100), None, None, None, None);
        }
    }
    Ok(EmbedResult {
        model: embedder.model_id().to_string(),
        dim: embedder.dim() as u32,
        vectors,
    })
}

/// Snapshot of the embedding model lifecycle WITHOUT triggering a download or model load (R-1):
/// `ready` when the model is loaded or every file is already in the hf-hub cache, else
/// `not-downloaded` (or `error` when local embeddings are not compiled in). The frontend calls
/// this once at startup so the panel is truthful before the first `embed_texts`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingModelStatus {
    pub status: &'static str,
    pub model_id: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[tauri::command]
pub fn embedding_model_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, EmbeddingsState>,
) -> EmbeddingModelStatus {
    if state.embedder.lock().unwrap().is_some() {
        return EmbeddingModelStatus {
            status: "ready",
            model_id: EMBEDDING_MODEL_ID,
            detail: None,
        };
    }
    match Embedder::model_files_cached(&app) {
        Ok(true) => EmbeddingModelStatus {
            status: "ready",
            model_id: EMBEDDING_MODEL_ID,
            detail: None,
        },
        Ok(false) => EmbeddingModelStatus {
            status: "not-downloaded",
            model_id: EMBEDDING_MODEL_ID,
            detail: None,
        },
        Err(detail) => EmbeddingModelStatus {
            status: "error",
            model_id: EMBEDDING_MODEL_ID,
            detail: Some(detail),
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedResult {
    pub model: String,
    pub dim: u32,
    pub vectors: Vec<Vec<f32>>,
}

// ── fastembed wrapper (inference only) ───────────────────────────────────────────

pub use embedder_impl::Embedder;

#[cfg(feature = "local-embeddings")]
mod embedder_impl {
    use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
    use hf_hub::{api::{sync::ApiBuilder, Progress}, Cache};
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use tauri::{Emitter, Manager};

    use super::{EmbeddingStatusEvent, EMBEDDING_MODEL_ID, EMBEDDING_STATUS_EVENT};

    const MODEL_FILES: &[&str] = &[
        "onnx/model.onnx",
        "tokenizer.json",
        "config.json",
        "special_tokens_map.json",
        "tokenizer_config.json",
    ];

    fn model_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        if let Ok(path) = std::env::var("HF_HOME") {
            return Ok(PathBuf::from(path));
        }
        if let Ok(path) = std::env::var("FASTEMBED_CACHE_DIR") {
            return Ok(PathBuf::from(path));
        }
        app.path()
            .app_data_dir()
            .map(|dir| dir.join("embedding-model-cache"))
            .map_err(|e| format!("embedding model unavailable: cannot resolve writable app data: {e}"))
    }

    /// Shared progress across the WHOLE multi-file download: `percent` is a single overall
    /// 0→100 (files completed + the current file's byte fraction, over the files to fetch),
    /// so the UI bar never resets to 0 between the five model files (R-1).
    struct OverallDownload {
        app: tauri::AppHandle,
        files_total: usize,
        files_done: usize,
        file: Option<String>,
        downloaded: usize,
        total: usize,
    }

    impl OverallDownload {
        fn emit(&self) {
            let file_fraction = if self.total == 0 {
                0.0
            } else {
                (self.downloaded as f64 / self.total as f64).min(1.0)
            };
            let percent = if self.files_total == 0 {
                100.0
            } else {
                (self.files_done as f64 + file_fraction) / self.files_total as f64 * 100.0
            };
            let _ = self.app.emit(
                EMBEDDING_STATUS_EVENT,
                EmbeddingStatusEvent {
                    status: "downloading",
                    model_id: EMBEDDING_MODEL_ID,
                    percent: Some(percent.floor().min(100.0) as u8),
                    file: self.file.clone(),
                    downloaded_bytes: Some(self.downloaded),
                    total_bytes: Some(self.total),
                    detail: None,
                },
            );
        }
    }

    /// One hf-hub `Progress` handle per file, all feeding the same `OverallDownload`.
    struct FileProgress {
        shared: Arc<Mutex<OverallDownload>>,
    }

    impl Progress for FileProgress {
        fn init(&mut self, size: usize, filename: &str) {
            let mut shared = self.shared.lock().unwrap();
            shared.file = Some(filename.to_string());
            shared.downloaded = 0;
            shared.total = size;
            shared.emit();
        }

        fn update(&mut self, size: usize) {
            let mut shared = self.shared.lock().unwrap();
            shared.downloaded = shared.downloaded.saturating_add(size);
            if shared.total > 0 {
                shared.downloaded = shared.downloaded.min(shared.total);
            }
            shared.emit();
        }

        fn finish(&mut self) {
            let mut shared = self.shared.lock().unwrap();
            shared.downloaded = shared.total;
            shared.files_done += 1;
            shared.emit();
            shared.file = None;
            shared.downloaded = 0;
            shared.total = 0;
        }
    }

    fn prepare_model(app: &tauri::AppHandle) -> Result<(), String> {
        let cache_dir = model_cache_dir(app)?;
        let endpoint = std::env::var("HF_ENDPOINT")
            .unwrap_or_else(|_| "https://huggingface.co".to_string());
        let api = ApiBuilder::new()
            .with_cache_dir(cache_dir.clone())
            .with_endpoint(endpoint)
            .with_progress(false)
            .build()
            .map_err(|e| format!("embedding model unavailable: {e}"))?;
        let cache = Cache::new(cache_dir);
        let cached_repo = cache.model(EMBEDDING_MODEL_ID.to_string());
        let repo = api.model(EMBEDDING_MODEL_ID.to_string());
        let missing: Vec<&str> = MODEL_FILES
            .iter()
            .copied()
            .filter(|file| cached_repo.get(file).is_none())
            .collect();
        if missing.is_empty() {
            return Ok(());
        }
        let shared = Arc::new(Mutex::new(OverallDownload {
            app: app.clone(),
            files_total: missing.len(),
            files_done: 0,
            file: None,
            downloaded: 0,
            total: 0,
        }));
        for file in missing {
            repo.download_with_progress(file, FileProgress { shared: shared.clone() })
                .map_err(|e| format!("embedding model unavailable: {e}"))?;
        }
        Ok(())
    }

    /// The exact model id recorded in the store (S14/D32). `intfloat/multilingual-e5-small`,
    /// 384-dim, chosen for non-English content; fastembed's `MultilingualE5Small`.
    pub const MODEL_ID: &str = "intfloat/multilingual-e5-small";
    pub const MODEL_DIM: usize = 384;

    pub struct Embedder {
        model: TextEmbedding,
    }

    impl Embedder {
        /// Whether every model file is already in the hf-hub cache — a pure filesystem check,
        /// no network and no model load (R-1 `not-downloaded` detection).
        pub fn model_files_cached(app: &tauri::AppHandle) -> Result<bool, String> {
            let repo = Cache::new(model_cache_dir(app)?).model(EMBEDDING_MODEL_ID.to_string());
            Ok(MODEL_FILES.iter().all(|file| repo.get(file).is_some()))
        }

        pub fn try_new(app: &tauri::AppHandle) -> Result<Self, String> {
            let cache_dir = model_cache_dir(app)?;
            prepare_model(app)?;
            let model = TextEmbedding::try_new(
                InitOptions::new(EmbeddingModel::MultilingualE5Small)
                    .with_cache_dir(cache_dir)
                    .with_show_download_progress(false),
            )
            .map_err(|e| format!("embedding model unavailable: {e}"))?;
            Ok(Self { model })
        }

        pub fn model_id(&self) -> &str {
            MODEL_ID
        }
        pub fn dim(&self) -> usize {
            MODEL_DIM
        }

        pub fn embed(&mut self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
            // E5 models are trained with a task prefix; "query: " on both sides is correct for a
            // symmetric note-to-note similarity task.
            let prefixed: Vec<String> = texts.iter().map(|t| format!("query: {t}")).collect();
            let mut vectors = self
                .model
                .embed(prefixed, None)
                .map_err(|e| format!("embed failed: {e}"))?;
            for v in &mut vectors {
                l2_normalize_in_place(v);
            }
            Ok(vectors)
        }
    }

    fn l2_normalize_in_place(v: &mut [f32]) {
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > f32::EPSILON {
            for x in v.iter_mut() {
                *x /= norm;
            }
        }
    }
}

// Fallback when the heavy `ort`/fastembed stack isn't compiled in (e.g. CI without the ONNX
// runtime). Inference returns a typed "unavailable" error and the app queues embedding jobs;
// the store, topK, and all other commands remain fully functional. This keeps the crate building
// everywhere while the real model is opt-in via the `local-embeddings` feature.
#[cfg(not(feature = "local-embeddings"))]
mod embedder_impl {
    pub const MODEL_ID: &str = "intfloat/multilingual-e5-small";
    pub const MODEL_DIM: usize = 384;

    pub struct Embedder;

    impl Embedder {
        /// Without the ONNX stack the model can never become available; report that verbatim
        /// instead of a misleading `not-downloaded`.
        pub fn model_files_cached(_app: &tauri::AppHandle) -> Result<bool, String> {
            Err("local embeddings not compiled in (build with --features local-embeddings)".into())
        }

        pub fn try_new(_app: &tauri::AppHandle) -> Result<Self, String> {
            Err("local embeddings not compiled in (build with --features local-embeddings)".into())
        }
        pub fn model_id(&self) -> &str {
            MODEL_ID
        }
        pub fn dim(&self) -> usize {
            MODEL_DIM
        }
        pub fn embed(&mut self, _texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
            Err("local embeddings not compiled in".into())
        }
    }
}

// ── tests (S14: the binary format + similarity math, no model needed) ────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> EmbeddingStore {
        EmbeddingStore::new("intfloat/multilingual-e5-small".to_string(), 4)
    }

    #[test]
    fn bin_header_is_denv_v1_dim_rowcount() {
        let mut s = store();
        s.put("a.md", "h1", &[1.0, 0.0, 0.0, 0.0]);
        let bin = s.to_bin();
        assert_eq!(&bin[0..4], MAGIC);
        assert_eq!(u32::from_le_bytes(bin[4..8].try_into().unwrap()), 1); // version
        assert_eq!(u32::from_le_bytes(bin[8..12].try_into().unwrap()), 4); // dim
        assert_eq!(u32::from_le_bytes(bin[12..16].try_into().unwrap()), 1); // rowCount
        assert_eq!(bin.len(), 16 + 4 * 4);
    }

    #[test]
    fn round_trips_through_files() {
        let mut s = store();
        s.put("a.md", "h1", &[3.0, 4.0, 0.0, 0.0]); // normalizes to 0.6,0.8,0,0
        s.put("b.md", "h2", &[0.0, 0.0, 1.0, 0.0]);
        let bin = s.to_bin();
        let idx = s.to_idx();
        let re = EmbeddingStore::from_files(&bin, &idx).expect("reload");
        assert_eq!(re.live_len(), 2);
        // vector stored normalized: 3/5, 4/5
        let n = re.top_k("b.md", 5, -1.0);
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].rel_path, "a.md");
        assert!((n[0].cos - 0.0).abs() < 1e-6); // orthogonal
    }

    #[test]
    fn stores_vectors_l2_normalized_so_self_cosine_is_one() {
        let mut s = store();
        s.put("a.md", "h", &[3.0, 4.0, 0.0, 0.0]);
        s.put("a2.md", "h", &[6.0, 8.0, 0.0, 0.0]); // same direction, different magnitude
        let n = s.top_k("a.md", 5, -1.0);
        assert_eq!(n[0].rel_path, "a2.md");
        assert!((n[0].cos - 1.0).abs() < 1e-5); // identical direction → cos 1
    }

    #[test]
    fn put_same_path_updates_in_place_no_new_row() {
        let mut s = store();
        s.put("a.md", "h1", &[1.0, 0.0, 0.0, 0.0]);
        s.put("a.md", "h2", &[0.0, 1.0, 0.0, 0.0]);
        assert_eq!(s.live_len(), 1);
        assert_eq!(s.row_count, 1);
        assert!(s.needs("a.md", "h3"));
        assert!(!s.needs("a.md", "h2"));
    }

    #[test]
    fn remove_frees_slot_reused_by_next_put() {
        let mut s = store();
        s.put("a.md", "h", &[1.0, 0.0, 0.0, 0.0]);
        s.put("b.md", "h", &[0.0, 1.0, 0.0, 0.0]);
        s.remove("a.md");
        assert_eq!(s.free.len(), 1);
        assert_eq!(s.row_count, 2);
        s.put("c.md", "h", &[0.0, 0.0, 1.0, 0.0]);
        assert_eq!(s.free.len(), 0); // reused, not appended
        assert_eq!(s.row_count, 2);
        assert_eq!(s.live_len(), 2);
    }

    #[test]
    fn remap_preserves_vector() {
        let mut s = store();
        s.put("old.md", "h", &[1.0, 0.0, 0.0, 0.0]);
        s.put("other.md", "h", &[1.0, 0.0, 0.0, 0.0]);
        s.remap("old.md", "new.md");
        assert!(s.needs("old.md", "h"));
        assert!(!s.needs("new.md", "h"));
        let n = s.top_k("new.md", 5, -1.0);
        assert_eq!(n[0].rel_path, "other.md");
    }

    #[test]
    fn vectors_for_returns_stored_vectors_and_skips_missing() {
        let mut s = store();
        s.put("a.md", "h", &[1.0, 0.0, 0.0, 0.0]);
        s.put("b.md", "h", &[0.0, 1.0, 0.0, 0.0]);
        let rows = s.vectors_for(&["a.md".to_string(), "missing.md".to_string(), "b.md".to_string()]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].rel_path, "a.md");
        assert_eq!(rows[1].rel_path, "b.md");
        assert_eq!(rows[0].vector, vec![1.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn compact_threshold_and_renumber() {
        let mut s = store();
        for i in 0..4 {
            s.put(&format!("n{i}.md"), "h", &[1.0, 0.0, 0.0, 0.0]);
        }
        s.remove("n0.md"); // 1/4 free = not > 0.25
        assert!(!s.should_compact());
        s.remove("n1.md"); // 2/4 free > 0.25
        assert!(s.should_compact());
        s.compact();
        assert_eq!(s.free.len(), 0);
        assert_eq!(s.row_count, 2);
        assert_eq!(s.live_len(), 2);
        // rows renumbered 0..2 contiguously
        let mut nums: Vec<usize> = s.rows.iter().map(|r| r.row).collect();
        nums.sort();
        assert_eq!(nums, vec![0, 1]);
        // vectors still queryable after compaction
        let n = s.top_k("n2.md", 5, -1.0);
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].rel_path, "n3.md");
    }

    #[test]
    fn top_k_vector_queries_an_external_vector_and_includes_all_rows() {
        // S24 cross-vault: a note in vault A queries vault B's store; the query note is not in
        // this store, so NOTHING is excluded by relPath. A non-normalized query still works.
        let mut s = store();
        s.put("same.md", "h", &[1.0, 0.0, 0.0, 0.0]); // cos 1 with the query direction
        s.put("half.md", "h", &[1.0, 1.0, 0.0, 0.0]); // cos ~0.707
        s.put("orth.md", "h", &[0.0, 1.0, 0.0, 0.0]); // cos 0
        let n = s.top_k_vector(&[5.0, 0.0, 0.0, 0.0], 10, 0.6); // deliberately un-normalized
        assert_eq!(n.iter().map(|x| x.rel_path.as_str()).collect::<Vec<_>>(), vec!["same.md", "half.md"]);
        // Dimension mismatch → empty (safe).
        assert!(s.top_k_vector(&[1.0, 0.0], 10, -1.0).is_empty());
    }

    #[test]
    fn top_k_respects_min_cos_and_k_and_excludes_self() {
        let mut s = store();
        s.put("self.md", "h", &[1.0, 0.0, 0.0, 0.0]);
        s.put("same.md", "h", &[1.0, 0.0, 0.0, 0.0]); // cos 1
        s.put("half.md", "h", &[1.0, 1.0, 0.0, 0.0]); // cos ~0.707
        s.put("orth.md", "h", &[0.0, 1.0, 0.0, 0.0]); // cos 0
        let n = s.top_k("self.md", 10, 0.6);
        assert_eq!(n.iter().map(|x| x.rel_path.as_str()).collect::<Vec<_>>(), vec!["same.md", "half.md"]);
        let limited = s.top_k("self.md", 1, 0.6);
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].rel_path, "same.md");
    }

    #[test]
    fn from_files_rejects_bad_magic_and_dim_mismatch() {
        let mut s = store();
        s.put("a.md", "h", &[1.0, 0.0, 0.0, 0.0]);
        let mut bin = s.to_bin();
        let idx = s.to_idx();
        // corrupt magic
        bin[0] = b'X';
        assert!(EmbeddingStore::from_files(&bin, &idx).is_none());
        // dim disagreement between bin and idx
        let mut idx2 = s.to_idx();
        idx2.dim = 99;
        assert!(EmbeddingStore::from_files(&s.to_bin(), &idx2).is_none());
    }

    #[test]
    fn top_k_on_absent_query_is_empty() {
        let s = store();
        assert!(s.top_k("nope.md", 5, 0.0).is_empty());
    }
}

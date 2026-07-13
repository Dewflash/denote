// main.swift — the NDJSON request loop (S13). One JSON object per line on stdin; one response
// object per line on stdout; stderr is logs only. Requests `{id, method, params}`; responses
// `{id, result}` or `{id, error: {code, message}}`.
//
// Guided-generation outputs that fail validation get ONE repair retry (re-issue the same call);
// still failing → an error response, and the Rust supervisor parks the job (S13). The process
// runs until stdin closes (parent quit) — the Rust side also kills it on app exit (no orphans).

import Foundation

/// Serialize a JSON value to a single line and flush (NDJSON framing).
func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else {
        return
    }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func ok(_ id: Any, _ result: Any) {
    emit(["id": id, "result": result])
}

func fail(_ id: Any, _ code: String, _ message: String) {
    emit(["id": id, "error": ["code": code, "message": message]])
}

func log(_ s: String) {
    FileHandle.standardError.write(("[apple-ai-sidecar] " + s + "\n").data(using: .utf8)!)
}

/// Convert an untyped JSON note stub into the Sendable `NoteStub` (done on the main actor).
func noteStub(_ dict: [String: Any]?) -> NoteStub {
    NoteStub(title: dict?["title"] as? String ?? "", summary: dict?["summary"] as? String)
}

// Encode a Codable @Generable result back into a plain JSON dictionary for emit().
func jsonObject<T: Encodable>(_ value: T) -> Any {
    guard let data = try? JSONEncoder().encode(value),
          let obj = try? JSONSerialization.jsonObject(with: data) else {
        return [:]
    }
    return obj
}

/// Run a guided-generation call with ONE repair retry on failure (S13). `@MainActor` so the
/// captured request values never cross an isolation boundary (Swift 6 strict concurrency).
@MainActor
func withRepairRetry<T>(_ op: @escaping () async throws -> T) async throws -> T {
    do {
        return try await op()
    } catch {
        log("generation error, one repair retry: \(error)")
        return try await op()
    }
}

@MainActor
func handle(id: Any, method: String, params: [String: Any]) async {
    do {
        switch method {
        case "capabilities":
            let a = AppleModel.availability()
            ok(id, [
                "available": a.available,
                "reason": a.reason as Any,
                // Foundation Models context is small; report a conservative budget the caller
                // trims to (S16). Guided JSON is supported via @Generable.
                "maxInputTokens": 4000,
                "supportsGuidedJson": true,
                "modelVersion": AppleModel.modelVersion,
            ])

        case "summarize":
            let text = params["text"] as? String ?? ""
            let maxWords = params["maxWords"] as? Int ?? 40
            let summary = try await withRepairRetry { try await AppleModel.summarize(text: text, maxWords: maxWords) }
            ok(id, ["summary": summary])

        case "enrichNote":
            let text = params["text"] as? String ?? ""
            let title = params["title"] as? String ?? ""
            let folderPath = params["folderPath"] as? String ?? ""
            // Convert the untyped JSON into Sendable values HERE (main actor) so nothing
            // non-Sendable crosses into the nonisolated generation method.
            let existingTopics = (params["existingTopics"] as? [[String: Any]] ?? [])
                .compactMap { $0["name"] as? String }
            let candidateNotes = (params["candidateNotes"] as? [[String: Any]] ?? [])
                .compactMap { c -> NoteStub? in
                    guard let t = c["title"] as? String else { return nil }
                    return NoteStub(title: t, summary: c["summary"] as? String)
                }
            let result = try await withRepairRetry {
                try await AppleModel.enrich(
                    text: text, title: title, folderPath: folderPath,
                    existingTopics: existingTopics, candidateNotes: candidateNotes
                )
            }
            ok(id, jsonObject(result))

        case "labelSimilarity":
            let a = noteStub(params["a"] as? [String: Any])
            let b = noteStub(params["b"] as? [String: Any])
            let result = try await withRepairRetry { try await AppleModel.labelSimilarity(a: a, b: b) }
            ok(id, jsonObject(result))

        default:
            fail(id, "unknown-method", "no such method: \(method)")
        }
    } catch let ModelError.unavailable(reason) {
        fail(id, "ai-unavailable", reason)
    } catch {
        let detail = String(describing: error)
        if detail.contains("ModelManagerError Code=1008") {
            let reason = "Apple Foundation Models could not start (Model Manager error 1008). Check that Apple Intelligence is enabled and the on-device model has finished downloading."
            AppleModel.markRuntimeUnavailable(reason)
            fail(id, "ai-unavailable", reason)
        } else {
            fail(id, "ai-invalid-output", detail)
        }
    }
}

// ── read loop ─────────────────────────────────────────────────────────────────────

// Requests are processed one at a time (the Rust supervisor sends serially), so a simple
// blocking line read + a per-line async task awaited to completion keeps ordering correct.
while let line = readLine(strippingNewline: true) {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { continue }
    guard let data = trimmed.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        log("dropping malformed request line")
        continue
    }
    let id = obj["id"] ?? NSNull()
    guard let method = obj["method"] as? String else {
        fail(id, "bad-request", "missing method")
        continue
    }
    let params = obj["params"] as? [String: Any] ?? [:]

    // Top-level code is an async main-actor context: awaiting the @MainActor handler directly
    // (rather than a detached Task) processes requests in order and avoids sending non-Sendable
    // `[String: Any]` across an isolation boundary.
    await handle(id: id, method: method, params: params)
}

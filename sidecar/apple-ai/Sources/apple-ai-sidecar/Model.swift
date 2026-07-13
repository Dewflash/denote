// Model.swift — the Foundation Models wrapper. All on-device; nothing leaves the machine.
//
// Guided/structured generation (S13): outputs are @Generable structs, so the framework
// constrains the model to the schema instead of us parsing free-form text. On a generation error
// the caller (main.swift) does ONE repair retry, then reports an error and the Rust supervisor
// parks the job.
//
// Token budgeting (S16) is done by the CALLER (TS, testable) before the text reaches here — this
// wrapper trusts that `text` already fits the model's context.

import Foundation
import FoundationModels

// ── structured output schemas (mirror EnrichResult / labelSimilarity in aiClient/types.ts) ──

@Generable
struct GenTag: Codable {
    @Guide(description: "A short lowercase tag (a-z, digits, hyphens), no leading #.")
    var name: String
    @Guide(description: "One specific sentence on why this tag fits, referencing the note's content.")
    var reason: String
    @Guide(description: "Confidence from 0 to 1.")
    var confidence: Double
}

@Generable
struct GenTopic: Codable {
    @Guide(description: "A canonical topic name. Prefer an existing topic name when one clearly applies.")
    var name: String
    @Guide(description: "One specific sentence justifying the topic, referencing the note's substance.")
    var reason: String
    @Guide(description: "Confidence from 0 to 1.")
    var confidence: Double
    @Guide(description: "The broader PARENT topic this belongs under (e.g. Banking under Finance), or empty string if none.")
    var parentName: String
    @Guide(description: "0-2 closely RELATED topic names (siblings), or empty.")
    var relatedNames: [String]
}

@Generable
struct GenLink: Codable {
    @Guide(description: "The exact title of a candidate note this note should link to.")
    var target: String
    @Guide(description: "One sentence naming the SPECIFIC shared concept — not generic overlap.")
    var reason: String
    @Guide(description: "Confidence from 0 to 1.")
    var confidence: Double
}

@Generable
struct GenEnrich: Codable {
    @Guide(description: "0-4 topics this note belongs to.")
    var topics: [GenTopic]
    @Guide(description: "0-3 links to the provided candidate notes, only when a concrete shared concept exists.")
    var links: [GenLink]
    @Guide(description: "1-5 tags describing the note's subject matter.")
    var tags: [GenTag]
    @Guide(description: "A one-sentence summary of the note.")
    var summary: String
}

@Generable
struct GenSimilarity: Codable {
    @Guide(description: "True only if the two notes share a specific concept in substance, not generic overlap.")
    var related: Bool
    @Guide(description: "One sentence naming the specific shared concept. Empty if not related.")
    var reason: String
    @Guide(description: "Confidence from 0 to 1.")
    var confidence: Double
}

// ── the wrapper ──────────────────────────────────────────────────────────────────

enum ModelError: Error {
    case unavailable(String)
}

/// A candidate/neighbor note as passed to the model — Sendable so it can cross from the main-actor
/// request handler into the nonisolated generation methods without a data-race diagnostic.
struct NoteStub: Sendable {
    let title: String
    let summary: String?
}

@MainActor
struct AppleModel {
    /// The exact model version string stamped into annotations (D26 hash-gating key). Foundation
    /// Models doesn't expose a fine-grained version, so we key on the OS-level model generation.
    static let modelVersion = "apple-fm@1"
    private static var runtimeUnavailableReason: String?

    static func availability() -> (available: Bool, reason: String?) {
        if let reason = runtimeUnavailableReason {
            return (false, reason)
        }
        switch SystemLanguageModel.default.availability {
        case .available:
            return (true, nil)
        case .unavailable(let reason):
            return (false, String(describing: reason))
        @unknown default:
            return (false, "unknown availability")
        }
    }

    static func markRuntimeUnavailable(_ reason: String) {
        runtimeUnavailableReason = reason
    }

    static func ensureAvailable() throws {
        let a = availability()
        if !a.available { throw ModelError.unavailable(a.reason ?? "model unavailable") }
    }

    static func summarize(text: String, maxWords: Int) async throws -> String {
        try ensureAvailable()
        let session = LanguageModelSession(
            instructions: "You summarize notes tightly. Answer with the summary only, no preamble."
        )
        let prompt = "Summarize the following note in at most \(maxWords) words:\n\n\(text)"
        let response = try await session.respond(to: prompt)
        return response.content.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func enrich(
        text: String,
        title: String,
        folderPath: String,
        existingTopics: [String],
        candidateNotes: [NoteStub]
    ) async throws -> GenEnrich {
        try ensureAvailable()

        let topicList = existingTopics
        let candidateList = candidateNotes.map { c -> String in
            c.summary == nil ? "- \(c.title)" : "- \(c.title): \(c.summary!)"
        }

        var prompt = """
        Note title: \(title)
        Folder: \(folderPath)

        Note body:
        \(text)

        """
        if !topicList.isEmpty {
            prompt += "\nExisting topics you should reuse when they apply (do not invent near-duplicates): "
                + topicList.joined(separator: ", ") + "\n"
        }
        if !candidateList.isEmpty {
            prompt += "\nCandidate notes to possibly link (only link on a specific shared concept):\n"
                + candidateList.joined(separator: "\n") + "\n"
        }
        prompt += "\nProduce topics, links, tags, and a one-sentence summary. Every item needs a specific reason."

        let session = LanguageModelSession(
            instructions: """
            You organize personal Markdown notes. Be precise and specific. Never propose a link or \
            topic on generic overlap (same language, both are notes); only on a concrete shared concept.
            """
        )
        let response = try await session.respond(to: prompt, generating: GenEnrich.self)
        return response.content
    }

    static func labelSimilarity(a: NoteStub, b: NoteStub) async throws -> GenSimilarity {
        try ensureAvailable()
        let aStr = noteStubString(a)
        let bStr = noteStubString(b)
        let session = LanguageModelSession(
            instructions: """
            You judge whether two notes are meaningfully related. Relatedness requires a specific \
            shared concept in substance — never generic overlap. If unsure, answer not related.
            """
        )
        let prompt = "Note A:\n\(aStr)\n\nNote B:\n\(bStr)\n\nAre they related? Name the specific shared concept."
        let response = try await session.respond(to: prompt, generating: GenSimilarity.self)
        return response.content
    }

    private static func noteStubString(_ n: NoteStub) -> String {
        let summary = n.summary ?? ""
        return summary.isEmpty ? n.title : "\(n.title): \(summary)"
    }
}

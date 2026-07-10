// swift-tools-version: 6.0
// sidecar/apple-ai — the Apple Foundation Models sidecar (D11/S13). A tiny executable that speaks
// NDJSON on stdio (one JSON object per line) and answers capabilities / summarize / enrichNote /
// labelSimilarity using the on-device system language model. Apple Silicon + macOS 26 only —
// matches the app's hardware/OS floor. Built via `swift build -c release`; the Rust core
// (src-tauri/src/sidecar.rs) spawns and supervises the product binary `apple-ai-sidecar`.
import PackageDescription

let package = Package(
    name: "apple-ai-sidecar",
    platforms: [.macOS("26.0")],
    targets: [
        .executableTarget(
            name: "apple-ai-sidecar",
            path: "Sources/apple-ai-sidecar"
        )
    ]
)

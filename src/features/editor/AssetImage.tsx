// src/features/editor/AssetImage.tsx — read-only image embed for the reading view (S26).
// Loads asset bytes lazily via services/assets.ts (Tauri `read_asset`, S22-contained).

import { useEffect, useState } from 'react';
import { loadAssetObjectUrl } from '../../services/assets';

export function AssetImage({ root, relPath, alt }: { root: string; relPath: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAssetObjectUrl(root, relPath).then(
      (url) => {
        if (!cancelled) setSrc(url);
      },
      () => {
        /* leave src null; render a muted placeholder below */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [root, relPath]);

  if (!src) {
    return <span className="cm-denote-embed-missing">loading {alt}…</span>;
  }
  return <img src={src} alt={alt} className="cm-denote-embed" />;
}

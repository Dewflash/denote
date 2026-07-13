// src/features/explorer/tree.ts — pure helper turning a flat relPath list into a nested tree
// for the collapsible file tree. Folders sort before files; both sort alphabetically.

export interface TreeNode {
  name: string;
  path: string; // relPath (files) or folder path (folders)
  kind: 'folder' | 'note' | 'asset';
  children?: TreeNode[];
}

export function buildTree(entries: { relPath: string; kind: 'note' | 'asset' }[], extraFolders: string[] = []): TreeNode[] {
  const root: TreeNode[] = [];
  const folders = new Map<string, TreeNode>();

  const ensureFolder = (folderPath: string): TreeNode => {
    const segs = folderPath.split('/').filter(Boolean);
    let siblings = root;
    let curPath = '';
    let folder: TreeNode | undefined;
    for (const segment of segs) {
      curPath = curPath ? `${curPath}/${segment}` : segment;
      folder = folders.get(curPath);
      if (!folder) {
        folder = { name: segment, path: curPath, kind: 'folder', children: [] };
        folders.set(curPath, folder);
        siblings.push(folder);
      }
      siblings = folder.children!;
    }
    return folder!;
  };

  for (const folderPath of extraFolders) ensureFolder(folderPath);

  for (const { relPath, kind } of entries) {
    const segs = relPath.split('/');
    let siblings = root;
    let curPath = '';
    for (let i = 0; i < segs.length - 1; i++) {
      curPath = curPath ? `${curPath}/${segs[i]}` : segs[i];
      const folder = folders.get(curPath) ?? ensureFolder(curPath);
      siblings = folder.children!;
    }
    siblings.push({ name: segs[segs.length - 1], path: relPath, kind });
  }

  const sortRec = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => {
      if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.children) sortRec(n.children);
  };
  sortRec(root);
  return root;
}

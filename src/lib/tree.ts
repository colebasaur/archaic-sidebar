import type { Entry, Folder, PinnedNode } from './types';

export function walkEntries(nodes: PinnedNode[]): Entry[] {
  return nodes.flatMap((n) => (n.kind === 'entry' ? [n] : walkEntries(n.children)));
}

/** Folders enclosing `id`, outermost first; empty if it's at the root or missing. */
export function ancestorFolders(nodes: PinnedNode[], id: string): Folder[] {
  for (const n of nodes) {
    if (n.kind !== 'folder') continue;
    if (n.children.some((c) => c.id === id)) return [n];
    const deeper = ancestorFolders(n.children, id);
    if (deeper.length) return [n, ...deeper];
  }
  return [];
}

export function findNode(nodes: PinnedNode[], id: string): PinnedNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.kind === 'folder') {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Removes the node in place and returns it. */
export function removeNode(nodes: PinnedNode[], id: string): PinnedNode | undefined {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx >= 0) return nodes.splice(idx, 1)[0];
  for (const n of nodes) {
    if (n.kind === 'folder') {
      const removed = removeNode(n.children, id);
      if (removed) return removed;
    }
  }
  return undefined;
}

export function containsNode(node: PinnedNode, id: string): boolean {
  if (node.id === id) return true;
  return node.kind === 'folder' && node.children.some((c) => containsNode(c, id));
}

/** Inserts into `parentId`'s children (root when undefined), before `beforeId` or at the end. */
export function insertNode(
  nodes: PinnedNode[],
  node: PinnedNode,
  parentId?: string,
  beforeId?: string,
): void {
  let list = nodes;
  if (parentId) {
    const parent = findNode(nodes, parentId);
    if (parent?.kind === 'folder') list = parent.children;
  }
  const idx = beforeId ? list.findIndex((n) => n.id === beforeId) : -1;
  if (idx >= 0) list.splice(idx, 0, node);
  else list.push(node);
}

export function isFolder(node: PinnedNode | undefined): node is Folder {
  return node?.kind === 'folder';
}

export interface TreeNode {
  id: string;
  name: string;
  children?: TreeNode[];
}

export function buildFileTree(paths: string[]): TreeNode[] {
  const root: Map<string, TreeNode> = new Map();

  for (const path of paths) {
    const parts = path.split('/');
    let currentLevel = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1;

      if (!currentLevel.has(part)) {
        const node: TreeNode = { id: currentPath, name: part };
        if (!isFile) {
          node.children = [];
        }
        currentLevel.set(part, node);
      }

      const node = currentLevel.get(part)!;
      if (!isFile) {
        if (!node.children) node.children = [];
        // Use children map for next level - we'll convert at the end
        const childMap = new Map<string, TreeNode>();
        for (const child of node.children) {
          childMap.set(child.name, child);
        }
        // Process next level against existing children
        const nextPart = parts[i + 1];
        if (!childMap.has(nextPart)) {
          const isNextFile = i + 1 === parts.length - 1;
          const nextPath = `${currentPath}/${nextPart}`;
          const nextNode: TreeNode = { id: nextPath, name: nextPart };
          if (!isNextFile) nextNode.children = [];
          node.children.push(nextNode);
          childMap.set(nextPart, nextNode);
        }
        // Advance into the child for next iteration
        const childNode = childMap.get(nextPart)!;
        const nextChildLevel = new Map<string, TreeNode>();
        if (childNode.children) {
          for (const c of childNode.children) nextChildLevel.set(c.name, c);
        }
        // Skip ahead - we already handled the insertion
        // Break the loop pattern and use a simpler approach
      }
    }
  }

  // Simpler approach: build from scratch
  return buildTree(paths);
}

function buildTree(paths: string[]): TreeNode[] {
  const rootChildren: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  for (const path of paths) {
    const parts = path.split('/');
    let parentChildren = rootChildren;

    for (let i = 0; i < parts.length; i++) {
      const dirPath = parts.slice(0, i + 1).join('/');
      const isFile = i === parts.length - 1;

      if (isFile) {
        if (!parentChildren.find(n => n.id === dirPath)) {
          parentChildren.push({ id: dirPath, name: parts[i] });
        }
      } else {
        let dirNode = dirMap.get(dirPath);
        if (!dirNode) {
          dirNode = { id: dirPath, name: parts[i], children: [] };
          dirMap.set(dirPath, dirNode);
          parentChildren.push(dirNode);
        }
        parentChildren = dirNode.children!;
      }
    }
  }

  sortTree(rootChildren);
  return rootChildren;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    const aIsDir = !!a.children;
    const bIsDir = !!b.children;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}

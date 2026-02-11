const iconMap: Record<string, string> = {
  js: '📄',
  jsx: '⚛️',
  ts: '📘',
  tsx: '⚛️',
  json: '📋',
  md: '📝',
  css: '🎨',
  scss: '🎨',
  html: '🌐',
  py: '🐍',
  rb: '💎',
  go: '🔵',
  rs: '🦀',
  java: '☕',
  sh: '🔧',
  bash: '🔧',
  yml: '⚙️',
  yaml: '⚙️',
  toml: '⚙️',
  env: '🔒',
  sql: '🗄️',
  graphql: '◼️',
  svg: '🖼️',
  png: '🖼️',
  jpg: '🖼️',
  gif: '🖼️',
  lock: '🔒',
  dockerfile: '🐳',
  makefile: '🔧',
};

export function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const basename = filename.split('/').pop()?.toLowerCase() ?? '';

  if (basename === 'dockerfile') return '🐳';
  if (basename === 'makefile') return '🔧';
  if (basename === '.gitignore') return '🙈';
  if (basename === 'readme.md') return '📖';

  return iconMap[ext] || '📄';
}

const languageColors: Record<string, string> = {
  JavaScript: 'bg-yellow-500/20 text-yellow-400',
  TypeScript: 'bg-blue-500/20 text-blue-400',
  Python: 'bg-green-500/20 text-green-400',
  Go: 'bg-cyan-500/20 text-cyan-400',
  Rust: 'bg-orange-500/20 text-orange-400',
  Java: 'bg-red-500/20 text-red-400',
  Ruby: 'bg-red-500/20 text-red-400',
  C: 'bg-gray-500/20 text-gray-400',
  'C++': 'bg-blue-500/20 text-blue-400',
  'C#': 'bg-purple-500/20 text-purple-400',
  PHP: 'bg-indigo-500/20 text-indigo-400',
  Swift: 'bg-orange-500/20 text-orange-400',
  Shell: 'bg-green-500/20 text-green-400',
  HTML: 'bg-orange-500/20 text-orange-400',
  CSS: 'bg-blue-500/20 text-blue-400',
};

export function getLanguageBadgeColor(language: string): string {
  return languageColors[language] || 'bg-gray-500/20 text-gray-400';
}

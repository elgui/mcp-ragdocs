import path from 'path';

// Map of file extensions to language names
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // JavaScript and TypeScript
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  
  // Web
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  
  // Python
  '.py': 'python',
  '.ipynb': 'jupyter',
  
  // Java and JVM languages
  '.java': 'java',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.groovy': 'groovy',
  
  // C-family
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  
  // Ruby
  '.rb': 'ruby',
  '.erb': 'ruby',
  
  // PHP
  '.php': 'php',
  
  // Go
  '.go': 'go',
  
  // Rust
  '.rs': 'rust',
  
  // Swift
  '.swift': 'swift',
  
  // Shell
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  
  // Data formats
  '.json': 'json',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  
  // Documentation
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.rst': 'restructuredtext',
  '.txt': 'text',
  
  // Configuration
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.properties': 'properties',
  
  // Other
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.proto': 'protobuf',
  '.dockerfile': 'dockerfile',
  '.Dockerfile': 'dockerfile',
};

// Shebang patterns for script files
const SHEBANG_PATTERNS: Array<[RegExp, string]> = [
  [/^#!.*\bpython\b/, 'python'],
  [/^#!.*\bnode\b/, 'javascript'],
  [/^#!.*\bbash\b/, 'bash'],
  [/^#!.*\bsh\b/, 'bash'],
  [/^#!.*\bruby\b/, 'ruby'],
  [/^#!.*\bperl\b/, 'perl'],
  [/^#!.*\bphp\b/, 'php'],
];

/**
 * Detect the programming language of a file based on its extension and content
 * 
 * @param filePath The path to the file
 * @param content The content of the file
 * @returns The detected language or 'unknown'
 */
export function detectLanguage(filePath: string, content: string): string {
  const extension = path.extname(filePath).toLowerCase();
  
  // Check if we have a direct mapping for this extension
  if (extension in EXTENSION_TO_LANGUAGE) {
    return EXTENSION_TO_LANGUAGE[extension];
  }
  
  // Special case for Dockerfiles
  if (path.basename(filePath) === 'Dockerfile') {
    return 'dockerfile';
  }
  
  // Check for shebang in the first line for script files
  const firstLine = content.split('\n')[0];
  for (const [pattern, language] of SHEBANG_PATTERNS) {
    if (pattern.test(firstLine)) {
      return language;
    }
  }
  
  // Default to 'unknown' if we couldn't determine the language
  return 'unknown';
}

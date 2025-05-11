export interface DocumentChunk {
  text: string;
  url: string;
  title: string;
  timestamp: string;
  filePath?: string;
  language?: string;
  chunkIndex?: number;
  totalChunks?: number;
  repository?: string;
  isRepositoryFile?: boolean;
}

export interface DocumentPayload extends DocumentChunk {
  _type: 'DocumentChunk';
  [key: string]: unknown;
}

export function isDocumentPayload(payload: unknown): payload is DocumentPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Partial<DocumentPayload>;
  return (
    p._type === 'DocumentChunk' &&
    typeof p.text === 'string' &&
    typeof p.url === 'string' &&
    typeof p.title === 'string' &&
    typeof p.timestamp === 'string'
  );
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

export interface McpToolResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

export interface RepositoryConfig {
  path: string;                // Absolute path to repository
  name: string;                // User-friendly name
  include: string[];           // Glob patterns to include
  exclude: string[];           // Glob patterns to exclude
  watchMode: boolean;          // Whether to watch for changes
  watchInterval: number;       // Polling interval in ms
  chunkSize: number;           // Default chunk size for files
  fileTypeConfig: {            // Per file type configuration
    [extension: string]: {
      include: boolean;
      chunkSize?: number;
      chunkStrategy?: 'line' | 'character' | 'semantic';
    }
  }
}

export interface IndexingStatus {
  repositoryName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  startTime: string;
  endTime?: string;
  totalFiles?: number;
  processedFiles?: number;
  skippedFiles?: number;
  totalChunks?: number;
  indexedChunks?: number;
  currentBatch?: number;
  totalBatches?: number;
  percentageComplete?: number;
  error?: string;
  lastUpdated: string;
}
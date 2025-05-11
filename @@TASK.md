# Local Repository Indexing Implementation Plan

## Overview
Implement a new feature to index local repositories in the RAG documentation system, allowing users to add local code repositories to the knowledge base with configurable options for path filtering and change detection.

## Tasks

### 1. Core Implementation
- [x] Create a new `LocalRepositoryHandler` class
  - [x] Implement file traversal with configurable filters
  - [x] Add support for parsing different file types
  - [x] Implement chunking strategy for code files
  - [x] Add metadata extraction (file path, language, etc.)
  - [x] Implement embedding generation and storage

- [x] Create a new `LocalRepositoryWatcher` class
  - [x] Implement file system watching for changes
  - [x] Add support for detecting file additions, modifications, and deletions
  - [x] Implement incremental updates to the vector database

- [x] Update the `handler-registry.ts` file
  - [x] Register the new handler
  - [x] Add tool definition with input schema

### 2. Configuration Management
- [x] Implement configuration schema for repository indexing
  - [x] Repository path specification
  - [x] Include/exclude patterns for files and directories
  - [x] File type/extension filtering
  - [x] Chunking strategy configuration
  - [x] Watch mode configuration

- [x] Create a configuration storage mechanism
  - [x] Implement saving/loading of repository configurations
  - [x] Add support for multiple repository configurations

### 3. Database Integration
- [x] Extend the `DocumentChunk` interface for repository documents
  - [x] Add repository-specific metadata fields
  - [x] Implement source tracking for repository files

- [x] Update the vector database schema
  - [x] Add repository-specific fields
  - [x] Implement efficient querying for repository documents

- [x] Implement change tracking mechanism
  - [x] Store file hashes or timestamps
  - [x] Support for detecting and updating changed files

### 4. User Interface and Tools
- [x] Implement new tools for repository management
  - [x] `add_repository` - Add a new repository to the index
  - [x] `update_repository` - Update an existing repository index
  - [x] `list_repositories` - List all indexed repositories
  - [x] `remove_repository` - Remove a repository from the index
  - [x] `watch_repository` - Start/stop watching a repository for changes

- [x] Update existing tools to work with repository documents
  - [x] Update `search_documentation` to include repository results
  - [x] Update `list_sources` to show repository information

### 5. Documentation and Testing
- [x] Update README.md with repository indexing documentation
  - [x] Add usage examples
  - [x] Document configuration options
  - [x] Provide best practices

- [ ] Create test cases for repository indexing
  - [ ] Test with different repository types
  - [ ] Test with various file types
  - [ ] Test change detection

## Current Progress

We have successfully implemented the core functionality for local repository indexing, including:

1. Repository handlers for adding, updating, listing, and removing repositories
2. File system watching for automatic updates
3. Configuration storage and management
4. Integration with the existing search functionality
5. Documentation updates

## Next Steps

### 1. JSON Configuration File Support
- [x] Create a `repositories.json` configuration file
  - [x] Define schema for multiple repository configurations
  - [x] Implement loading repositories from config at startup
  - [x] Add support for updating config file when repositories change

### 2. Enhanced File Processing
- [ ] Improve language detection for better code chunking
- [ ] Add support for more file types and languages
- [ ] Implement more sophisticated chunking strategies

### 3. Testing and Validation
- [ ] Create comprehensive test cases
- [ ] Test with various repository types and structures
- [ ] Validate search results quality

### 4. Performance Optimization
- [ ] Optimize file traversal for large repositories
- [ ] Implement batch processing for better performance
- [ ] Add caching mechanisms for frequently accessed files

## Implementation Details

### File Processing Strategy
1. Traverse repository recursively
2. Filter files based on include/exclude patterns
3. Process each file based on its type:
   - Code files: Parse with language-specific tokenization
   - Markdown/Text: Process as documentation
   - Binary files: Skip or extract metadata only
4. Chunk content appropriately for each file type
5. Generate embeddings for each chunk
6. Store in vector database with metadata

### Change Detection Strategy
1. Store file hashes or modification timestamps
2. On update, compare current state with stored state
3. Process only changed files
4. Remove entries for deleted files
5. Add entries for new files
6. Update entries for modified files

### Configuration Schema
```typescript
interface RepositoryConfig {
  path: string;                // Absolute path to repository
  name: string;                // User-friendly name
  include: string[];           // Glob patterns to include
  exclude: string[];           // Glob patterns to exclude
  watchMode: boolean;          // Whether to watch for changes
  watchInterval: number;       // Polling interval in ms (if not using fs events)
  chunkSize: number;           // Default chunk size for files
  fileTypeConfig: {            // Per file type configuration
    [extension: string]: {
      include: boolean;
      chunkSize?: number;
      chunkStrategy?: 'line' | 'character' | 'semantic';
    }
  }
}
```

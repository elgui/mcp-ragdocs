# MCP RAG Docs Tasks

## Pending Tasks

### Architecture Consolidation
- [X] **Create Base Infrastructure for Consolidated Architecture**
    - [X] Create enhanced base tool class (`src/tools/enhanced-base-tool.ts`)
    - [X] Create tool handler adapter (`src/adapters/tool-handler-adapter.ts`)
    - [X] Create tool factory (`src/adapters/tool-factory.ts`)
    - [X] Create enhanced handler registry (`src/handler-registry-enhanced.ts`)
    - [X] Create enhanced server (`src/index-enhanced.ts`)
    - [X] Create documentation (`ARCHITECTURE.md`, `MIGRATION_GUIDE.md`)
- [X] **Migrate Initial Tools**
    - [X] Migrate SearchDocumentation (`src/tools/search-documentation-enhanced.ts`)
    - [X] Migrate ExtractUrls (`src/tools/extract-urls-enhanced.ts`)
    - [X] Migrate ListSources (`src/tools/list-sources-enhanced.ts`)
    - [X] Migrate ClearQueue (`src/tools/clear-queue-enhanced.ts`)
- [X] **Migrate Remaining Tools**
    - [X] Migrate RunQueue (`src/tools/run-queue-enhanced.ts`)
    - [X] Migrate RemoveDocumentation (`src/tools/remove-documentation-enhanced.ts`)
    - [X] Migrate ListQueue (`src/tools/list-queue-enhanced.ts`)
    - [X] Migrate AddDocumentation (`src/tools/add-documentation-enhanced.ts`)
    - [X] Migrate LocalRepository (`src/tools/local-repository-enhanced.ts`)
    - [X] Migrate ListRepositories (`src/tools/list-repositories-enhanced.ts`)
    - [X] Migrate RemoveRepository (`src/tools/remove-repository-enhanced.ts`)
    - [X] Migrate UpdateRepository (`src/tools/update-repository-enhanced.ts`)
    - [X] Migrate WatchRepository (`src/tools/watch-repository-enhanced.ts`)
    - [X] Migrate GetIndexingStatus (`src/tools/get-indexing-status-enhanced.ts`)
- [ ] **Update Web Interface**
    - [X] Create enhanced web interface that uses tools directly (`src/server-enhanced.ts`)
    - [X] Update routes to use enhanced tools
    - [X] Add tests for enhanced web interface
- [ ] **Complete Migration**
- [X] Remove duplicate code in handlers and tools
    - [X] Update main server to use enhanced architecture by default
    - [X] Update documentation to reflect new architecture
    - [X] Add tests for all enhanced tools
        - [X] `AddDocumentationEnhancedTool`
        - [X] `ClearQueueEnhancedTool`
        - [X] `ExtractUrlsEnhancedTool`
        - [X] `GetIndexingStatusEnhancedTool`
        - [X] `ListQueueEnhancedTool`
        - [X] `ListRepositoriesEnhancedTool`
        - [X] `ListSourcesEnhancedTool`
        - [X] `LocalRepositoryEnhancedTool`
        - [X] `RemoveDocumentationEnhancedTool`
        - [X] `RemoveRepositoryEnhancedTool`
        - [X] `RunQueueEnhancedTool`
        - [X] `SearchDocumentationEnhancedTool` (add more comprehensive tests)
            - [X] Test handling of unexpected search result structures (e.g., null, undefined, missing properties)
            - [ ] ~~Test response format when `generateFileDescriptions` is true with actual file descriptions~~ (Functionality not present in enhanced tool)
        - [ ] `UpdateRepositoryEnhancedTool`
            - [X] Test successful repository update (changes detected and re-indexed)
            - [X] **Troubleshoot and Resolve Crypto Mock TypeScript Errors in `test/update-repository-enhanced.test.ts`**
                - [X] Simplify `crypto.createHash().digest()` mock in `jest.doMock('crypto', ...)` to isolate the `Type 'string' is not assignable to type 'string[]'` error.
                - [X] Verify type expectations for `fileId` and `contentHash` in `src/tools/update-repository-enhanced.ts` and relevant type definitions in `src/types.ts`.
                - [X] Adjust the `jest.doMock('crypto', ...)` implementation, particularly the `digest` method's mock, to ensure it correctly types as returning a `string` and satisfies the TypeScript compiler.
                - [X] Confirm the `test successful repository update...` test case passes without TypeScript errors and then re-mark it as complete.
            - [X] Test repository update with no changes (implemented as "empty repositories" test)
            - [X] Test handling of non-existent repository name
            - [X] Test error handling during file operations (stat, readFile)
            - [X] Test error handling during Qdrant operations (upsert, delete)
            - [X] Test interaction with `FileMetadataManager` for updates
            - [ ] Test interaction with `IndexingStatusManager`
            - [X] Test handling of different chunking strategies
            - [X] Test handling of files with special characters in paths
            - [X] Test updating repository configuration parameters
        - [ ] `WatchRepositoryEnhancedTool`
            - [ ] Test initial scan and indexing on watch start
            - [ ] Test detection of new file creation and subsequent indexing
            - [ ] Test detection of file modification and subsequent re-indexing
            - [ ] Test detection of file deletion and subsequent removal from index/metadata
            - [ ] Test handling of errors during watch operations
            - [ ] Test correct use of watch interval
            - [ ] Test stopping the watcher
            - [ ] Test interaction with `IndexingStatusManager` for watched repositories

### Repository Indexing Enhancements
- [X] **Implement Persistent Indexing State and Incremental Updates** (Partial: Sub-Task 1 mostly done, Sub-Task 2 & 3 pending)
    - [X] **Sub-Task 1: Design and Implement Persistent Indexing State**
        - [X] Define metadata structure for indexed files (e.g., `filePath`, `lastModifiedTimestamp`, `contentHash`, and potentially a unique `fileId` for Qdrant filtering). (Implemented `FileIndexMetadata` in `src/types.ts`)
        - [X] Choose and implement a metadata storage mechanism (e.g., a local JSON file like `index_metadata.json` or a lightweight DB like SQLite). (Implemented `FileMetadataManager` in `src/utils/file-metadata-manager.ts` using `metadata/index_metadata.json`)
        - [X] Modify the core indexing logic:
            - [X] On processing a file, calculate its `contentHash` and get `lastModifiedTimestamp`. (Implemented in `src/handlers/local-repository.ts`)
            - [X] Before indexing:
                - [X] Check against stored metadata. (Implemented in `src/handlers/local-repository.ts`)
                - [X] If metadata exists and `contentHash` + `lastModifiedTimestamp` match, skip indexing. (Implemented in `src/handlers/local-repository.ts`)
                - [X] If metadata exists but details differ, mark for update (delete old, add new). (Partially implemented in `src/handlers/local-repository.ts`, deletion part is TODO for Sub-Task 2)
                - [X] If no metadata, mark as new file. (Implemented in `src/handlers/local-repository.ts`)
            - [X] After indexing a new or updated file, save/update its metadata. (Implemented in `src/handlers/local-repository.ts`)
        - [ ] On server startup or when a repository is loaded/re-scanned:
            - Load existing metadata.
            - Traverse repository files, comparing against metadata to identify new, modified, or (implicitly) deleted files.
    - [ ] **Sub-Task 2: Implement Efficient Deletion and Re-indexing in Qdrant**
        - [ ] Ensure Qdrant points (vectors) store a filterable `fileId` or `filePath` in their payload.
        - [ ] Implement a function to delete all Qdrant points associated with a specific `fileId` or `filePath`.
            - This will be used when a file is modified (delete old before adding new) or deleted.
        - [ ] Integrate this deletion logic into the main indexing flow:
            - When a file is identified as modified, call the deletion function before re-indexing its new content.
            - When a file is identified as deleted from the source (during a re-scan), call the deletion function and remove its entry from the metadata store.
    - [ ] **Sub-Task 3: Handle Server/Client Restarts Gracefully**
        - [ ] Ensure metadata is loaded on startup.
        - [ ] Ensure the indexing process correctly uses this loaded metadata to avoid re-indexing unchanged files.
- [ ] Add support for custom chunking strategies
- [ ] Improve language detection for better code chunking
- [ ] Add support for binary file indexing (e.g., PDFs)

### Web Interface Improvements
- [ ] Add repository management to web interface
- [ ] Implement real-time indexing status display
- [ ] Add search interface for testing queries
- [ ] Create dashboard for system monitoring

### Documentation
- [ ] Create comprehensive API documentation
- [ ] Add examples for all tools
- [ ] Create user guide with common workflows
- [ ] Add developer documentation for extending the system

### Testing
- [ ] **Comprehensive Test Suite Implementation**
  - [ ] **Unit Tests for Enhanced Tools**
    - [X] UpdateRepositoryEnhancedTool
      - [X] Basic functionality tests
      - [X] Error handling tests
      - [X] Edge case tests
    - [ ] WatchRepositoryEnhancedTool
      - [ ] Test watch initialization
      - [ ] Test file change detection
      - [ ] Test watch stopping
    - [ ] LocalRepositoryEnhancedTool
      - [ ] Test repository scanning
      - [ ] Test file content hashing
      - [ ] Test metadata tracking
    - [ ] SearchDocumentationEnhancedTool (expand existing tests)
      - [ ] Test with various query types
      - [ ] Test with different result formats

  - [ ] **Integration Tests**
    - [ ] Repository Management Flow
      - [ ] Test add → update → search → remove repository workflow
      - [ ] Test watch → change files → verify indexing workflow
    - [ ] Documentation Management Flow
      - [ ] Test add → list → search → remove documentation workflow
      - [ ] Test queue management workflow

  - [ ] **End-to-End Tests**
    - [ ] Web Interface Tests
      - [ ] Test repository management through web interface
      - [ ] Test documentation search through web interface
    - [ ] API Integration Tests
      - [ ] Test tool usage through MCP server API
      - [ ] Test error handling and response formatting

  - [ ] **Architecture Compliance Tests**
    - [ ] Verify all tools extend EnhancedBaseTool
    - [ ] Verify tools implement required methods
    - [ ] Verify adapter pattern works correctly

  - [ ] **Migration Validation Tests**
    - [ ] Compare results from old and new implementations
    - [ ] Verify no regressions in functionality
    - [ ] Verify performance is maintained or improved

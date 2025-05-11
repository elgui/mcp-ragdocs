# MCP RAG Docs Tasks

## Pending Tasks

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

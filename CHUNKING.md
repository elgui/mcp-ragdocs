# Chunking Strategy

This document outlines the strategies used for chunking files within the documentation indexing process. Chunking is essential to break down large files into smaller, manageable pieces that can be effectively processed and embedded while staying within token limits of language models.

## Core Principles

- **Token Limits:** Content is chunked to ensure individual chunks do not exceed predefined token limits, facilitating efficient processing by embedding models.
- **Context Preservation:** Chunking aims to preserve meaningful context within each chunk, especially for code files, by grouping related elements.
- **Adaptability:** Different strategies are employed based on file type to optimize chunking for various content formats.

## Chunking Strategies

The system employs the following chunking strategies, primarily managed by `src/tools/local-repository-enhanced.ts` and utilizing parsing logic from `src/utils/ast-parser.ts`:

1.  **Semantic Chunking (`semantic`):**
    *   **Applicable to:** Code files (e.g., `.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.java`, etc.) and structured documentation (e.g., `.md`).
    *   **Approach:**
        *   For code files, `src/utils/ast-parser.ts` is used to parse the Abstract Syntax Tree (AST) and identify meaningful code structures such as classes, functions, and methods.
        *   For code files, `src/utils/ast-parser.ts` is used to parse the Abstract Syntax Tree (AST) and identify meaningful code structures such as classes, functions, and methods.
        *   Associated docstrings (JSDoc, Python docstrings, etc.) are extracted and treated as separate 'documentation' chunks linked to their respective code symbols. The 'title' for these chunks is set to the first line of the docstring when available, falling back to the symbol name.
        *   The code blocks themselves are also chunked as 'code' chunks, preserving the structure of the identified symbols. The 'title' for code chunks is set to the symbol name.
        *   For Markdown files, semantic chunking typically involves splitting by headings and paragraphs to keep related text together. The main heading is used as the 'title' for the first chunk.
    *   **Goal:** To create chunks that represent logical units of code or documentation, improving the relevance of search results by providing contextually rich titles and content.

2.  **Line-Based Chunking (`line`):**
    *   **Applicable to:** Plain text files (`.txt`) or other files where semantic structure is less defined or not parsable by dedicated parsers.
    *   **Approach:** Files are split into chunks based on a maximum number of lines or characters per chunk.
    *   **Goal:** Simple and reliable chunking for unstructured text.

3.  **Text-Based Chunking (`text`):**
    *   **Applicable to:** Files where a simple text split is sufficient.
    *   **Approach:** Files are split into chunks based on a maximum number of characters, typically splitting by whitespace to avoid breaking words.
    *   **Goal:** A basic fallback for content that doesn't fit other strategies.

## Implementation Details

-   The `LocalRepositoryEnhancedTool` in `src/tools/local-repository-enhanced.ts` determines the appropriate chunking strategy based on the file extension and the `fileTypeConfig` provided in the repository configuration.
-   The `parseCodeFile` function in `src/utils/ast-parser.ts` is the core logic for implementing semantic chunking for supported code languages. It returns `CodeChunk` objects that include the text, line numbers, symbol name, parent symbol (for methods), and associated docstring.
-   The `splitTextByTokens` function (from `src/utils/token-counter.ts`) is used to further split chunks if they exceed the maximum token size, ensuring compliance with embedding model constraints.
-   Generic file parsing in `src/utils/ast-parser.ts` attempts to identify comment blocks as chunks first before falling back to fixed-size line-based chunks.

This layered approach ensures that content is chunked effectively, providing relevant and contextually rich data for the documentation index.

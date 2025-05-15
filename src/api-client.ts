import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { QdrantClient } from "@qdrant/js-client-rest";
import { chromium } from "playwright";
import { EmbeddingService } from "./services/embeddings.js";
import { LLMService } from "./services/llm.js";
import { warn } from './utils/logger.js';

// Environment variables for configuration
const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || 'ollama';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'mistral';
const LLM_MODEL = process.env.LLM_MODEL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const FALLBACK_PROVIDER = process.env.FALLBACK_PROVIDER;
const FALLBACK_MODEL = process.env.FALLBACK_MODEL;
const LLM_FALLBACK_PROVIDER = process.env.LLM_FALLBACK_PROVIDER;
const LLM_FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL;
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

if (!QDRANT_URL) {
  throw new Error(
    "QDRANT_URL environment variable is required for cloud storage"
  );
}

if ((EMBEDDING_PROVIDER === 'openai' || FALLBACK_PROVIDER === 'openai') && !OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY environment variable is required when using OpenAI as either primary or fallback provider"
  );
}

if (EMBEDDING_PROVIDER === 'ollama') {
  warn('Using Ollama as primary provider. Make sure Ollama is running locally.');
}

export class ApiClient {
  qdrantClient: QdrantClient;
  embeddingService!: EmbeddingService; // Use definite assignment assertion
  llmService!: LLMService; // Use definite assignment assertion
  browser: any;
  vectorSize!: number; // Use definite assignment assertion

  constructor() {
    // Initialize Qdrant client with cloud configuration
    this.qdrantClient = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
    });
    // Embedding service, LLM service, and vector size will be initialized in the async initialize method
  }

  async initialize() {
    // Initialize embedding service with configured provider
    this.embeddingService = await EmbeddingService.createFromConfig({
      provider: EMBEDDING_PROVIDER as 'ollama' | 'openai' ,
      apiKey: EMBEDDING_PROVIDER === 'openai' ? OPENAI_API_KEY : undefined,
      model: EMBEDDING_MODEL,
      fallbackProvider: FALLBACK_PROVIDER as 'ollama' | 'openai' | undefined,
      fallbackApiKey: FALLBACK_PROVIDER === 'openai' ? OPENAI_API_KEY : undefined,
      fallbackModel: FALLBACK_MODEL
    });

    // Initialize LLM service with configured provider
    this.llmService = await LLMService.createFromConfig({
      provider: LLM_PROVIDER as 'ollama' | 'openai' | 'mistral',
      apiKey: LLM_PROVIDER === 'openai' ? OPENAI_API_KEY : undefined,
      model: LLM_MODEL,
      fallbackProvider: LLM_FALLBACK_PROVIDER as 'ollama' | 'openai' | 'mistral'| undefined,
      fallbackApiKey: LLM_FALLBACK_PROVIDER === 'openai' ? OPENAI_API_KEY : undefined,
      fallbackModel: LLM_FALLBACK_MODEL
    });

    this.vectorSize = this.embeddingService.getVectorSize();
  }

  async initBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch();
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async getEmbeddings(text: string): Promise<number[]> {
    try {
      return await this.embeddingService.generateEmbeddings(text);
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to generate embeddings: ${error}`
      );
    }
  }

  async initCollection(COLLECTION_NAME: string) {
    try {
      const collections = await this.qdrantClient.getCollections();
      const exists = collections.collections.some(
        (c) => c.name === COLLECTION_NAME
      );

      if (!exists) {
        await this.qdrantClient.createCollection(COLLECTION_NAME, {
          vectors: {
            size: this.vectorSize, // Dynamic size based on provider
            distance: "Cosine",
            // Add HNSW index configuration for better search performance
            hnsw_config: {
              m: 16, // More connections per node (default: 16)
              ef_construct: 100, // Higher values give more accurate index (default: 100)
              full_scan_threshold: 10000 // When to perform full scan (default: 10000)
            }
          },
          optimizers_config: {
            default_segment_number: 2,
            memmap_threshold: 20000,
            indexing_threshold: 50000, // Points per segment (default: 20000)
            vacuum_min_vector_number: 1000 // Minimum number of vectors to vacuum
          },
          replication_factor: 2,
        });
        
        // Store vector size in a configuration record for consistency checking
        try {
          await this.qdrantClient.setPayload(
            COLLECTION_NAME,
            {
              points: ['vector_size_config'],
              payload: { vector_size: this.vectorSize, provider: EMBEDDING_PROVIDER }
            }
          );
        } catch (error) {
          console.error('Failed to store vector size config. This is non-critical:', error);
        }

        // Create payload indexes for more efficient filtering
        await this.qdrantClient.createPayloadIndex(COLLECTION_NAME, {
          field_name: 'repository',
          field_schema: 'keyword'
        });
        
        // Add more payload indexes for common query filters
        try {
          await this.qdrantClient.createPayloadIndex(COLLECTION_NAME, {
            field_name: 'language',
            field_schema: 'keyword'
          });
          
          await this.qdrantClient.createPayloadIndex(COLLECTION_NAME, {
            field_name: 'isRepositoryFile',
            field_schema: 'bool'
          });
          
          await this.qdrantClient.createPayloadIndex(COLLECTION_NAME, {
            field_name: 'fileId',
            field_schema: 'keyword'
          });
        } catch (error) {
          console.error('Failed to create some payload indexes. This is non-critical:', error);
        }

      } else {
        // Check if the collection's vector size matches our current embedding provider
        try {
          const collectionInfo = await this.qdrantClient.getCollection(COLLECTION_NAME);
          const storedSize = collectionInfo.config.params.vectors?.size;
          
          if (storedSize !== this.vectorSize) {
            console.warn(`⚠️ Vector size mismatch: Collection has ${storedSize} dimensions, but current embedding provider uses ${this.vectorSize} dimensions.`);
            console.warn('This will cause issues with indexing and searching. Consider using a compatible embedding provider or create a new collection.');
          }
          
          // Try to create any missing payload indexes for better filtering performance
          try {
            // We use a try-catch for each index creation since some might already exist
            await this.qdrantClient.createPayloadIndex(COLLECTION_NAME, {
              field_name: 'repository',
              field_schema: 'keyword'
            }).catch(() => {});  // Ignore if already exists
            
            await this.qdrantClient.createPayloadIndex(COLLECTION_NAME, {
              field_name: 'language',
              field_schema: 'keyword'
            }).catch(() => {}); // Ignore if already exists
            
            await this.qdrantClient.createPayloadIndex(COLLECTION_NAME, {
              field_name: 'isRepositoryFile',
              field_schema: 'bool'
            }).catch(() => {}); // Ignore if already exists
            
            await this.qdrantClient.createPayloadIndex(COLLECTION_NAME, {
              field_name: 'fileId',
              field_schema: 'keyword'
            }).catch(() => {}); // Ignore if already exists
          } catch (error) {
            console.error('Failed to create or check payload indexes. This is non-critical:', error);
          }
        } catch (error) {
          console.error('Failed to check collection vector size:', error);
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("unauthorized")) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Failed to authenticate with Qdrant cloud. Please check your API key."
          );
        } else if (
          error.message.includes("ECONNREFUSED") ||
          error.message.includes("ETIMEDOUT")
        ) {
          throw new McpError(
            ErrorCode.InternalError,
            "Failed to connect to Qdrant cloud. Please check your QDRANT_URL."
          );
        }
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to initialize Qdrant cloud collection: ${error}`
      );
    }
  }
}

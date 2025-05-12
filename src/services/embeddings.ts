import ollama from 'ollama';
import OpenAI from 'openai';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { info, error, debug } from '../utils/logger.js';

export interface EmbeddingProvider {
  generateEmbeddings(text: string): Promise<number[]>;
  getVectorSize(): number;
  checkAvailability(): Promise<void>; // Add availability check
}

export class OllamaProvider implements EmbeddingProvider {
  private model: string;

  constructor(model: string = 'nomic-embed-text') {
    this.model = model;
  }

  async generateEmbeddings(text: string): Promise<number[]> {
    try {
      // Explicitly re-encode to UTF-8 to potentially handle subtle encoding issues
      const utf8Text = Buffer.from(text, 'utf-8').toString('utf-8');
      error('Generating Ollama embeddings for text: ' + utf8Text.substring(0, 50) + '...');
      const response = await ollama.embeddings({
        model: this.model,
        prompt: utf8Text
      });
      error('Successfully generated Ollama embeddings with size: ' + response.embedding.length);
      return response.embedding;
    } catch (err) {
      error('Ollama embedding error: ' + err);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to generate embeddings with Ollama: ${err}`
      );
    }
  }

  getVectorSize(): number {
    // nomic-embed-text produces 768-dimensional vectors
    return 768;
  }

  async checkAvailability(): Promise<void> {
    try {
      info('Checking Ollama availability...');
      // Attempt a minimal embeddings call to check availability
      await ollama.embeddings({
        model: this.model, // Use the configured model
        prompt: 'health check', // Minimal dummy prompt
        options: { num_predict: 0 } // Request no predictions, just check connection
      });
      info('Ollama is available.');
    } catch (err) {
      error('Ollama availability check failed: ' + err);
      throw new McpError(
        ErrorCode.InternalError,
        `Ollama service is not available. Please ensure Ollama is running and accessible: ${err}`
      );
    }
  }
}

export class OpenAIProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'text-embedding-3-small') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateEmbeddings(text: string): Promise<number[]> {
    try {
      // Explicitly re-encode to UTF-8 to potentially handle subtle encoding issues
      const utf8Text = Buffer.from(text, 'utf-8').toString('utf-8');
      error('Generating OpenAI embeddings for text: ' + utf8Text.substring(0, 50) + '...');
      const response = await this.client.embeddings.create({
        model: this.model,
        input: utf8Text,
      });
      const embedding = response.data[0].embedding;
      error('Successfully generated OpenAI embeddings with size: ' + embedding.length);
      return embedding;
    } catch (err) {
      error('OpenAI embedding error: ' + err);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to generate embeddings with OpenAI: ${err}`
      );
    }
  }

  getVectorSize(): number {
    // text-embedding-3-small produces 1536-dimensional vectors
    return 1536;
  }

  async checkAvailability(): Promise<void> {
    // For OpenAI, a simple check might involve verifying the API key format
    // or making a dummy low-cost API call (e.g., listing models).
    info('Checking OpenAI availability...');
    if (!this.client) {
       throw new McpError(ErrorCode.InvalidParams, 'OpenAI client not initialized. API key missing?');
    }
    try {
      // Attempt a low-cost call, like listing models without options
      await this.client.models.list();
      info('OpenAI is available.');
    } catch (err) {
       error('OpenAI availability check failed: ' + err);
       throw new McpError(
         ErrorCode.InternalError,
         `OpenAI service is not available or API key is invalid: ${err}`
       );
    }
  }
}

export class EmbeddingService {
  private provider: EmbeddingProvider;
  private fallbackProvider?: EmbeddingProvider;

  constructor(provider: EmbeddingProvider, fallbackProvider?: EmbeddingProvider) {
    this.provider = provider;
    this.fallbackProvider = fallbackProvider;
  }

  async generateEmbeddings(text: string): Promise<number[]> {
    try {
      return await this.provider.generateEmbeddings(text);
    } catch (err) {
      if (this.fallbackProvider) {
        error('Primary provider failed, trying fallback provider...');
        return this.fallbackProvider.generateEmbeddings(text);
      }
      throw err;
    }
  }

  getVectorSize(): number {
    return this.provider.getVectorSize();
  }

  static async createFromConfig(config: { // Mark as async
    provider: 'ollama' | 'openai';
    apiKey?: string;
    model?: string;
    fallbackProvider?: 'ollama' | 'openai';
    fallbackApiKey?: string;
    fallbackModel?: string;
  }): Promise<EmbeddingService> { // Update return type
    const primaryProvider = await EmbeddingService.createProvider( // Await the async call
      config.provider,
      config.apiKey,
      config.model
    );
    // Check primary provider availability
    await primaryProvider.checkAvailability();

    let fallbackProvider: EmbeddingProvider | undefined;
    if (config.fallbackProvider) {
      fallbackProvider = await EmbeddingService.createProvider( // Await the async call
        config.fallbackProvider,
        config.fallbackApiKey,
        config.fallbackModel
      );
      // Check fallback provider availability
      await fallbackProvider.checkAvailability();
    }

    return new EmbeddingService(primaryProvider, fallbackProvider);
  }

  private static async createProvider( // Mark as async
    provider: 'ollama' | 'openai',
    apiKey?: string,
    model?: string
  ): Promise<EmbeddingProvider> { // Update return type
    switch (provider) {
      case 'ollama':
        return new OllamaProvider(model);
      case 'openai':
        if (!apiKey) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'OpenAI API key is required'
          );
        }
        return new OpenAIProvider(apiKey, model);
      default:
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown embedding provider: ${provider}`
        );
    }
  }
}

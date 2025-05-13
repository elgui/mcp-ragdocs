import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { info, error, debug } from '../utils/logger.js';
import { ChatOpenAI } from '@langchain/openai';
import { ChatOllama } from '@langchain/community/chat_models/ollama';
import { ChatMistralAI } from '@langchain/mistralai';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, RunnableLike } from '@langchain/core/runnables';
import { PromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';

export interface LLMProvider {
  getModel(): ChatOpenAI | ChatOllama | ChatMistralAI;
  checkAvailability(): Promise<{ available: boolean; error?: string }>;
}

export class MistralLLMProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private chatModel: ChatMistralAI;

  constructor(apiKey: string, model: string = 'mistral-small-latest') {
    this.apiKey = apiKey;
    this.model = model;
    this.chatModel = new ChatMistralAI({
      apiKey: this.apiKey,
      model: this.model,
      temperature: 0,
    });
  }

  getModel(): ChatMistralAI {
    return this.chatModel;
  }

  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
    try {
      info('Checking Mistral LLM availability...');
      // Make a simple call to check availability
      await this.chatModel.invoke('health check');
      info('Mistral LLM is available.');
      return { available: true };
    } catch (err: any) {
      const errorMessage = `Mistral LLM service is not available or API key is invalid: ${err.message}`;
      error('Mistral LLM availability check failed: ' + errorMessage);
      return { available: false, error: errorMessage };
    }
  }
}

export class OllamaLLMProvider implements LLMProvider {
  private model: string;
  private chatModel: ChatOllama;

  constructor(model: string = 'llama3') {
    this.model = model;
    this.chatModel = new ChatOllama({
      model: this.model,
      temperature: 0,
    });
  }

  getModel(): ChatOllama {
    return this.chatModel;
  }

  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
    try {
      info('Checking Ollama LLM availability...');
      // Make a simple call to check availability
      await this.chatModel.invoke('health check');
      info('Ollama LLM is available.');
      return { available: true };
    } catch (err: any) {
      const errorMessage = `Ollama LLM service is not available. Please ensure Ollama is running and accessible: ${err.message}`;
      error('Ollama LLM availability check failed: ' + errorMessage);
      return { available: false, error: errorMessage };
    }
  }
}

export class OpenAILLMProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private chatModel: ChatOpenAI;

  constructor(apiKey: string, model: string = 'gpt-3.5-turbo') {
    this.apiKey = apiKey;
    this.model = model;
    this.chatModel = new ChatOpenAI({
      openAIApiKey: this.apiKey,
      modelName: this.model,
      temperature: 0,
    });
  }

  getModel(): ChatOpenAI {
    return this.chatModel;
  }

  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
    try {
      info('Checking OpenAI LLM availability...');
      // Make a simple call to check availability
      await this.chatModel.invoke('health check');
      info('OpenAI LLM is available.');
      return { available: true };
    } catch (err: any) {
      const errorMessage = `OpenAI LLM service is not available or API key is invalid: ${err.message}`;
      error('OpenAI LLM availability check failed: ' + errorMessage);
      return { available: false, error: errorMessage };
    }
  }
}

export class LLMService {
  private provider: LLMProvider;
  private fallbackProvider?: LLMProvider;
  private primaryProviderAvailable: boolean = false;
  private fallbackProviderAvailable: boolean = false;
  private primaryProviderError?: string;
  private fallbackProviderError?: string;

  constructor(provider: LLMProvider, fallbackProvider?: LLMProvider) {
    this.provider = provider;
    this.fallbackProvider = fallbackProvider;
  }

  getModel() {
    // Return primary model if available, otherwise fallback if available
    if (this.primaryProviderAvailable) {
      return this.provider.getModel();
    } else if (this.fallbackProviderAvailable && this.fallbackProvider) {
      return this.fallbackProvider.getModel();
    }
    // If neither is available, return undefined
    return undefined;
  }

  getAvailabilityStatus() {
    return {
      primary: {
        available: this.primaryProviderAvailable,
        error: this.primaryProviderError,
        provider: this.provider.constructor.name.replace('LLMProvider', ''),
      },
      fallback: this.fallbackProvider ? {
        available: this.fallbackProviderAvailable,
        error: this.fallbackProviderError,
        provider: this.fallbackProvider.constructor.name.replace('LLMProvider', ''),
      } : undefined,
      overallAvailable: this.primaryProviderAvailable || (this.fallbackProviderAvailable && !!this.fallbackProvider),
    };
  }

  static async createFromConfig(config: {
    provider?: 'ollama' | 'openai' | 'mistral';
    apiKey?: string;
    model?: string;
    fallbackProvider?: 'ollama' | 'openai' | 'mistral';
    fallbackApiKey?: string;
    fallbackModel?: string;
  }): Promise<LLMService> {
    let primaryProviderInstance: LLMProvider | undefined;
    let primaryProviderError: string | undefined;

    try {
      primaryProviderInstance = await LLMService.createProvider(
        config.provider || 'mistral', // Default to mistral
        config.apiKey,
        config.model || 'mistral-small-latest' // Default to mistral-small
      );
    } catch (err: any) {
      primaryProviderError = `Failed to create primary LLM provider: ${err.message}`;
      error(primaryProviderError);
    }

    // If primary provider instance could not be created, we cannot proceed
    if (!primaryProviderInstance) {
       const llmService = new LLMService({ // Create a dummy provider to avoid null issues
         getModel: () => { throw new Error('No LLM provider available'); },
         checkAvailability: async () => ({ available: false, error: primaryProviderError || 'Unknown error during primary provider creation' })
       });
       llmService.primaryProviderAvailable = false;
       llmService.primaryProviderError = primaryProviderError;
       error('LLM service initialized, but primary provider could not be created.');
       return llmService;
    }


    const llmService = new LLMService(primaryProviderInstance);

    // Check primary provider availability without blocking startup
    const primaryStatus = await primaryProviderInstance.checkAvailability();
    llmService.primaryProviderAvailable = primaryStatus.available;
    llmService.primaryProviderError = primaryStatus.error;


    if (config.fallbackProvider) {
      let fallbackProviderInstance: LLMProvider | undefined;
      let fallbackProviderError: string | undefined;
      try {
        fallbackProviderInstance = await LLMService.createProvider(
          config.fallbackProvider,
          config.fallbackApiKey,
          config.fallbackModel
        );
         llmService.fallbackProvider = fallbackProviderInstance;
      } catch (err: any) {
        fallbackProviderError = `Failed to create fallback LLM provider: ${err.message}`;
        error(fallbackProviderError);
      }

      if(fallbackProviderInstance) {
        // Check fallback provider availability without blocking startup
        const fallbackStatus = await fallbackProviderInstance.checkAvailability();
        llmService.fallbackProviderAvailable = fallbackStatus.available;
        llmService.fallbackProviderError = fallbackStatus.error;
      } else {
         llmService.fallbackProviderAvailable = false;
         llmService.fallbackProviderError = fallbackProviderError;
      }
    }

    // Log overall status
    const overallStatus = llmService.getAvailabilityStatus();
    if (overallStatus.overallAvailable) {
      info('LLM service initialized successfully.');
    } else {
      error('LLM service initialized, but no providers are available.');
      if (overallStatus.primary.error) error(`Primary provider error: ${overallStatus.primary.error}`);
      if (overallStatus.fallback?.error) error(`Fallback provider error: ${overallStatus.fallback.error}`);
    }


    return llmService;
  }

  private static async createProvider(
    provider: 'ollama' | 'openai' | 'mistral',
    apiKey?: string,
    model?: string
  ): Promise<LLMProvider | undefined> {
    try {
      switch (provider) {
        case 'ollama':
          return new OllamaLLMProvider(model);
        case 'openai':
          const openaiApiKey = apiKey || process.env.OPENAI_API_KEY;
          if (!openaiApiKey) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'OpenAI API key is required'
            );
          }
          return new OpenAILLMProvider(openaiApiKey, model);
        case 'mistral':
          const mistralApiKey = apiKey || process.env.MISTRAL_API_KEY;
          if (!mistralApiKey) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Mistral API key is required. Set MISTRAL_API_KEY environment variable or provide it in config.'
            );
          }
          return new MistralLLMProvider(mistralApiKey, model);
        default:
          throw new McpError(
            ErrorCode.InvalidParams,
            `Unknown LLM provider: ${provider}`
          );
      }
    } catch (err: any) {
       // Re-throw the error after logging, so createFromConfig can catch it
       throw err;
    }
  }

  // Create a chain for evaluating document relevance
  createRelevanceChain(query: string) {
    const model = this.getModel();
    if (!model) {
      error('Attempted to create relevance chain but no LLM provider is available.');
      throw new Error('No LLM provider available to create relevance chain.');
    }
    const relevanceSchema = z.object({
      isRelevant: z.boolean().describe("Whether the document is relevant to the query"),
      explanation: z.string().describe("Explanation of why the document is or is not relevant")
    });

    const relevanceParser = StructuredOutputParser.fromZodSchema(relevanceSchema);

    const relevancePrompt = PromptTemplate.fromTemplate(`
      You are an AI assistant evaluating the relevance of a document to a query.

      Query: {query}

      Document: {document}

      Determine if this document is relevant to the query.

      {format_instructions}
    `);

    return RunnableSequence.from([
      {
        query: () => query,
        document: (doc: string) => doc,
        format_instructions: () => relevanceParser.getFormatInstructions(),
      },
      relevancePrompt,
      model,
      relevanceParser,
    ]);
  }

  // Create a chain for synthesizing document content
  createSynthesisChain(query: string) {
    const model = this.getModel();
    if (!model) {
      error('Attempted to create synthesis chain but no LLM provider is available.');
      throw new Error('No LLM provider available to create synthesis chain.');
    }
    const synthesisSchema = z.object({
      summary: z.string().describe("A concise summary of the document content"),
      relevantPoints: z.array(z.string()).describe("Key points from the document that are relevant to the query"),
      sourceInfo: z.object({
        title: z.string().describe("The title of the document"),
        url: z.string().describe("The URL of the document"),
      }).describe("Information about the document source")
    });

    const synthesisParser = StructuredOutputParser.fromZodSchema(synthesisSchema);

    const synthesisPrompt = PromptTemplate.fromTemplate(`
      You are an AI assistant tasked with synthesizing document content.

      Query: {query}

      Document Title: {title}
      Document URL: {url}
      Document Content: {content}

      Synthesize the document content in relation to the query.

      {format_instructions}
    `);

    return RunnableSequence.from([
      {
        query: () => query,
        title: (input: { title: string, url: string, content: string }) => input.title,
        url: (input: { title: string, url: string, content: string }) => input.url,
        content: (input: { title: string, url: string, content: string }) => input.content,
        format_instructions: () => synthesisParser.getFormatInstructions(),
      },
      synthesisPrompt,
      model,
      synthesisParser,
    ]);
  }

  // Create a chain for generating file descriptions
  createFileDescriptionChain() {
    const model = this.getModel();
    if (!model) {
      error('Attempted to create file description chain but no LLM provider is available.');
      throw new Error('No LLM provider available to create file description chain.');
    }
    const fileDescriptionSchema = z.object({
      description: z.string().describe("A concise description of what the file does and its purpose"),
      fileType: z.string().describe("The type of file (e.g., 'TypeScript module', 'Configuration file', 'Documentation')"),
      mainFunctionality: z.string().describe("The main functionality or purpose of this file in 1-2 sentences")
    });

    const fileDescriptionParser = StructuredOutputParser.fromZodSchema(fileDescriptionSchema);

    const fileDescriptionPrompt = PromptTemplate.fromTemplate(`
      You are an AI assistant tasked with analyzing source code files.

      File Path: {filePath}
      File Content: {fileContent}

      Generate a concise description of this file. Focus on what the file does, its purpose,
      and its role in the codebase. Be specific but brief.

      {format_instructions}
    `);

    return RunnableSequence.from([
      {
        filePath: (input: { filePath: string, fileContent: string }) => input.filePath,
        fileContent: (input: { filePath: string, fileContent: string }) => input.fileContent,
        format_instructions: () => fileDescriptionParser.getFormatInstructions(),
      },
      fileDescriptionPrompt,
      model,
      fileDescriptionParser,
    ]);
  }
}

import { BaseTool } from './base-tool.js';
import { ToolDefinition, McpToolResponse, isDocumentPayload } from '../types.js';
import { ApiClient } from '../api-client.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { RunnableSequence } from '@langchain/core/runnables';
import fs from 'fs/promises';
import path from 'path';

// Define types for the processed results
interface RelevanceResult {
  result: any;
  isRelevant: boolean;
  explanation: string;
}

interface ProcessedResult {
  title: string;
  url: string;
  score: number;
  relevance: {
    isRelevant: boolean;
    explanation: string;
  };
  synthesis?: {
    summary: string;
    relevantPoints: string[];
  };
  sourceInfo?: {
    title: string;
    url: string;
  };
  content?: string;
  error?: string;
}

interface FileDescription {
  filePath: string;
  description: string;
  fileType: string;
  mainFunctionality: string;
}

interface FileDescriptionResponse {
  files: FileDescription[];
}

const COLLECTION_NAME = 'documentation';

export class SearchDocumentationTool extends BaseTool {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    super();
    this.apiClient = apiClient;
  }

  get definition(): ToolDefinition {
    return {
      name: 'search_documentation',
      description: 'Search through stored documentation with advanced processing',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return',
            default: 5,
          },
          useChain: {
            type: 'boolean',
            description: 'Whether to use LLM chain for processing results',
            default: true,
          },
          synthesizeFullContent: {
            type: 'boolean',
            description: 'Whether to read and synthesize the full content of relevant documents',
            default: true,
          },
          returnFormat: {
            type: 'string',
            description: 'Format to return results in (json or text)',
            default: 'json',
            enum: ['json', 'text'],
          },
          generateFileDescriptions: {
            type: 'boolean',
            description: 'Whether to generate concise descriptions for each file',
            default: false,
          },
          repositoryName: {
            type: 'string',
            description: 'Optional: Filter search results by repository name',
            required: false,
          },
        },
        required: ['query'],
      },
    };
  }

  async execute(args: any): Promise<McpToolResponse> {
    if (!args.query || typeof args.query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Query is required');
    }

    const limit = args.limit || 5;
    const useChain = args.useChain !== undefined ? args.useChain : true;
    const synthesizeFullContent = args.synthesizeFullContent !== undefined ? args.synthesizeFullContent : true;
    const returnFormat = args.returnFormat || 'json';
    const generateFileDescriptions = args.generateFileDescriptions !== undefined ? args.generateFileDescriptions : false;

    try {
      // Get embeddings for the query
      const queryEmbedding = await this.apiClient.getEmbeddings(args.query);

      // Construct filter based on repositoryName if provided
      const filter = args.repositoryName ? {
        must: [
          {
            key: "repository",
            match: {
              value: args.repositoryName
            }
          }
        ]
      } : undefined;

      // Search for relevant documents
      const searchResults = await this.apiClient.qdrantClient.search(COLLECTION_NAME, {
        vector: queryEmbedding,
        limit,
        with_payload: true,
        with_vector: false, // Optimize network transfer by not retrieving vectors
        score_threshold: 0.7, // Only return relevant results
        filter: filter, // Include the filter if it exists
      });

      // If no results found, return early
      if (searchResults.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: returnFormat === 'json'
                ? JSON.stringify({ results: [], message: 'No results found matching the query.' })
                : 'No results found matching the query.',
            },
          ],
        };
      }

      // If not using the LLM chain, return simple results
      if (!useChain) {
        const formattedResults = searchResults.map(result => {
          if (!isDocumentPayload(result.payload)) {
            throw new Error('Invalid payload type');
          }
          return {
            title: result.payload.title,
            url: result.payload.url,
            score: result.score,
            content: result.payload.text,
          };
        });

        return {
          content: [
            {
              type: 'text',
              text: returnFormat === 'json'
                ? JSON.stringify({ results: formattedResults })
                : formattedResults.map(r => `[${r.title}](${r.url})\nScore: ${r.score.toFixed(3)}\nContent: ${r.content}\n`).join('\n---\n'),
            },
          ],
        };
      }

      // Process results with LLM chain
      const relevanceChain = this.apiClient.llmService.createRelevanceChain(args.query);

      // Check relevance of each document
      const relevanceResults = await Promise.all(
        searchResults.map(async (result) => {
          if (!isDocumentPayload(result.payload)) {
            throw new Error('Invalid payload type');
          }

          try {
            const relevanceCheck = await relevanceChain.invoke(result.payload.text);
            return {
              result,
              isRelevant: relevanceCheck.isRelevant,
              explanation: relevanceCheck.explanation
            };
          } catch (err) {
            console.error('Error checking relevance:', err);
            return {
              result,
              isRelevant: true, // Default to true if there's an error
              explanation: 'Error checking relevance'
            };
          }
        })
      );

      // Filter to only relevant results
      const relevantResults = relevanceResults.filter(r => r.isRelevant);

      // If generating file descriptions is enabled, process each relevant document
      if (generateFileDescriptions && relevantResults.length > 0) {
        // Create a map to track unique file paths
        const uniqueFilePaths = new Map<string, { payload: any, score: number }>();

        // Collect unique file paths from relevant results
        for (const relevantResult of relevantResults) {
          const payload = relevantResult.result.payload;
          if (!isDocumentPayload(payload) || !payload.filePath || !payload.isRepositoryFile) {
            continue;
          }

          // Only keep the highest scoring result for each file path
          if (!uniqueFilePaths.has(payload.filePath) ||
              uniqueFilePaths.get(payload.filePath)!.score < relevantResult.result.score) {
            uniqueFilePaths.set(payload.filePath, {
              payload,
              score: relevantResult.result.score
            });
          }
        }

        // Create a file description chain
        const fileDescriptionChain = this.apiClient.llmService.createFileDescriptionChain();

        // Process each unique file
        const fileDescriptions: FileDescription[] = [];
        for (const [filePath] of uniqueFilePaths.entries()) {
          try {
            // Read the full file content
            const fileContent = await fs.readFile(filePath, 'utf-8');

            // Generate description for the file
            const description = await fileDescriptionChain.invoke({
              filePath,
              fileContent
            });

            fileDescriptions.push({
              filePath,
              description: description.description,
              fileType: description.fileType,
              mainFunctionality: description.mainFunctionality
            });
          } catch (err) {
            console.error(`Error processing file ${filePath}:`, err);
            // Skip files that can't be read or processed
          }
        }

        // Return the file descriptions as JSON
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query: args.query,
                files: fileDescriptions,
                totalResults: searchResults.length,
                relevantResults: relevantResults.length
              }, null, 2)
            },
          ],
        };
      }

      // If synthesizing full content, process each relevant document
      let processedResults: ProcessedResult[] = [];

      if (synthesizeFullContent && relevantResults.length > 0) {
        const synthesisChain = this.apiClient.llmService.createSynthesisChain(args.query);

        processedResults = await Promise.all(
          relevantResults.map(async (relevantResult) => {
            const payload = relevantResult.result.payload;
            if (!isDocumentPayload(payload)) {
              throw new Error('Invalid payload type');
            }

            // Get file path if available
            let fullContent = payload.text;
            if (payload.filePath && payload.isRepositoryFile) {
              try {
                // Try to read the full file content
                fullContent = await fs.readFile(payload.filePath, 'utf-8');
              } catch (err) {
                console.error(`Error reading file ${payload.filePath}:`, err);
                // Continue with the chunk content if file can't be read
              }
            }

            try {
              const synthesis = await synthesisChain.invoke({
                title: payload.title,
                url: payload.url,
                content: fullContent
              });

              return {
                title: payload.title,
                url: payload.url,
                score: relevantResult.result.score,
                relevance: {
                  isRelevant: relevantResult.isRelevant,
                  explanation: relevantResult.explanation
                },
                synthesis: {
                  summary: synthesis.summary,
                  relevantPoints: synthesis.relevantPoints
                },
                sourceInfo: synthesis.sourceInfo
              } as ProcessedResult;
            } catch (err) {
              console.error('Error synthesizing content:', err);
              return {
                title: payload.title,
                url: payload.url,
                score: relevantResult.result.score,
                relevance: {
                  isRelevant: relevantResult.isRelevant,
                  explanation: relevantResult.explanation
                },
                content: payload.text,
                error: 'Error synthesizing content'
              } as ProcessedResult;
            }
          })
        );
      } else {
        // Just return the relevant results without synthesis
        processedResults = relevantResults.map(relevantResult => {
          const payload = relevantResult.result.payload;
          if (!isDocumentPayload(payload)) {
            throw new Error('Invalid payload type');
          }

          return {
            title: payload.title,
            url: payload.url,
            score: relevantResult.result.score,
            relevance: {
              isRelevant: relevantResult.isRelevant,
              explanation: relevantResult.explanation
            },
            content: payload.text
          } as ProcessedResult;
        });
      }

      // Format the final response
      if (returnFormat === 'json') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query: args.query,
                results: processedResults,
                totalResults: searchResults.length,
                relevantResults: relevantResults.length
              }, null, 2)
            },
          ],
        };
      } else {
        // Format as text
        const textResults = processedResults.map((result: ProcessedResult) => {
          let text = `[${result.title}](${result.url})\nScore: ${result.score.toFixed(3)}\n`;

          if (result.synthesis) {
            text += `Summary: ${result.synthesis.summary}\n\nRelevant Points:\n`;
            result.synthesis.relevantPoints.forEach((point: string, i: number) => {
              text += `${i+1}. ${point}\n`;
            });
          } else if (result.content) {
            text += `Content: ${result.content}\n`;
          }

          return text;
        }).join('\n---\n');

        return {
          content: [
            {
              type: 'text',
              text: textResults || 'No relevant results found matching the query.'
            },
          ],
        };
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('unauthorized')) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Failed to authenticate with Qdrant cloud while searching'
          );
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
          throw new McpError(
            ErrorCode.InternalError,
            'Connection to Qdrant cloud failed while searching'
          );
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: `Search failed: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
}

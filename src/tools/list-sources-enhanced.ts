import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { McpToolResponse, isDocumentPayload } from '../types.js';
import { EnhancedBaseTool } from './enhanced-base-tool.js';
import { error } from '../utils/logger.js';

const COLLECTION_NAME = 'documentation';

interface Source {
  title: string;
  url: string;
}

interface GroupedSources {
  [domain: string]: {
    [subdomain: string]: Source[];
  };
}

/**
 * Enhanced list sources tool that replaces both the handler and tool versions.
 * This tool lists all documentation sources currently stored in the system.
 */
export class ListSourcesEnhancedTool extends EnhancedBaseTool {
  constructor(options?: any) {
    super(options);
  }

  get definition() {
    return {
      name: 'list_sources',
      description: 'List all documentation sources currently stored in the system',
      inputSchema: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            description: 'Format to return results in (grouped or flat)',
            default: 'grouped',
            enum: ['grouped', 'flat'],
          },
        },
        required: [],
      },
    };
  }

  private groupSourcesByDomainAndSubdomain(sources: Source[]): GroupedSources {
    const grouped: GroupedSources = {};

    for (const source of sources) {
      try {
        const url = new URL(source.url);
        const domain = url.hostname;
        const pathParts = url.pathname.split('/').filter(p => p);
        const subdomain = pathParts[0] || '/';

        if (!grouped[domain]) {
          grouped[domain] = {};
        }
        if (!grouped[domain][subdomain]) {
          grouped[domain][subdomain] = [];
        }
        grouped[domain][subdomain].push(source);
      } catch (err) {
        error(`Invalid URL: ${source.url}. Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return grouped;
  }

  private formatGroupedSources(grouped: GroupedSources): string {
    const output: string[] = [];
    let domainCounter = 1;

    for (const [domain, subdomains] of Object.entries(grouped)) {
      output.push(`${domainCounter}. ${domain}`);
      
      // Create a Set of unique URL+title combinations
      const uniqueSources = new Map<string, Source>();
      for (const sources of Object.values(subdomains)) {
        for (const source of sources) {
          uniqueSources.set(source.url, source);
        }
      }

      // Convert to array and sort
      const sortedSources = Array.from(uniqueSources.values())
        .sort((a, b) => a.title.localeCompare(b.title));

      // Use letters for subdomain entries
      sortedSources.forEach((source, index) => {
        output.push(`${domainCounter}.${index + 1}. ${source.title} (${source.url})`);
      });

      output.push(''); // Add blank line between domains
      domainCounter++;
    }

    return output.join('\n');
  }

  async execute(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    if (!this.apiClient) {
      throw new McpError(ErrorCode.InternalError, 'API client is required for listing sources');
    }

    const format = args?.format || 'grouped';

    try {
      await this.apiClient.initCollection(COLLECTION_NAME);
      
      const pageSize = 100;
      let offset = null;
      const sources: Source[] = [];
      
      while (true) {
        const scroll = await this.apiClient.qdrantClient.scroll(COLLECTION_NAME, {
          with_payload: true,
          with_vector: false,
          limit: pageSize,
          offset,
        });

        if (scroll.points.length === 0) break;
        
        for (const point of scroll.points) {
          if (point.payload && typeof point.payload === 'object' && 'url' in point.payload && 'title' in point.payload) {
            const payload = point.payload as any;
            sources.push({
              title: payload.title,
              url: payload.url
            });
          }
        }

        if (scroll.points.length < pageSize) break;
        offset = scroll.points[scroll.points.length - 1].id;
      }

      if (sources.length === 0) {
        return this.formatTextResponse('No documentation sources found.');
      }

      if (format === 'flat') {
        // Simple flat list format
        const flatList = sources.map(source => `${source.title} (${source.url})`).join('\n');
        return this.formatTextResponse(flatList);
      } else {
        // Grouped format (default)
        const grouped = this.groupSourcesByDomainAndSubdomain(sources);
        const formattedOutput = this.formatGroupedSources(grouped);
        return this.formatTextResponse(formattedOutput);
      }
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes('unauthorized')) {
          error(`Failed to authenticate with Qdrant cloud while listing sources: ${err.message}`);
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Failed to authenticate with Qdrant cloud while listing sources'
          );
        } else if (err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT')) {
          error(`Connection to Qdrant cloud failed while listing sources: ${err.message}`);
          throw new McpError(
            ErrorCode.InternalError,
            'Connection to Qdrant cloud failed while listing sources'
          );
        }
      }
      error(`Failed to list sources: ${err instanceof Error ? err.message : String(err)}`);
      return this.handleError(`Failed to list sources. Check logs for details.`);
    }
  }
}

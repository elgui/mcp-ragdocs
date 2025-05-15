import cors from "cors";
import express, { Application, NextFunction, Request, Response } from "express";
import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ApiClient } from "./api-client.js";
import { EnhancedHandlerRegistry } from "./handler-registry-enhanced.js";
import { info, error } from './utils/logger.js';
import { LLMService } from "./services/llm.js"; // Keep import for type definition
import { RepositoryConfig } from "./types.js"; // Keep import for type definition
import fsPromises from 'fs/promises'; // Import promises API
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const REPO_CONFIG_DIR = join(rootDir, 'repo-configs'); // Define REPO_CONFIG_DIR

interface ApiError extends Error {
  status?: number;
}

interface SearchResponse {
  results: Array<{
    url: string;
    title: string;
    content: string;
    snippet?: string;
    symbol?: string;
    type?: string;
    lines?: string;
  }>;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

interface Document {
  url: string;
  title: string;
  timestamp: string;
  status: string;
}

interface QueueItem {
  id: number;
  url: string;
  status: string;
  timestamp: string;
}

function getAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(getAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
  });
}

export class WebInterfaceEnhanced {
  private app: Application;
  private server: any;
  private handlerRegistry: EnhancedHandlerRegistry;
  private apiClient: ApiClient; // Add apiClient property
  private queuePath: string;

  constructor(handlerRegistry: EnhancedHandlerRegistry, apiClient: ApiClient) { // Accept apiClient in constructor
    this.handlerRegistry = handlerRegistry;
    this.apiClient = apiClient; // Assign apiClient
    this.app = express();
    this.queuePath = join(rootDir, "queue.txt");

    // Ensure queue file exists
    this.initializeQueueFile();

    this.setupMiddleware();
    this.setupRoutes();
  }

  private async initializeQueueFile() {
    try {
      // Check if queue file exists
      if (!fs.existsSync(this.queuePath)) {
        // Create the file if it doesn't exist
        await fs.promises.writeFile(this.queuePath, "", "utf8");
        info("Queue file created at: "+ this.queuePath);
      }
    } catch (err) {
      error(`Error initializing queue file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(join(rootDir, "src/public")));
    this.app.get("/", (req: Request, res: Response) => {
      res.sendFile(join(rootDir, "src/public/index.html"));
    });
  }

  private setupRoutes() {
    info('Setting up enhanced server routes...');
    const errorHandler = (
      err: ApiError,
      req: Request,
      res: Response,
      next: NextFunction
    ) => {
      // Ensure err is treated as an Error object
      const errorObj = err instanceof Error ? err : new Error(String(err));
      error(`API Error: ${errorObj.message}`); // Log the error message

      const status = (errorObj as ApiError).status || 500;
      const response: ErrorResponse = {
        error: errorObj.message || "Internal server error",
      };
      if (process.env.NODE_ENV === "development" && errorObj.stack) {
        response.details = errorObj.stack;
      }
      res.status(status).json(response);
    };

    info('Defining /documents route...');
    // Get all available documents
    this.app.get(
      "/documents",
      async (
        req: Request,
        res: Response,
        next: NextFunction
      ): Promise<void> => {
        try {
          const listSourcesTool = this.handlerRegistry.getTool('list_sources');
          if (!listSourcesTool) {
             throw new Error('List sources tool not found in registry');
          }
          const response = await listSourcesTool.execute({});
          const sourcesText = response.content?.[0]?.text ?? ''; // Use optional chaining and nullish coalescing

          if (
            sourcesText ===
            "No documentation sources found in the cloud collection."
          ) {
            res.json([]);
            return;
          }

          const documents = sourcesText
            .split("\n")
            .map((line: string) => {
              const match = line.match(/(.*?) \((.*?)\)/);
              if (match) {
                const [_, title, url] = match;
                return {
                  url,
                  title,
                  timestamp: new Date().toISOString(), // Timestamp not available from list-sources
                  status: "COMPLETED",
                };
              }
              return null;
            })
            .filter(Boolean);

          res.json(documents);
        } catch (error) {
          next(error);
        }
      }
    );
    info('/documents route defined.');

    info('Defining /repositories route...');
    // Get repositories from individual config files
    this.app.get(
      "/repositories",
      async (
        req: Request,
        res: Response,
        next: NextFunction
      ): Promise<void> => {
        try {
          info('Received GET request for /repositories');
          const repositories: RepositoryConfig[] = [];

          // Ensure the repo-configs directory exists
          try {
            await fsPromises.access(REPO_CONFIG_DIR);
          } catch {
            info('No repo-configs directory found for /repositories endpoint. Returning empty array.');
            res.json([]);
            return;
          }

          // Get all repository config files
          const configFiles = await fsPromises.readdir(REPO_CONFIG_DIR);
          const jsonFiles = configFiles.filter(file => file.endsWith('.json'));

          info(`Found ${jsonFiles.length} repository config files in ${REPO_CONFIG_DIR}`);

          for (const file of jsonFiles) {
            const configPath = join(REPO_CONFIG_DIR, file);
            try {
              const configContent = await fsPromises.readFile(configPath, 'utf-8');
              const repoConfig = JSON.parse(configContent) as RepositoryConfig;
              repositories.push({
                name: repoConfig.name,
                path: repoConfig.path,
                include: repoConfig.include, // Include other relevant fields if needed by frontend
                exclude: repoConfig.exclude,
                watchMode: repoConfig.watchMode,
                watchInterval: repoConfig.watchInterval,
                chunkSize: repoConfig.chunkSize,
                fileTypeConfig: repoConfig.fileTypeConfig
              });
            } catch (err) {
              error(`Error loading repository config file ${file} for /repositories endpoint: ${err instanceof Error ? err.message : String(err)}. Skipping.`);
            }
          }

          info(`Returning ${repositories.length} repositories for /repositories endpoint`);
          res.json(repositories);

        } catch (error: any) {
          error(`Error in /repositories endpoint: ${error.message}`);
          next(error); // Pass other errors to the error handler
        }
      }
    );
    info('/repositories route defined.');

    info('Defining /queue route...');
    // Get queue status
    this.app.get("/queue", async (req: Request, res: Response) => {
      try {
        // Ensure queue file exists
        if (!fs.existsSync(this.queuePath)) {
          await this.initializeQueueFile();
          res.json([]);
          return;
        }

        // Read the queue file directly to get pending items
        const queueContent = await fs.promises.readFile(this.queuePath, "utf8");
        info(`Queue file content: ${queueContent}`);

        const pendingUrls = queueContent
          .split("\n")
          .filter((line: string) => line.trim());
        info(`Pending URLs: ${pendingUrls.join(', ')}`);

        // Get processing status from list-queue tool
        const listQueueTool = this.handlerRegistry.getTool('list_queue');
        if (!listQueueTool) {
           throw new Error('List queue tool not found in registry');
        }
        const response = await listQueueTool.execute({});
        info(`List queue tool response: ${JSON.stringify(response)}`);

        const queueText = response.content?.[0]?.text ?? ''; // Use optional chaining and nullish coalescing
        info(`Queue text from tool: ${queueText}`);

        const processingItems = queueText
          .split("\n")
          .filter((line: string) => line.trim())
          .map((line: string) => {
            const [url, status, timestamp] = line.split(" | ");
            return {
              id: Buffer.from(url).toString("base64"),
              url,
              status: status || "PROCESSING",
              timestamp: timestamp || new Date().toISOString(),
            };
          });
        info(`Processing items: ${JSON.stringify(processingItems)}`);

        // Combine pending and processing items
        const queue = [
          // Add pending items that aren't in processing
          ...pendingUrls
            .filter((url) => !processingItems.some((item: QueueItem) => item.url === url))
            .map((url) => ({
              id: Buffer.from(url).toString("base64"),
              url,
              status: "PENDING",
              timestamp: new Date().toISOString(),
            })),
          // Add processing items
          ...processingItems,
        ];
        info(`Final queue: ${JSON.stringify(queue)}`);

        res.json(queue);
      } catch (err) {
        error(`Error getting queue: ${err instanceof Error ? err.message : String(err)}`);
        res.json([]);
      }
    });
    info('/queue route defined.');

    // Add document to queue
    this.app.post(
      "/add-doc",
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const { url, urls } = req.body;

          if (!url && (!urls || !Array.isArray(urls))) {
            const error: ApiError = new Error(
              "URL or array of URLs is required"
            );
            error.status = 400;
            throw error;
          }

          // Ensure queue file exists
          if (!fs.existsSync(this.queuePath)) {
            await this.initializeQueueFile();
          }

          const urlsToAdd = urls || [url];
          const addedItems: QueueItem[] = [];

          for (const u of urlsToAdd) {
            // Add newline only if file is not empty
            const fileContent = await fs.promises.readFile(
              this.queuePath,
              "utf8"
            );
            const separator = fileContent.length > 0 ? "\n" : "";
            await fs.promises.appendFile(this.queuePath, separator + u);

            addedItems.push({
              id: Date.now(),
              url: u,
              status: "PENDING",
              timestamp: new Date().toISOString(),
            });
          }

          // Start processing queue in background
          const runQueueTool = this.handlerRegistry.getTool('run_queue');
          if (!runQueueTool) {
             throw new Error('Run queue tool not found in registry');
          }
          runQueueTool.execute({}).catch((err: any) => {
            error(`Error processing queue: ${err instanceof Error ? err.message : String(err)}`);
          });

          res.json(addedItems);
        } catch (error) {
          next(error);
        }
      }
    );

    // Search documentation
    this.app.post(
      "/search",
      async (
        req: Request,
        res: Response,
        next: NextFunction
      ): Promise<void> => {
        try {
          const { query, score_threshold } = req.body; // Extract score_threshold
          if (!query) {
            const error: ApiError = new Error("Query is required");
            error.status = 400;
            throw error;
          }

          const searchDocumentationTool = this.handlerRegistry.getTool('search_documentation');
          if (!searchDocumentationTool) {
             throw new Error('Search documentation tool not found in registry');
          }

          info('Server: Calling searchDocumentationTool.execute...'); // Log calling the tool
          // Pass score_threshold to the tool if it exists in the request body
          const searchResponse = await searchDocumentationTool.execute({ query, score_threshold, returnFormat: 'json' });
          info('Server: searchDocumentationTool.execute successful.'); // Log successful tool execution

          // The enhanced tool is expected to return a structured JSON response directly
          if (searchResponse.content && searchResponse.content.length > 0 && searchResponse.content[0] && searchResponse.content[0].type === 'json' && searchResponse.content[0].json) {
             const responseData = searchResponse.content[0].json;
             const results: SearchResponse['results'] = responseData.results || [];
             res.json({ results });
          } else {
             // Handle unexpected response format from the tool
             error(`Unexpected response format from search documentation tool: ${JSON.stringify(searchResponse)}`);
             res.status(500).json({ error: 'Unexpected response format from search documentation tool' });
          }

        } catch (error) {
          next(error);
        }
      }
    );

    // Clear queue
    this.app.post(
      "/clear-queue",
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const clearQueueTool = this.handlerRegistry.getTool('clear_queue');
          if (!clearQueueTool) {
             throw new Error('Clear queue tool not found in registry');
          }
          const runQueueTool = this.handlerRegistry.getTool('run_queue');
          if (!runQueueTool) {
             throw new Error('Run queue tool not found in registry');
          }

          // Call the clear queue tool
          const response = await clearQueueTool.execute({});

          if (response.isError) {
            throw new Error(response.content[0].text);
          }

          // Also clear any running processes
          await runQueueTool.execute({ action: "stop" });

          // Ensure the queue file is empty
          await fs.promises.writeFile(this.queuePath, "", "utf8");

          res.json({ message: "Queue cleared successfully" });
        } catch (error) {
          next(error);
        }
      }
    );

    // Process queue
    this.app.post(
      "/process-queue",
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const runQueueTool = this.handlerRegistry.getTool('run_queue');
          if (!runQueueTool) {
             throw new Error('Run queue tool not found in registry');
          }
          // Start processing queue in background
          runQueueTool.execute({}).catch((err: any) => {
            error(`Error processing queue: ${err instanceof Error ? err.message : String(err)}`);
          });

          res.json({ message: "Queue processing started" });
        } catch (error) {
          next(error);
        }
      }
    );

    // Remove documentation (single or multiple)
    this.app.delete(
      "/documents",
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const { url, urls } = req.body;
          if (!url && (!urls || !Array.isArray(urls))) {
            const error: ApiError = new Error(
              "URL or array of URLs is required"
            );
            error.status = 400;
            throw error;
          }

          const removeDocumentationTool = this.handlerRegistry.getTool('remove_documentation');
          if (!removeDocumentationTool) {
             throw new Error('Remove documentation tool not found in registry');
          }

          const urlsToRemove = urls || [url];
          await removeDocumentationTool.execute({ urls: urlsToRemove });
          res.json({
            message: `${urlsToRemove.length} document${
              urlsToRemove.length === 1 ? "" : "s"
            } removed successfully`,
            count: urlsToRemove.length,
          });
        } catch (error) {
          next(error);
        }
      }
    );

    // Remove all documents
    this.app.delete(
      "/documents/all",
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const listSourcesTool = this.handlerRegistry.getTool('list_sources');
          if (!listSourcesTool) {
             throw new Error('List sources tool not found in registry');
          }
          const removeDocumentationTool = this.handlerRegistry.getTool('remove_documentation');
          if (!removeDocumentationTool) {
             throw new Error('Remove documentation tool not found in registry');
          }

          // First get all documents
          const response = await listSourcesTool.execute({});
          const sourcesText = response.content?.[0]?.text ?? ''; // Use optional chaining and nullish coalescing

          if (
            sourcesText ===
            "No documentation sources found in the cloud collection."
          ) {
            res.json({ message: "No documents to remove", count: 0 });
            return;
          }

          // Extract URLs from the sources
          const urls = sourcesText
            .split("\n")
            .map((line: string) => {
              const match = line.match(/(.*?) \((.*?)\)/);
              return match ? match[2] : null;
            })
            .filter((url: string | null): url is string => url !== null);

          if (urls.length === 0) {
            res.json({ message: "No documents to remove", count: 0 });
            return;
          }

          // Remove all documents
          await removeDocumentationTool.execute({ urls });
          res.json({
            message: `${urls.length} document${
              urls.length === 1 ? "" : "s"
            } removed successfully`,
            count: urls.length,
          });
        } catch (error) {
          next(error);
        }
      }
    );

    // Extract URLs
    this.app.post(
      "/extract-urls",
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const { url } = req.body;
          if (!url) {
            const error: ApiError = new Error("URL is required");
            error.status = 400;
            throw error;
          }

          const extractUrlsTool = this.handlerRegistry.getTool('extract_urls');
          if (!extractUrlsTool) {
             throw new Error('Extract URLs tool not found in registry');
          }

          const response = await extractUrlsTool.execute({ url });
          const urls = (response.content?.[0]?.text ?? '')
            .split("\n")
            .filter((url: string) => url.trim());

          res.json({ urls });
        } catch (error) {
          next(error);
        }
      }
    );

    // File descriptions
    this.app.post(
      "/file-descriptions",
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const { query, limit } = req.body;
          if (!query) {
            const error: ApiError = new Error("Query is required");
            error.status = 400;
            throw error;
          }

          const searchDocumentationTool = this.handlerRegistry.getTool('search_documentation');
          if (!searchDocumentationTool) {
             throw new Error('Search documentation tool not found in registry');
          }

          // Call the search tool with generateFileDescriptions enabled
          const response = await searchDocumentationTool.execute({
            query,
            limit: limit || 10,
            generateFileDescriptions: true,
            returnFormat: 'json' // Ensure the tool returns JSON
          });

          // Access the JSON response directly from the tool's response
          if (response.content && response.content.length > 0 && response.content[0] && response.content[0].type === 'json' && response.content[0].json) {
            const result = response.content[0].json;
            res.json(result);
          } else {
            // Handle the case where the response content is not as expected
            error(`Unexpected response format from search documentation tool for file descriptions: ${JSON.stringify(response)}`);
            const apiError: ApiError = new Error("Invalid response format from search documentation tool for file descriptions."); // Renamed variable
            apiError.status = 500;
            next(apiError); // Pass the renamed variable
          }
        } catch (error) {
          next(error);
        }
      }
    );

    // Get server status (including LLM availability)
    this.app.get("/status", (req: Request, res: Response) => {
      res.json({
        status: "ok", // Indicate server is running
        llmStatus: this.apiClient.llmService.getAvailabilityStatus(),
      });
    });

    this.app.use(errorHandler);
  }

  async start() {
    const port = await getAvailablePort(3030);
    this.server = this.app.listen(port, () => {
      info(`Enhanced web interface running at http://localhost:${port}`);
      info(`Enhanced server started successfully on port ${port}`);
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          info("Enhanced web interface stopped");
          resolve(true);
        });
      });
    }
  }
}

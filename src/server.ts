import cors from "cors";
import express, { Application, NextFunction, Request, Response } from "express";
import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ApiClient } from "./api-client.js";
import { ClearQueueTool } from "./tools/clear-queue.js";
import { ExtractUrlsTool } from "./tools/extract-urls.js";
import { ListQueueTool } from "./tools/list-queue.js";
import { ListSourcesTool } from "./tools/list-sources.js";
import { RemoveDocumentationTool } from "./tools/remove-documentation.js";
import { RunQueueTool } from "./tools/run-queue.js";
import { SearchDocumentationTool } from "./tools/search-documentation.js";
import { info, error } from './utils/logger.js';
import { LLMService } from "./services/llm.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

interface ApiError extends Error {
  status?: number;
}

interface SearchResponse {
  results: Array<{
    url: string;
    title: string;
    content: string;
    snippet?: string;
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

import net from 'net';

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

export class WebInterface {
  private app: Application;
  private server: any;
  private apiClient: ApiClient;
  private llmService: LLMService;
  private searchTool: SearchDocumentationTool;
  private runQueueTool: RunQueueTool;
  private listQueueTool: ListQueueTool;
  private listSourcesTool: ListSourcesTool;
  private clearQueueTool: ClearQueueTool;
  private removeDocTool: RemoveDocumentationTool;
  private extractUrlsTool: ExtractUrlsTool;
  private queuePath: string;

  constructor(apiClient: ApiClient, llmService: LLMService) {
    this.apiClient = apiClient;
    this.llmService = llmService;
    this.app = express();
    this.queuePath = join(rootDir, "queue.txt");

    // Initialize tools
    this.searchTool = new SearchDocumentationTool(apiClient);
    this.runQueueTool = new RunQueueTool(apiClient);
    this.listQueueTool = new ListQueueTool();
    this.listSourcesTool = new ListSourcesTool(apiClient);
    this.clearQueueTool = new ClearQueueTool();
    this.removeDocTool = new RemoveDocumentationTool(apiClient);
    this.extractUrlsTool = new ExtractUrlsTool(apiClient);

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
    const errorHandler = (
      err: ApiError,
      req: Request,
      res: Response,
      next: NextFunction
    ) => {
      error(`API Error: ${String(err)}`); // Log the error message as a string
      const status = err.status || 500;
      const response: ErrorResponse = {
        error: err.message || "Internal server error",
      };
      if (process.env.NODE_ENV === "development" && err.stack) {
        response.details = err.stack;
      }
      res.status(status).json(response);
    };

    // Get all available documents
    this.app.get(
      "/documents",
      async (
        req: Request,
        res: Response,
        next: NextFunction
      ): Promise<void> => {
        try {
          const response = await this.listSourcesTool.execute({});
          const sourcesText = response.content[0].text;

          if (
            sourcesText ===
            "No documentation sources found in the cloud collection."
          ) {
            res.json([]);
            return;
          }

          const documents = sourcesText
            .split("\n")
            .map((line) => {
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
          .filter((line) => line.trim());
        info(`Pending URLs: ${pendingUrls.join(', ')}`);

        // Get processing status from list-queue tool
        const response = await this.listQueueTool.execute({});
        info(`List queue tool response: ${JSON.stringify(response)}`);

        const queueText = response.content[0].text;
        info(`Queue text from tool: ${queueText}`);

        const processingItems = queueText
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => {
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
            .filter((url) => !processingItems.some((item) => item.url === url))
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
          this.runQueueTool.execute({}).catch((err) => {
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
          const { query } = req.body;
          if (!query) {
            const error: ApiError = new Error("Query is required");
            error.status = 400;
            throw error;
          }

          const searchResponse = await this.searchTool.execute({ query });
          const searchText = searchResponse.content[0].text;

          if (searchText === "No results found matching the query.") {
            res.json({ results: [] });
          }

          // Parse the markdown formatted results
          const results = searchText
            .split("---")
            .filter((block) => block.trim())
            .map((block) => {
              const titleMatch = block.match(/\[(.*?)\]\((.*?)\)/);
              const contentMatch = block.match(/Content: (.*?)(?=\n|$)/s);

              return {
                title: titleMatch ? titleMatch[1] : "Unknown",
                url: titleMatch ? titleMatch[2] : "",
                content: contentMatch ? contentMatch[1] : "",
                snippet: contentMatch
                  ? contentMatch[1].substring(0, 200) + "..."
                  : undefined,
              };
            });

          const response: SearchResponse = { results };
          res.json(response);
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
          // Call the clear queue tool
          const response = await this.clearQueueTool.execute({});

          if (response.isError) {
            throw new Error(response.content[0].text);
          }

          // Also clear any running processes
          await this.runQueueTool.execute({ action: "stop" });

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
          // Start processing queue in background
          this.runQueueTool.execute({}).catch((err) => {
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

          const urlsToRemove = urls || [url];
          await this.removeDocTool.execute({ urls: urlsToRemove });
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
          // First get all documents
          const response = await this.listSourcesTool.execute({});
          const sourcesText = response.content[0].text;

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
            .map((line) => {
              const match = line.match(/(.*?) \((.*?)\)/);
              return match ? match[2] : null;
            })
            .filter((url): url is string => url !== null);

          if (urls.length === 0) {
            res.json({ message: "No documents to remove", count: 0 });
            return;
          }

          // Remove all documents
          await this.removeDocTool.execute({ urls });
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

          const response = await this.extractUrlsTool.execute({ url });
          const urls = response.content[0].text
            .split("\n")
            .filter((url) => url.trim());

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

          // Call the search tool with generateFileDescriptions enabled
          const response = await this.searchTool.execute({
            query,
            limit: limit || 10,
            generateFileDescriptions: true,
            returnFormat: 'json'
          });

          // Parse the JSON response
          const result = JSON.parse(response.content[0].text);
          res.json(result);
        } catch (error) {
          next(error);
        }
      }
    );

    // Get server status (including LLM availability)
    this.app.get("/status", (req: Request, res: Response) => {
      res.json({
        status: "ok", // Indicate server is running
        llmStatus: this.llmService.getAvailabilityStatus(),
      });
    });

    this.app.use(errorHandler);
  }

  async start() {
    const port = await getAvailablePort(3030);
    this.server = this.app.listen(port, () => {
      info(`Web interface running at http://localhost:${port}`);
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          info("Web interface stopped");
          resolve(true);
        });
      });
    }
  }
}

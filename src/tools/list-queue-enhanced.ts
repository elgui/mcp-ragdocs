import fs from "fs/promises";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { McpToolResponse } from "../types.js";
import { EnhancedBaseTool } from "./enhanced-base-tool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = path.join(__dirname, "../..");
const QUEUE_FILE = path.join(rootDir, "queue.txt");

export class ListQueueEnhancedTool extends EnhancedBaseTool {
  constructor(options?: any) {
    super(options);
  }

  get definition() {
    return {
      name: "list_queue",
      description:
        "List all URLs currently in the documentation processing queue",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    };
  }

  async execute(_args: any): Promise<McpToolResponse> {
    try {
      // Check if queue file exists
      try {
        await fs.access(QUEUE_FILE);
      } catch {
        return this.formatTextResponse('Queue is empty (queue file does not exist)');
      }

      // Read queue file
      const content = await fs.readFile(QUEUE_FILE, "utf-8");
      const urls = content.split("\n").filter((url) => url.trim() !== "");

      if (urls.length === 0) {
        return this.formatTextResponse('Queue is empty');
      }

      // Return the URLs with a descriptive header
      return this.formatTextResponse(`Queue contains ${urls.length} URLs:\n${urls.join("\n")}`);
    } catch (error) {
      console.error("Error reading queue:", error);
      return this.formatResponse({
        content: [{ type: 'text', text: `Failed to read queue: ${error}` }],
        isError: true,
      });
    }
  }
}

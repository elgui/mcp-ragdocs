import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE_PATH = path.join(__dirname, '..', '..', 'mcp-ragdocs.log');

const log = async (level: string, message: string) => {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} [${level.toUpperCase()}] ${message}\n`;
  try {
    await fs.appendFile(LOG_FILE_PATH, logMessage, 'utf-8');
  } catch (error) {
    // If writing to the log file fails, we can't log the error to the console
    // without potentially interfering with MCP. We'll fail silently or handle
    // this more robustly in a future logging implementation.
    // console.error(`Failed to write to log file: ${error}`);
  }
};

export const info = (message: string) => log('info', message);
export const error = (message: string) => log('error', message);
export const debug = (message: string) => log('debug', message);
export const warn = (message: string) => log('warn', message);

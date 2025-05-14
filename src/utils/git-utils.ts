/**
 * Utility functions for Git operations
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { error, debug } from './logger.js';

const execAsync = promisify(exec);

/**
 * Get the current commit SHA for a repository
 * 
 * @param repoPath Path to the repository
 * @returns The current commit SHA or empty string if not available
 */
export async function getCurrentCommitSha(repoPath: string): Promise<string> {
  try {
    // First check if GITHUB_SHA environment variable is set (for GitHub Actions)
    if (process.env.GITHUB_SHA) {
      debug(`Using GITHUB_SHA environment variable: ${process.env.GITHUB_SHA}`);
      return process.env.GITHUB_SHA;
    }
    
    // Otherwise, try to get the current commit SHA from Git
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: repoPath });
    const commitSha = stdout.trim();
    debug(`Got commit SHA from Git: ${commitSha}`);
    return commitSha;
  } catch (err) {
    error(`Failed to get current commit SHA: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/**
 * Check if a path is a Git repository
 * 
 * @param repoPath Path to check
 * @returns True if the path is a Git repository, false otherwise
 */
export async function isGitRepository(repoPath: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd: repoPath });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Get the root directory of a Git repository
 * 
 * @param repoPath Path within the repository
 * @returns The root directory of the repository or null if not a Git repository
 */
export async function getRepositoryRoot(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', { cwd: repoPath });
    return stdout.trim();
  } catch (err) {
    return null;
  }
}

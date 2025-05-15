/**
 * Utility for parsing code files using AST (Abstract Syntax Tree)
 */
import path from 'path';
import { Project, SourceFile, Node, SyntaxKind } from 'ts-morph';
import * as commentParser from 'comment-parser';
import { ParsedDocstring, parsePythonDocstrings, parseJSDocComments } from './docstring-parser.js';

/**
 * Represents a code chunk extracted from a file
 */
export interface CodeChunk {
  text: string;          // The code content
  startLine: number;     // Start line in the source file (1-based)
  endLine: number;       // End line in the source file (1-based)
  symbolName: string;    // Name of the associated symbol (function, class, etc.)
  parent?: string;       // Parent symbol name (e.g., class name for methods)
  docstring?: string;    // Associated docstring if available
}

/**
 * Parse a code file and extract code chunks with their associated docstrings
 * 
 * @param filePath The path to the file
 * @param content The content of the file
 * @returns Array of code chunks
 */
export function parseCodeFile(filePath: string, content: string): CodeChunk[] {
  const extension = path.extname(filePath).toLowerCase();
  
  switch (extension) {
    case '.ts':
    case '.tsx':
      return parseTypeScriptFile(content);
    case '.js':
    case '.jsx':
      return parseJavaScriptFile(content);
    case '.py':
      return parsePythonFile(content);
    default:
      // For other file types, use a simple line-based approach
      return parseGenericCodeFile(content);
  }
}

/**
 * Parse a TypeScript file using ts-morph
 */
function parseTypeScriptFile(content: string): CodeChunk[] {
  const project = new Project();
  const sourceFile = project.createSourceFile('temp.ts', content);
  const chunks: CodeChunk[] = [];
  
  // Parse JSDoc comments first
  const docstrings = parseJSDocComments(content);
  
  // Process classes
  sourceFile.getClasses().forEach(classDeclaration => {
    const className = classDeclaration.getName() || 'AnonymousClass';
    const startLine = classDeclaration.getStartLineNumber();
    const endLine = classDeclaration.getEndLineNumber();
    
    // Find associated docstring
    const classDocstring = docstrings.find(d => 
      d.isClass && 
      d.symbolName === className && 
      d.endLine <= startLine
    );
    
    // Add the class as a chunk
    chunks.push({
      text: classDeclaration.getText(),
      startLine,
      endLine,
      symbolName: className,
      docstring: classDocstring?.text
    });
    
    // Process methods
    classDeclaration.getMethods().forEach(method => {
      const methodName = method.getName();
      const methodStartLine = method.getStartLineNumber();
      const methodEndLine = method.getEndLineNumber();
      
      // Find associated docstring
      const methodDocstring = docstrings.find(d => 
        d.isFunction && 
        d.symbolName === methodName && 
        d.parent === className &&
        d.endLine <= methodStartLine
      );
      
      chunks.push({
        text: method.getText(),
        startLine: methodStartLine,
        endLine: methodEndLine,
        symbolName: methodName,
        parent: className,
        docstring: methodDocstring?.text
      });
    });
  });
  
  // Process standalone functions
  sourceFile.getFunctions().forEach(functionDeclaration => {
    const functionName = functionDeclaration.getName() || 'AnonymousFunction';
    const startLine = functionDeclaration.getStartLineNumber();
    const endLine = functionDeclaration.getEndLineNumber();
    
    // Find associated docstring
    const functionDocstring = docstrings.find(d => 
      d.isFunction && 
      d.symbolName === functionName && 
      !d.parent &&
      d.endLine <= startLine
    );
    
    chunks.push({
      text: functionDeclaration.getText(),
      startLine,
      endLine,
      symbolName: functionName,
      docstring: functionDocstring?.text
    });
  });
  
  // Add module-level docstring if present
  const moduleDocstring = docstrings.find(d => d.isModule);
  if (moduleDocstring) {
    chunks.push({
      text: moduleDocstring.text,
      startLine: moduleDocstring.startLine,
      endLine: moduleDocstring.endLine,
      symbolName: '__module__',
      docstring: moduleDocstring.text
    });
  }
  
  return chunks;
}


/**
 * Parses a JavaScript file. Currently uses the same parsing logic as TypeScript files
 * via ts-morph, which supports JavaScript.
 *
 * @param content The content of the JavaScript file.
 * @returns An array of CodeChunk objects representing the parsed code elements.
 */
function parseJavaScriptFile(content: string): CodeChunk[] {
  return parseTypeScriptFile(content); // ts-morph can handle JavaScript too
}

/**
 * Parses a Python file by identifying classes and functions using regex and associating
 * them with parsed Python docstrings.
 *
 * @param content The content of the Python file.
 * @returns An array of CodeChunk objects representing the parsed code elements.
 */
function parsePythonFile(content: string): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split(/\r?\n/);
  
  // Parse docstrings
  const docstrings = parsePythonDocstrings(content);
  
  // Simple regex patterns for Python constructs
  const classPattern = /^\s*class\s+(\w+)(?:\(.*\))?:/;
  const funcPattern = /^\s*def\s+(\w+)\s*\(.*\):/;
  
  let currentClass = '';
  let inClass = false;
  let classStartLine = -1;
  let classEndLine = -1;
  let classIndent = 0;
  
  // First pass: identify classes and their methods
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1; // 1-based line numbers
    
    // Check for class definition
    const classMatch = line.match(classPattern);
    if (classMatch) {
      // If we were in a class before, add it as a chunk
      if (inClass) {
        const classDocstring = docstrings.find(d => 
          d.isClass && 
          d.symbolName === currentClass
        );
        
        chunks.push({
          text: lines.slice(classStartLine - 1, classEndLine).join('\n'),
          startLine: classStartLine,
          endLine: classEndLine,
          symbolName: currentClass,
          docstring: classDocstring?.text
        });
      }
      
      currentClass = classMatch[1];
      inClass = true;
      classStartLine = lineNumber;
      classIndent = getIndentLevel(line);
      continue;
    }
    
    // Check for function definition
    const funcMatch = line.match(funcPattern);
    if (funcMatch) {
      const funcName = funcMatch[1];
      const funcIndent = getIndentLevel(line);
      
      // Find where this function ends
      let funcEndLine = lineNumber;
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const nextIndent = getIndentLevel(nextLine);
        
        // If we find a line with same or less indentation and it's not empty, 
        // we've reached the end of the function
        if (nextLine.trim() !== '' && nextIndent <= funcIndent) {
          break;
        }
        
        funcEndLine = j + 1;
        j++;
      }
      
      // If this function is indented more than the class, it's a method of that class
      if (inClass && funcIndent > classIndent) {
        const methodDocstring = docstrings.find(d => 
          d.isFunction && 
          d.symbolName === funcName && 
          d.parent === currentClass
        );
        
        chunks.push({
          text: lines.slice(lineNumber - 1, funcEndLine).join('\n'),
          startLine: lineNumber,
          endLine: funcEndLine,
          symbolName: funcName,
          parent: currentClass,
          docstring: methodDocstring?.text
        });
        
        // Update class end line
        classEndLine = funcEndLine;
      } else {
        // It's a standalone function
        const funcDocstring = docstrings.find(d => 
          d.isFunction && 
          d.symbolName === funcName && 
          !d.parent
        );
        
        chunks.push({
          text: lines.slice(lineNumber - 1, funcEndLine).join('\n'),
          startLine: lineNumber,
          endLine: funcEndLine,
          symbolName: funcName,
          docstring: funcDocstring?.text
        });
      }
      
      // Skip to the end of the function
      i = funcEndLine - 1;
      continue;
    }
    
    // If we're in a class and find a line with less or equal indentation than the class,
    // we've reached the end of the class
    if (inClass && line.trim() !== '' && getIndentLevel(line) <= classIndent) {
      const classDocstring = docstrings.find(d => 
        d.isClass && 
        d.symbolName === currentClass
      );
      
      chunks.push({
        text: lines.slice(classStartLine - 1, classEndLine).join('\n'),
        startLine: classStartLine,
        endLine: classEndLine,
        symbolName: currentClass,
        docstring: classDocstring?.text
      });
      
      inClass = false;
      currentClass = '';
    }
  }
  
  // If we were still in a class at the end of the file, add it
  if (inClass) {
    const classDocstring = docstrings.find(d => 
      d.isClass && 
      d.symbolName === currentClass
    );
    
    chunks.push({
      text: lines.slice(classStartLine - 1).join('\n'),
      startLine: classStartLine,
      endLine: lines.length,
      symbolName: currentClass,
      docstring: classDocstring?.text
    });
  }
  
  // Add module-level docstring if present
  const moduleDocstring = docstrings.find(d => d.isModule);
  if (moduleDocstring) {
    chunks.push({
      text: moduleDocstring.text,
      startLine: moduleDocstring.startLine,
      endLine: moduleDocstring.endLine,
      symbolName: '__module__',
      docstring: moduleDocstring.text
    });
  }
  
  return chunks;
}

/**
 * Parse a generic code file by looking for comment blocks
 */
function parseGenericCodeFile(content: string): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split(/\r?\n/);
  
  // Look for comment blocks
  let inCommentBlock = false;
  let commentStart = -1;
  let commentText: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1; // 1-based line numbers
    
    // Check for comment block start (various formats)
    if (!inCommentBlock && (line.trim().startsWith('/**') || line.trim().startsWith('/*') || 
                           line.trim().startsWith('###') || line.trim().startsWith('"""'))) {
      inCommentBlock = true;
      commentStart = lineNumber;
      commentText = [line.trim()];
      continue;
    }
    
    // Check for comment block end
    if (inCommentBlock && (line.includes('*/') || line.includes('###') || line.includes('"""'))) {
      commentText.push(line.trim());
      inCommentBlock = false;
      
      chunks.push({
        text: commentText.join('\n'),
        startLine: commentStart,
        endLine: lineNumber,
        symbolName: `comment_${commentStart}`,
        docstring: commentText.join('\n')
      });
      
      continue;
    }
    
    // Collect comment content
    if (inCommentBlock) {
      commentText.push(line.trim());
    }
  }
  
  // If there are no comment blocks, create chunks of reasonable size
  if (chunks.length === 0) {
    const CHUNK_SIZE = 50; // lines per chunk
    
    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
      const endLine = Math.min(i + CHUNK_SIZE, lines.length);
      chunks.push({
        text: lines.slice(i, endLine).join('\n'),
        startLine: i + 1,
        endLine,
        symbolName: `chunk_${i + 1}_${endLine}`
      });
    }
  }
  
  return chunks;
}

/**
 * Calculates the indentation level of a given line based on leading whitespace.
 *
 * @param line The string line to check.
 * @returns The number of leading whitespace characters.
 */
function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

/**
 * Estimates the number of tokens in a given string.
 * This is a simple approximation, assuming about 4 characters per token for English text.
 *
 * @param text The string content to estimate tokens for.
 * @returns The estimated number of tokens.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Splits a large code chunk into smaller chunks to ensure they stay within specified token limits.
 * This is useful for processing code snippets that might exceed the context window of language models.
 *
 * @param chunk The CodeChunk object to split.
 * @param minTokens The minimum desired token count for resulting chunks (currently not strictly enforced in splitting logic).
 * @param maxTokens The maximum allowed token count for resulting chunks.
 * @returns An array of smaller CodeChunk objects derived from the original chunk.
 */
export function splitChunkByTokens(chunk: CodeChunk, minTokens: number, maxTokens: number): CodeChunk[] {
  const tokenCount = estimateTokenCount(chunk.text);
  
  // If the chunk is already within limits, return it as is
  if (tokenCount <= maxTokens) {
    return [chunk];
  }
  
  // Split the chunk into lines
  const lines = chunk.text.split(/\r?\n/);
  const result: CodeChunk[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;
  let chunkStartLine = chunk.startLine;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTokens = estimateTokenCount(line);
    
    // If adding this line would exceed the max tokens, create a new chunk
    if (currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
      const chunkEndLine = chunkStartLine + currentChunk.length - 1;
      
      result.push({
        text: currentChunk.join('\n'),
        startLine: chunkStartLine,
        endLine: chunkEndLine,
        symbolName: `${chunk.symbolName}_part${result.length + 1}`,
        parent: chunk.parent,
        docstring: result.length === 0 ? chunk.docstring : undefined // Only include docstring in first chunk
      });
      
      currentChunk = [];
      currentTokens = 0;
      chunkStartLine = chunkEndLine + 1;
    }
    
    currentChunk.push(line);
    currentTokens += lineTokens;
  }
  
  // Add the last chunk if there's anything left
  if (currentChunk.length > 0) {
    result.push({
      text: currentChunk.join('\n'),
      startLine: chunkStartLine,
      endLine: chunk.startLine + lines.length - 1,
      symbolName: `${chunk.symbolName}_part${result.length + 1}`,
      parent: chunk.parent,
      docstring: result.length === 0 ? chunk.docstring : undefined // Only include docstring in first chunk
    });
  }
  
  return result;
}

/**
 * Utility for estimating token counts in text
 */

/**
 * Estimate the number of tokens in a string
 * This is a simple approximation - about 4 characters per token for English text
 * and about 3 characters per token for code
 * 
 * @param text The text to estimate tokens for
 * @param isCode Whether the text is code (uses different ratio)
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string, isCode: boolean = false): number {
  // For code, we use a slightly different ratio
  const charsPerToken = isCode ? 3 : 4;
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Split text into chunks of approximately the specified token size
 * 
 * @param text The text to split
 * @param minTokens Minimum tokens per chunk
 * @param maxTokens Maximum tokens per chunk
 * @param isCode Whether the text is code
 * @returns Array of text chunks
 */
export function splitTextByTokens(
  text: string, 
  minTokens: number = 200, 
  maxTokens: number = 400,
  isCode: boolean = false
): string[] {
  const tokenCount = estimateTokenCount(text, isCode);
  
  // If the text is already within limits, return it as is
  if (tokenCount <= maxTokens) {
    return [text];
  }
  
  // For code, split by lines to preserve structure
  if (isCode) {
    return splitCodeByTokens(text, minTokens, maxTokens);
  }
  
  // For regular text, try to split by paragraphs first
  const paragraphs = text.split(/\r?\n\r?\n/);
  
  // If we have multiple paragraphs, try to group them into chunks
  if (paragraphs.length > 1) {
    return splitParagraphsByTokens(paragraphs, minTokens, maxTokens);
  }
  
  // If we have a single paragraph, split by sentences
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  // If we have multiple sentences, group them into chunks
  if (sentences.length > 1) {
    return splitSentencesByTokens(sentences, minTokens, maxTokens);
  }
  
  // If we have a single sentence, split by words
  return splitByWords(text, maxTokens);
}

/**
 * Split code text into chunks by lines
 */
function splitCodeByTokens(
  code: string, 
  minTokens: number, 
  maxTokens: number
): string[] {
  const lines = code.split(/\r?\n/);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;
  
  for (const line of lines) {
    const lineTokens = estimateTokenCount(line, true);
    
    // If adding this line would exceed the max tokens, create a new chunk
    if (currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
      currentChunk = [];
      currentTokens = 0;
    }
    
    currentChunk.push(line);
    currentTokens += lineTokens;
  }
  
  // Add the last chunk if there's anything left
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'));
  }
  
  return chunks;
}

/**
 * Split text into chunks by paragraphs
 */
function splitParagraphsByTokens(
  paragraphs: string[], 
  minTokens: number, 
  maxTokens: number
): string[] {
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;
  
  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokenCount(paragraph);
    
    // If this paragraph alone exceeds max tokens, split it further
    if (paragraphTokens > maxTokens) {
      // Flush current chunk if not empty
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n\n'));
        currentChunk = [];
        currentTokens = 0;
      }
      
      // Split the paragraph and add each part as a separate chunk
      const paragraphChunks = splitTextByTokens(paragraph, minTokens, maxTokens);
      chunks.push(...paragraphChunks);
      continue;
    }
    
    // If adding this paragraph would exceed the max tokens, create a new chunk
    if (currentTokens + paragraphTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));
      currentChunk = [];
      currentTokens = 0;
    }
    
    currentChunk.push(paragraph);
    currentTokens += paragraphTokens;
  }
  
  // Add the last chunk if there's anything left
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }
  
  return chunks;
}

/**
 * Split text into chunks by sentences
 */
function splitSentencesByTokens(
  sentences: string[], 
  minTokens: number, 
  maxTokens: number
): string[] {
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;
  
  for (const sentence of sentences) {
    const sentenceTokens = estimateTokenCount(sentence);
    
    // If this sentence alone exceeds max tokens, split it further
    if (sentenceTokens > maxTokens) {
      // Flush current chunk if not empty
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [];
        currentTokens = 0;
      }
      
      // Split the sentence by words
      chunks.push(...splitByWords(sentence, maxTokens));
      continue;
    }
    
    // If adding this sentence would exceed the max tokens, create a new chunk
    if (currentTokens + sentenceTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
      currentChunk = [];
      currentTokens = 0;
    }
    
    currentChunk.push(sentence);
    currentTokens += sentenceTokens;
  }
  
  // Add the last chunk if there's anything left
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }
  
  return chunks;
}

/**
 * Split text into chunks by words
 */
function splitByWords(text: string, maxTokens: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;
  
  for (const word of words) {
    const wordTokens = estimateTokenCount(word);
    
    // If adding this word would exceed the max tokens, create a new chunk
    if (currentTokens + wordTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
      currentChunk = [];
      currentTokens = 0;
    }
    
    currentChunk.push(word);
    currentTokens += wordTokens;
  }
  
  // Add the last chunk if there's anything left
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }
  
  return chunks;
}

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCodeFile } from '../build/utils/ast-parser.js';
import { splitTextByTokens } from '../build/utils/token-counter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testPythonParsing() {
  console.log('Testing Python file parsing...');
  const pythonFilePath = path.join(__dirname, 'sample-code.py');
  const content = await fs.readFile(pythonFilePath, 'utf-8');
  
  const codeChunks = parseCodeFile(pythonFilePath, content);
  
  console.log(`Found ${codeChunks.length} code chunks:`);
  for (const chunk of codeChunks) {
    console.log(`\n${'-'.repeat(80)}`);
    console.log(`Symbol: ${chunk.symbolName}${chunk.parent ? ` (Parent: ${chunk.parent})` : ''}`);
    console.log(`Lines: ${chunk.startLine}-${chunk.endLine}`);
    
    if (chunk.docstring) {
      console.log('\nDocstring:');
      console.log(chunk.docstring);
    }
    
    // Print first few lines of code
    const codePreview = chunk.text.split('\n').slice(0, 3).join('\n');
    console.log('\nCode preview:');
    console.log(codePreview + (chunk.text.split('\n').length > 3 ? '...' : ''));
    
    // Test token splitting
    if (chunk.docstring) {
      const docstringChunks = splitTextByTokens(chunk.docstring, 200, 400, false);
      console.log(`\nDocstring split into ${docstringChunks.length} chunks`);
    }
  }
}

async function testTypeScriptParsing() {
  console.log('\n\nTesting TypeScript file parsing...');
  const tsFilePath = path.join(__dirname, 'sample-code.ts');
  const content = await fs.readFile(tsFilePath, 'utf-8');
  
  const codeChunks = parseCodeFile(tsFilePath, content);
  
  console.log(`Found ${codeChunks.length} code chunks:`);
  for (const chunk of codeChunks) {
    console.log(`\n${'-'.repeat(80)}`);
    console.log(`Symbol: ${chunk.symbolName}${chunk.parent ? ` (Parent: ${chunk.parent})` : ''}`);
    console.log(`Lines: ${chunk.startLine}-${chunk.endLine}`);
    
    if (chunk.docstring) {
      console.log('\nDocstring:');
      console.log(chunk.docstring);
    }
    
    // Print first few lines of code
    const codePreview = chunk.text.split('\n').slice(0, 3).join('\n');
    console.log('\nCode preview:');
    console.log(codePreview + (chunk.text.split('\n').length > 3 ? '...' : ''));
    
    // Test token splitting
    if (chunk.docstring) {
      const docstringChunks = splitTextByTokens(chunk.docstring, 200, 400, false);
      console.log(`\nDocstring split into ${docstringChunks.length} chunks`);
    }
  }
}

async function main() {
  try {
    await testPythonParsing();
    await testTypeScriptParsing();
  } catch (err) {
    console.error('Error during testing:', err);
  }
}

main();

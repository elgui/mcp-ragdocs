/**
 * Utility for parsing docstrings from various programming languages
 */

/**
 * Represents a parsed docstring with its metadata
 */
export interface ParsedDocstring {
  text: string;          // The cleaned docstring text
  startLine: number;     // Start line in the source file
  endLine: number;       // End line in the source file
  symbolName: string;    // Name of the associated symbol (function, class, etc.)
  isClass: boolean;      // Whether this is a class docstring
  isFunction: boolean;   // Whether this is a function/method docstring
  isModule: boolean;     // Whether this is a module-level docstring
  parent?: string;       // Parent symbol name (e.g., class name for methods)
}

/**
 * Parse Python docstrings from source code
 * Handles Google, NumPy, and reStructuredText formats
 * 
 * @param source The Python source code
 * @returns Array of parsed docstrings
 */
export function parsePythonDocstrings(source: string): ParsedDocstring[] {
  const lines = source.split(/\r?\n/);
  const docstrings: ParsedDocstring[] = [];
  
  // Simple regex patterns for Python constructs
  const classPattern = /^\s*class\s+(\w+)(?:\(.*\))?:/;
  const funcPattern = /^\s*def\s+(\w+)\s*\(.*\):/;
  const docstringStartPattern = /^\s*(?:'{3}|"{3})/;
  const docstringEndPattern = /(?:'{3}|"{3})\s*$/;
  
  let inDocstring = false;
  let docstringStart = -1;
  let currentSymbol = '';
  let isClass = false;
  let isFunction = false;
  let isModule = false;
  let currentParent = '';
  let indentLevel = 0;
  let currentIndent = 0;
  let docstringText: string[] = [];
  
  // Check for module docstring at the beginning
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip empty lines and imports at the beginning
    if (!inDocstring && line.trim() === '' || line.trim().startsWith('import ') || line.trim().startsWith('from ')) {
      continue;
    }
    
    // Check for docstring start
    if (!inDocstring && docstringStartPattern.test(line)) {
      inDocstring = true;
      docstringStart = i;
      docstringText = [line.trim()];
      isModule = !currentSymbol; // It's a module docstring if we haven't seen a class or function yet
      
      // If this is the first non-empty, non-import line and it's a docstring, it's a module docstring
      if (i === 0 || lines.slice(0, i).every(l => l.trim() === '' || l.trim().startsWith('import ') || l.trim().startsWith('from '))) {
        isModule = true;
        currentSymbol = '__module__';
      }
      
      // If it's a single-line docstring
      if (docstringEndPattern.test(line)) {
        inDocstring = false;
        if (currentSymbol) {
          docstrings.push({
            text: cleanDocstring(docstringText.join('\n')),
            startLine: docstringStart + 1, // 1-based line numbers
            endLine: i + 1,
            symbolName: currentSymbol,
            isClass,
            isFunction,
            isModule,
            parent: currentParent
          });
        }
        
        if (isModule) {
          isModule = false;
          currentSymbol = '';
        }
      }
      continue;
    }
    
    // Check for docstring end
    if (inDocstring && docstringEndPattern.test(line)) {
      docstringText.push(line.trim());
      inDocstring = false;
      
      if (currentSymbol) {
        docstrings.push({
          text: cleanDocstring(docstringText.join('\n')),
          startLine: docstringStart + 1, // 1-based line numbers
          endLine: i + 1,
          symbolName: currentSymbol,
          isClass,
          isFunction,
          isModule,
          parent: currentParent
        });
      }
      
      if (isModule) {
        isModule = false;
        currentSymbol = '';
      }
      continue;
    }
    
    // Collect docstring content
    if (inDocstring) {
      docstringText.push(line.trim());
      continue;
    }
    
    // Check for class definition
    const classMatch = line.match(classPattern);
    if (classMatch) {
      currentSymbol = classMatch[1];
      isClass = true;
      isFunction = false;
      isModule = false;
      currentParent = '';
      currentIndent = getIndentLevel(line);
      continue;
    }
    
    // Check for function definition
    const funcMatch = line.match(funcPattern);
    if (funcMatch) {
      const funcName = funcMatch[1];
      currentIndent = getIndentLevel(line);
      
      // If this function is indented more than the last class, it's a method of that class
      if (isClass && currentIndent > indentLevel) {
        currentSymbol = funcName;
        currentParent = docstrings.filter(d => d.isClass).pop()?.symbolName || '';
        isClass = false;
        isFunction = true;
        isModule = false;
      } else {
        currentSymbol = funcName;
        currentParent = '';
        isClass = false;
        isFunction = true;
        isModule = false;
      }
      continue;
    }
  }
  
  return docstrings;
}

/**
 * Clean a docstring by removing common indentation and quote markers
 */
function cleanDocstring(docstring: string): string {
  // Remove the opening and closing triple quotes
  let cleaned = docstring.replace(/^(?:'{3}|"{3})/, '').replace(/(?:'{3}|"{3})$/, '');
  
  // Split into lines for processing
  const lines = cleaned.split(/\r?\n/);
  
  // Remove common indentation
  const indentMatch = lines.filter(line => line.trim()).map(line => line.match(/^(\s*)/)?.[1].length || 0);
  const minIndent = Math.min(...indentMatch);
  
  cleaned = lines.map(line => line.substring(minIndent)).join('\n').trim();
  
  return cleaned;
}

/**
 * Get the indentation level of a line
 */
function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

/**
 * Parse JSDoc comments from JavaScript/TypeScript source code
 * 
 * @param source The JavaScript/TypeScript source code
 * @returns Array of parsed docstrings
 */
export function parseJSDocComments(source: string): ParsedDocstring[] {
  const lines = source.split(/\r?\n/);
  const docstrings: ParsedDocstring[] = [];
  
  // Simple regex patterns for JS/TS constructs
  const classPattern = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+\w+(?:,\s*\w+)*)?/;
  const funcPattern = /^\s*(?:export\s+)?(?:async\s+)?(?:function\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+(?:<.*>)?)?/;
  const methodPattern = /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+(?:<.*>)?)?/;
  const jsDocStartPattern = /^\s*\/\*\*/;
  const jsDocEndPattern = /\*\/\s*$/;
  
  let inJSDoc = false;
  let jsDocStart = -1;
  let currentSymbol = '';
  let isClass = false;
  let isFunction = false;
  let isModule = false;
  let currentParent = '';
  let jsDocText: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check for JSDoc start
    if (!inJSDoc && jsDocStartPattern.test(line)) {
      inJSDoc = true;
      jsDocStart = i;
      jsDocText = [line.trim()];
      continue;
    }
    
    // Check for JSDoc end
    if (inJSDoc && jsDocEndPattern.test(line)) {
      jsDocText.push(line.trim());
      inJSDoc = false;
      
      // Look ahead for what this JSDoc is documenting
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') {
        j++;
      }
      
      if (j < lines.length) {
        const nextLine = lines[j];
        
        // Check if it's a class
        const classMatch = nextLine.match(classPattern);
        if (classMatch) {
          currentSymbol = classMatch[1];
          isClass = true;
          isFunction = false;
          isModule = false;
          currentParent = '';
        } else {
          // Check if it's a function
          const funcMatch = nextLine.match(funcPattern);
          if (funcMatch) {
            currentSymbol = funcMatch[1];
            isClass = false;
            isFunction = true;
            isModule = false;
            currentParent = '';
          } else {
            // Check if it's a method
            const methodMatch = nextLine.match(methodPattern);
            if (methodMatch) {
              currentSymbol = methodMatch[1];
              isClass = false;
              isFunction = true;
              isModule = false;
              
              // Find the parent class
              for (let k = jsDocStart - 1; k >= 0; k--) {
                const classMatch = lines[k].match(classPattern);
                if (classMatch) {
                  currentParent = classMatch[1];
                  break;
                }
              }
            } else {
              // It's probably a file/module JSDoc
              currentSymbol = '__module__';
              isClass = false;
              isFunction = false;
              isModule = true;
              currentParent = '';
            }
          }
        }
        
        docstrings.push({
          text: cleanJSDoc(jsDocText.join('\n')),
          startLine: jsDocStart + 1, // 1-based line numbers
          endLine: i + 1,
          symbolName: currentSymbol,
          isClass,
          isFunction,
          isModule,
          parent: currentParent
        });
      }
      
      continue;
    }
    
    // Collect JSDoc content
    if (inJSDoc) {
      jsDocText.push(line.trim());
    }
  }
  
  return docstrings;
}

/**
 * Clean a JSDoc comment by removing comment markers and common formatting
 */
function cleanJSDoc(jsdoc: string): string {
  // Remove the opening and closing markers
  let cleaned = jsdoc.replace(/^\s*\/\*\*/, '').replace(/\*\/\s*$/, '');
  
  // Remove leading asterisks from each line
  cleaned = cleaned.split(/\r?\n/).map(line => {
    return line.replace(/^\s*\*\s?/, '');
  }).join('\n').trim();
  
  return cleaned;
}

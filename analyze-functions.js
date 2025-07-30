#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

// Handle different glob package versions
let globFunction;
try {
  const globModule = require('glob');
  globFunction = globModule.glob || globModule.default || globModule;
} catch (e) {
  globFunction = require('glob');
}

class FunctionAnalyzer {
  constructor() {
    this.functions = new Map();
    this.functionCalls = new Map();
    this.errors = [];
    this.outputLines = [];
    this.skippedFunctionCount = 0;

    // Functions that shouldn't be tracked for usage (called by frameworks/systems)
    this.functionBlacklist = new Set([
      'render',
      'preloadTemplates',
      'constructor',
      // Event handlers
      'onChange',
      'onClick',
      'onSubmit',
      'onLoad',
      'onReady',
      'onFocus',
      'onBlur',
      'onMouseDown',
      'onMouseUp',
      'onMouseOver',
      'onMouseOut',
      'onKeyDown',
      'onKeyUp',
      'onInput',
      'onScroll',
      'onResize',
      'onError',
      'onSuccess',
      'onComplete',
      // Lifecycle methods
      'componentDidMount',
      'componentWillUnmount',
      'componentDidUpdate',
      'beforeMount',
      'mounted',
      'beforeUpdate',
      'updated',
      'beforeDestroy',
      'destroyed',
      // Hook patterns
      'useEffect',
      'useState',
      'useCallback',
      'useMemo',
      'useRef'
    ]);
  }

  log(message) {
    console.log(message);
    this.outputLines.push(message);
  }

  async analyzeFolder(folderPath) {
    let jsFiles;

    try {
      if (globFunction.promise) {
        jsFiles = await globFunction.promise('**/*.{js,jsx,mjs,ts,tsx}', {
          cwd: folderPath,
          ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**']
        });
      } else {
        jsFiles = await new Promise((resolve, reject) => {
          globFunction(
            '**/*.{js,jsx,mjs,ts,tsx}',
            {
              cwd: folderPath,
              ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**']
            },
            (error, files) => {
              if (error) reject(error);
              else resolve(files);
            }
          );
        });
      }
    } catch (error) {
      console.error('Glob error:', error);
      jsFiles = this.findJSFilesManually(folderPath);
    }

    if (!jsFiles || !Array.isArray(jsFiles)) {
      console.error('Failed to get file list, trying manual search...');
      jsFiles = this.findJSFilesManually(folderPath);
    }

    this.log(`Analyzing JavaScript functions in: ${folderPath}`);
    this.log(`Found ${jsFiles.length} JavaScript/TypeScript files to analyze...`);

    for (const file of jsFiles) {
      const fullPath = path.join(folderPath, file);
      try {
        await this.analyzeFile(fullPath, file);
      } catch (error) {
        const errorMsg = `Error analyzing ${file}: ${error.message}`;
        console.error(errorMsg);
        this.errors.push(errorMsg);
      }
    }

    this.generateReport();
    this.writeReportToFile(folderPath);
  }

  findJSFilesManually(dir, filesList = [], basePath = '') {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const relativePath = path.join(basePath, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (['node_modules', 'dist', 'build', '.git'].includes(file)) {
          continue;
        }
        this.findJSFilesManually(fullPath, filesList, relativePath);
      } else if (stat.isFile()) {
        const ext = path.extname(file).toLowerCase();
        if (['.js', '.jsx', '.mjs', '.ts', '.tsx'].includes(ext)) {
          filesList.push(relativePath);
        }
      }
    }

    return filesList;
  }

  async analyzeFile(filePath, relativePath) {
    const content = fs.readFileSync(filePath, 'utf-8');

    let ast;
    try {
      ast = parser.parse(content, {
        sourceType: 'module',
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        plugins: [
          'jsx',
          'typescript',
          'decorators-legacy',
          'classProperties',
          'asyncGenerators',
          'functionBind',
          'exportDefaultFrom',
          'exportNamespaceFrom',
          'dynamicImport',
          'nullishCoalescingOperator',
          'optionalChaining'
        ]
      });
    } catch (parseError) {
      throw new Error(`Parse error: ${parseError.message}`);
    }

    let currentClass = null;

    traverse(ast, {
      ClassDeclaration: {
        enter: (path) => {
          currentClass = path.node.id ? path.node.id.name : 'AnonymousClass';
        },
        exit: () => {
          currentClass = null;
        }
      },

      Function: (path) => {
        this.analyzeFunction(path, relativePath, currentClass);
      },

      CallExpression: (path) => {
        this.analyzeCall(path, relativePath);
      }
    });
  }

  analyzeFunction(path, file, className) {
    const node = path.node;
    const functionInfo = this.getFunctionInfo(node, path);
    const isAsync = node.async || false;
    const line = node.loc ? node.loc.start.line : 'unknown';

    // Skip functions that shouldn't be tracked for usage analysis
    if (!functionInfo.shouldTrack) {
      this.skippedFunctionCount++;
      return;
    }

    // Skip blacklisted functions
    if (this.isBlacklistedFunction(functionInfo.name)) {
      this.skippedFunctionCount++;
      return;
    }

    const functionId = `${file}:${functionInfo.name}:${line}`;

    const awaitedOperations = [];
    const promiseOperations = [];

    path.traverse({
      AwaitExpression: (awaitPath) => {
        awaitedOperations.push({
          line: awaitPath.node.loc ? awaitPath.node.loc.start.line : 'unknown',
          code: this.getCodeSnippet(awaitPath)
        });
      },

      CallExpression: (callPath) => {
        if (this.isPromiseOperation(callPath.node)) {
          promiseOperations.push({
            line: callPath.node.loc ? callPath.node.loc.start.line : 'unknown',
            code: this.getCodeSnippet(callPath)
          });
        }
      }
    });

    this.functions.set(functionId, {
      name: functionInfo.name,
      async: isAsync,
      file,
      class: className,
      line,
      awaitedOperations,
      promiseOperations,
      calls: [],
      awaitedCalls: []
    });

    if (!this.functionCalls.has(functionInfo.name)) {
      this.functionCalls.set(functionInfo.name, { callers: [], totalCalls: 0 });
    }
  }

  isBlacklistedFunction(functionName) {
    // Direct blacklist match
    if (this.functionBlacklist.has(functionName)) {
      return true;
    }

    // Pattern matches for event handlers
    const eventPatterns = [
      /^on[A-Z]/, // onSomething
      /^handle[A-Z]/, // handleSomething
      /Handler$/, // somethingHandler
      /Listener$/, // somethingListener
      /Callback$/, // somethingCallback
      /^_on[A-Z]/ // _onSomething (private event handlers)
    ];

    return eventPatterns.some((pattern) => pattern.test(functionName));
  }

  analyzeCall(path, file) {
    const node = path.node;
    const functionName = this.getCallName(node);

    if (!functionName) return;

    const isAwaited = t.isAwaitExpression(path.parent);
    const line = node.loc ? node.loc.start.line : 'unknown';

    if (!this.functionCalls.has(functionName)) {
      this.functionCalls.set(functionName, { callers: [], totalCalls: 0 });
    }

    const callInfo = this.functionCalls.get(functionName);
    callInfo.callers.push({ file, line, awaited: isAwaited });
    callInfo.totalCalls++;
  }

  getFunctionInfo(node, path) {
    // Handle named function declarations
    if (node.id && node.id.name) {
      return { name: node.id.name, shouldTrack: true };
    }

    // Handle class methods (constructors, methods, getters, setters)
    if (t.isClassMethod(path.parent)) {
      const method = path.parent;

      // Constructor
      if (method.kind === 'constructor') {
        return { name: 'constructor', shouldTrack: true };
      }

      // Regular methods, getters, setters
      if (t.isIdentifier(method.key)) {
        const prefix =
          method.kind === 'get' ? 'get '
          : method.kind === 'set' ? 'set '
          : '';
        return { name: `${prefix}${method.key.name}`, shouldTrack: true };
      }

      // Computed property names like [Symbol.iterator]
      if (method.computed && t.isMemberExpression(method.key)) {
        return { name: `[${this.getComputedPropertyName(method.key)}]`, shouldTrack: true };
      }

      return { name: 'anonymous method', shouldTrack: false };
    }

    // Handle object methods
    if (t.isObjectMethod(path.parent)) {
      const method = path.parent;

      if (t.isIdentifier(method.key)) {
        const prefix =
          method.kind === 'get' ? 'get '
          : method.kind === 'set' ? 'set '
          : '';
        return { name: `${prefix}${method.key.name}`, shouldTrack: true };
      }

      if (method.computed && t.isMemberExpression(method.key)) {
        return { name: `[${this.getComputedPropertyName(method.key)}]`, shouldTrack: true };
      }

      return { name: 'anonymous method', shouldTrack: false };
    }

    // Handle function expressions and arrow functions
    if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
      const parent = path.parent;

      // Variable assignment: const myFunc = () => {}
      if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
        return { name: parent.id.name, shouldTrack: true };
      }

      // Object property: { myMethod: () => {} }
      if (t.isProperty(parent)) {
        if (t.isIdentifier(parent.key)) {
          return { name: parent.key.name, shouldTrack: true };
        }
        if (t.isStringLiteral(parent.key)) {
          return { name: parent.key.value, shouldTrack: true };
        }
        if (parent.computed && t.isMemberExpression(parent.key)) {
          return { name: `[${this.getComputedPropertyName(parent.key)}]`, shouldTrack: true };
        }
      }

      // Assignment expression: obj.method = () => {}
      if (t.isAssignmentExpression(parent) && t.isMemberExpression(parent.left)) {
        const memberExpr = parent.left;
        if (t.isIdentifier(memberExpr.property)) {
          return { name: memberExpr.property.name, shouldTrack: true };
        }
      }

      // Everything else is a callback or inline function - don't track for usage
      return { name: 'callback/inline function', shouldTrack: false };
    }

    return { name: 'anonymous', shouldTrack: false };
  }

  getComputedPropertyName(memberExpr) {
    if (t.isIdentifier(memberExpr.object) && t.isIdentifier(memberExpr.property)) {
      return `${memberExpr.object.name}.${memberExpr.property.name}`;
    }
    return 'computed';
  }

  getCallName(node) {
    if (t.isIdentifier(node.callee)) {
      return node.callee.name;
    }

    if (t.isMemberExpression(node.callee)) {
      if (t.isIdentifier(node.callee.property)) {
        return node.callee.property.name;
      }
    }

    return null;
  }

  isPromiseOperation(node) {
    if (t.isMemberExpression(node.callee)) {
      const property = node.callee.property;
      if (t.isIdentifier(property)) {
        return ['then', 'catch', 'finally'].includes(property.name);
      }
    }

    if (t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.object, { name: 'Promise' })) {
      return true;
    }

    return false;
  }

  getCodeSnippet(path) {
    try {
      return `${path.node.type}`;
    } catch {
      return 'unknown';
    }
  }

  generateReport() {
    this.log('\n' + '='.repeat(80));
    this.log('📊 JAVASCRIPT FUNCTION ANALYSIS REPORT');
    this.log('='.repeat(80));
    this.log('This report analyzes your JavaScript codebase for function usage patterns,');
    this.log('async/await compliance, and potential optimization opportunities.');
    this.log('');
    this.log(`Note: ${this.skippedFunctionCount} inline functions, callbacks, event handlers, and`);
    this.log('framework-called functions were excluded from usage analysis.');
    this.log('');

    if (this.errors.length > 0) {
      this.log('⚠️  PARSING ERRORS:');
      this.errors.forEach((error) => this.log(`   ${error}`));
      this.log('');
    }

    this.generateFunctionList();
    this.generateAsyncValidationReport();
    this.generateUsageReport();
    this.generateSummary();
    this.generateRecommendations();
  }

  generateFunctionList() {
    this.log('\n📋 FUNCTION INVENTORY');
    this.log('-'.repeat(60));
    this.log('This section lists all trackable functions found in your codebase, organized by file and class.');
    this.log('⚡ = Async function | 🔧 = Synchronous function');
    this.log('');

    const byFile = new Map();

    for (const [functionId, func] of this.functions) {
      if (!byFile.has(func.file)) {
        byFile.set(func.file, []);
      }
      byFile.get(func.file).push(func);
    }

    // Only show files that have trackable functions
    const filesToShow = Array.from(byFile.entries()).filter(([file, functions]) => functions.length > 0);

    for (const [file, functions] of filesToShow) {
      this.log(`📁 ${file} (${functions.length} trackable functions)`);

      const byClass = new Map();
      byClass.set(null, []);

      for (const func of functions) {
        if (!byClass.has(func.class)) {
          byClass.set(func.class, []);
        }
        byClass.get(func.class).push(func);
      }

      for (const [className, classFunctions] of byClass) {
        if (className && classFunctions.length > 0) {
          this.log(`  🏛️  Class: ${className} (${classFunctions.length} methods)`);
        }

        for (const func of classFunctions) {
          const asyncMarker = func.async ? '⚡' : '🔧';
          const indent = className ? '    ' : '  ';
          const callCount = this.functionCalls.get(func.name)?.totalCalls || 0;
          this.log(`${indent}${asyncMarker} ${func.name} (line ${func.line}) - Called ${callCount} times`);
        }
      }
      this.log('');
    }
  }

  generateAsyncValidationReport() {
    this.log('\n🔍 ASYNC/AWAIT VALIDATION');
    this.log('-'.repeat(60));
    this.log('This section identifies potential issues with async/await usage patterns.');
    this.log('Proper async/await usage ensures your code behaves as expected and avoids');
    this.log('common pitfalls like unhandled promises or unnecessary async declarations.');
    this.log('');

    let issues = 0;

    for (const [functionId, func] of this.functions) {
      const callInfo = this.functionCalls.get(func.name);
      const issues_for_function = [];

      if (func.async) {
        // Check if async function has awaitable operations
        if (func.awaitedOperations.length === 0 && func.promiseOperations.length === 0) {
          issues_for_function.push('⚠️  UNNECESSARY ASYNC: This function is marked async but contains no awaited operations.');
          issues_for_function.push('    💡 Consider removing the "async" keyword to improve performance.');
        }

        // Check if async function is called without await
        if (callInfo) {
          const nonAwaitedCalls = callInfo.callers.filter((call) => !call.awaited);
          if (nonAwaitedCalls.length > 0) {
            issues_for_function.push(`⚠️  MISSING AWAIT: This async function is called without "await" in:`);
            issues_for_function.push(`    ${nonAwaitedCalls.map((c) => `${c.file}:${c.line}`).join(', ')}`);
            issues_for_function.push('    💡 Add "await" to these calls or the promise may not be handled properly.');
          }
        }
      } else {
        // Check if non-async function has awaitable operations
        if (func.awaitedOperations.length > 0 || func.promiseOperations.length > 0) {
          issues_for_function.push('⚠️  MISSING ASYNC: This function contains awaitable operations but is not marked async.');
          issues_for_function.push('    💡 Add "async" keyword to properly handle asynchronous operations.');
        }

        // Check if non-async function is called with await
        if (callInfo) {
          const awaitedCalls = callInfo.callers.filter((call) => call.awaited);
          if (awaitedCalls.length > 0) {
            issues_for_function.push(`⚠️  UNNECESSARY AWAIT: This non-async function is called with "await" in:`);
            issues_for_function.push(`    ${awaitedCalls.map((c) => `${c.file}:${c.line}`).join(', ')}`);
            issues_for_function.push('    💡 Remove "await" from these calls as they\'re not needed.');
          }
        }
      }

      if (issues_for_function.length > 0) {
        issues += issues_for_function.length;
        this.log(`❌ ${func.name} (${func.file}:${func.line})`);
        for (const issue of issues_for_function) {
          this.log(`   ${issue}`);
        }
        this.log('');
      }
    }

    if (issues === 0) {
      this.log('✅ EXCELLENT! No async/await issues found in your trackable functions.');
      this.log('   Your async patterns are properly implemented.');
    } else {
      this.log(`📊 Total async/await issues found: ${issues}`);
      this.log('   Fixing these issues will improve code reliability and performance.');
    }
  }

  generateUsageReport() {
    this.log('\n📞 FUNCTION USAGE ANALYSIS');
    this.log('-'.repeat(60));
    this.log('This section analyzes how often your trackable functions are called and identifies');
    this.log('opportunities for code optimization and cleanup. Only functions that can be');
    this.log('referenced by name elsewhere in the code are considered.');
    this.log('');

    const unused = [];
    const singleUse = [];
    const multiUse = [];

    for (const [functionId, func] of this.functions) {
      const callInfo = this.functionCalls.get(func.name);
      const callCount = callInfo ? callInfo.totalCalls : 0;

      if (callCount === 0) {
        unused.push(func);
      } else if (callCount === 1) {
        singleUse.push({ func, callInfo });
      } else {
        multiUse.push({ func, callInfo });
      }
    }

    if (unused.length > 0) {
      this.log('🚫 UNUSED FUNCTIONS (Dead Code):');
      this.log('   These named functions are never called and can likely be removed to reduce');
      this.log('   codebase size and maintenance burden.');
      this.log('');

      // Show ALL unused functions, no limiting
      for (const func of unused) {
        this.log(`   • ${func.name} (${func.file}:${func.line})`);
      }
      this.log('');
    }

    if (singleUse.length > 0) {
      this.log('⚠️  SINGLE-USE FUNCTIONS (Consider Inlining):');
      this.log('   These functions are only called once. Consider inlining them to reduce');
      this.log('   complexity, unless they serve a specific organizational purpose.');
      this.log('');

      // Show ALL single-use functions, no limiting
      for (const { func, callInfo } of singleUse) {
        const caller = callInfo.callers[0];
        this.log(`   • ${func.name} (${func.file}:${func.line}) → called from ${caller.file}:${caller.line}`);
      }
      this.log('');
    }

    if (multiUse.length > 0) {
      this.log('✅ WELL-USED FUNCTIONS (Good Reusability):');
      this.log('   These functions are called multiple times, indicating good code reuse.');
      this.log('   All well-used functions (sorted by call count):');
      this.log('');

      // Show ALL well-used functions, sorted by call count
      const sortedMultiUse = multiUse.sort((a, b) => b.callInfo.totalCalls - a.callInfo.totalCalls);
      for (const { func, callInfo } of sortedMultiUse) {
        this.log(`   • ${func.name} (${callInfo.totalCalls} calls) - ${func.file}:${func.line}`);
      }
    }
  }

  generateSummary() {
    this.log('\n📈 CODEBASE SUMMARY');
    this.log('-'.repeat(60));

    const trackableFunctions = this.functions.size;
    const totalFunctions = trackableFunctions + this.skippedFunctionCount;
    const asyncFunctions = Array.from(this.functions.values()).filter((f) => f.async).length;
    const syncFunctions = trackableFunctions - asyncFunctions;

    const unused = Array.from(this.functions.values()).filter((func) => {
      const callInfo = this.functionCalls.get(func.name);
      return !callInfo || callInfo.totalCalls === 0;
    }).length;

    const singleUse = Array.from(this.functions.values()).filter((func) => {
      const callInfo = this.functionCalls.get(func.name);
      return callInfo && callInfo.totalCalls === 1;
    }).length;

    const wellUsed = trackableFunctions - unused - singleUse;
    const usageEfficiency = trackableFunctions > 0 ? Math.round((wellUsed / trackableFunctions) * 100) : 0;

    this.log(`📊 Function Statistics:`);
    this.log(`   Total Functions: ${totalFunctions} (${trackableFunctions} trackable + ${this.skippedFunctionCount} inline/callbacks/events)`);
    this.log(`   • Trackable Async Functions: ${asyncFunctions} (${Math.round((asyncFunctions / trackableFunctions) * 100)}%)`);
    this.log(`   • Trackable Sync Functions: ${syncFunctions} (${Math.round((syncFunctions / trackableFunctions) * 100)}%)`);
    this.log('');
    this.log(`📈 Trackable Function Usage Efficiency: ${usageEfficiency}%`);
    this.log(`   • Well-used Functions: ${wellUsed}`);
    this.log(`   • Single-use Functions: ${singleUse} (${Math.round((singleUse / trackableFunctions) * 100)}%)`);
    this.log(`   • Unused Functions: ${unused} (${Math.round((unused / trackableFunctions) * 100)}%)`);
  }

  generateRecommendations() {
    const trackableFunctions = this.functions.size;
    const unused = Array.from(this.functions.values()).filter((func) => {
      const callInfo = this.functionCalls.get(func.name);
      return !callInfo || callInfo.totalCalls === 0;
    }).length;

    const singleUse = Array.from(this.functions.values()).filter((func) => {
      const callInfo = this.functionCalls.get(func.name);
      return callInfo && callInfo.totalCalls === 1;
    }).length;

    this.log('\n💡 OPTIMIZATION RECOMMENDATIONS');
    this.log('-'.repeat(60));

    if (unused > 0) {
      this.log('🎯 Code Cleanup Priority:');
      this.log(`   Remove ${unused} unused named functions to reduce codebase complexity`);
      this.log('');
    }

    if (singleUse > 5) {
      this.log('🔄 Refactoring Opportunity:');
      this.log(`   Consider inlining ${singleUse} single-use functions to simplify code structure`);
      this.log('');
    }

    const asyncIssues = this.countAsyncIssues();
    if (asyncIssues > 0) {
      this.log('⚡ Async/Await Improvements:');
      this.log(`   Fix ${asyncIssues} async/await issues to improve reliability and performance`);
      this.log('');
    }

    if (unused === 0 && singleUse < 5 && asyncIssues === 0) {
      this.log('🎉 EXCELLENT CODEBASE!');
      this.log('   Your function organization and async patterns are well-structured.');
      this.log('   No major optimization opportunities detected.');
    }
  }

  countAsyncIssues() {
    let count = 0;
    for (const [functionId, func] of this.functions) {
      const callInfo = this.functionCalls.get(func.name);

      if (func.async && func.awaitedOperations.length === 0 && func.promiseOperations.length === 0) {
        count++;
      }

      if (!func.async && (func.awaitedOperations.length > 0 || func.promiseOperations.length > 0)) {
        count++;
      }

      if (callInfo) {
        if (func.async) {
          count += callInfo.callers.filter((call) => !call.awaited).length;
        } else {
          count += callInfo.callers.filter((call) => call.awaited).length;
        }
      }
    }
    return count;
  }

  writeReportToFile(folderPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `function-analysis-report-${timestamp.slice(0, 19)}.txt`;
    const reportPath = path.join(folderPath, fileName);

    try {
      fs.writeFileSync(reportPath, this.outputLines.join('\n'), 'utf-8');
      this.log(`\n📄 Report saved to: ${reportPath}`);
      console.log(`\n📄 Report saved to: ${reportPath}`);
    } catch (error) {
      console.error(`Error writing report to file: ${error.message}`);
    }
  }
}

// Main execution
async function main() {
  const folderPath = process.argv[2] || '.';

  if (!fs.existsSync(folderPath)) {
    console.error(`Error: Folder "${folderPath}" does not exist.`);
    process.exit(1);
  }

  console.log(`🔍 Starting function analysis for: ${folderPath}`);

  const analyzer = new FunctionAnalyzer();
  await analyzer.analyzeFolder(folderPath);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = FunctionAnalyzer;

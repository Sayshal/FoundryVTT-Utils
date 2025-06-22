const fs = require('fs');
const path = require('path');

class CSSExtractor {
  constructor() {
    this.extractedRules = [];
  }

  parseCSSContent(cssContent, targetSelector) {
    const cleanTarget = targetSelector.trim();
    const rules = this.splitIntoRules(cssContent);
    rules.forEach((rule) => {
      const trimmedRule = rule.trim();
      if (trimmedRule && this.ruleMatchesSelector(trimmedRule, cleanTarget)) this.extractedRules.push(trimmedRule);
    });
  }

  splitIntoRules(cssContent) {
    const rules = [];
    let currentRule = '';
    let braceCount = 0;
    let inString = false;
    let stringChar = '';
    for (let i = 0; i < cssContent.length; i++) {
      const char = cssContent[i];
      const prevChar = i > 0 ? cssContent[i - 1] : '';
      if ((char === '"' || char === "'") && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
      }
      currentRule += char;
      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            rules.push(currentRule);
            currentRule = '';
          }
        }
      }
    }
    if (currentRule.trim()) rules.push(currentRule);
    return rules;
  }

  ruleMatchesSelector(rule, targetSelector) {
    const selectorMatch = rule.match(/^([^{]+)\{/);
    if (!selectorMatch) return false;
    const selectors = selectorMatch[1].split(',').map((s) => s.trim());
    return selectors.some((selector) => this.selectorMatches(selector, targetSelector));
  }

  selectorMatches(selector, target) {
    if (selector === target) return true;
    if (target.startsWith('.')) {
      const className = target.substring(1);
      const classRegex = new RegExp(`\\.${this.escapeRegex(className)}(?![\\w-])`);
      return classRegex.test(selector);
    }
    if (target.startsWith('#')) {
      const idName = target.substring(1);
      const idRegex = new RegExp(`#${this.escapeRegex(idName)}(?![\\w-])`);
      return idRegex.test(selector);
    }
    if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(target)) {
      const elementRegex = new RegExp(`\\b${this.escapeRegex(target)}(?![\\w-])`);
      return elementRegex.test(selector);
    }
    return selector.includes(target);
  }

  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async extractFromFile(inputPath, targetSelector, outputPath) {
    try {
      const cssContent = fs.readFileSync(inputPath, 'utf8');
      this.extractedRules = [];
      this.parseCSSContent(cssContent, targetSelector);
      const outputContent = this.formatOutput(targetSelector);
      fs.writeFileSync(outputPath, outputContent, 'utf8');
      console.log(`✅ Extracted ${this.extractedRules.length} rules matching "${targetSelector}"`);
      console.log(`📄 Output written to: ${outputPath}`);
      return { success: true, rulesCount: this.extractedRules.length, outputPath: outputPath };
    } catch (error) {
      console.error('❌ Error:', error.message);
      return { success: false, error: error.message };
    }
  }

  formatOutput(targetSelector) {
    const header = `/* CSS Rules extracted for selector: ${targetSelector} */\n/* Generated on: ${new Date().toISOString()} */\n\n`;
    if (this.extractedRules.length === 0) return header + `/* No rules found matching "${targetSelector}" */\n`;
    return header + this.extractedRules.join('\n\n') + '\n';
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log(`
Usage: node css-extractor.js <input.css> <selector> [output.css]

Examples:
  node css-extractor.js styles.css ".my-class"
  node css-extractor.js styles.css "#header" extracted.css
  node css-extractor.js styles.css "button" button-styles.css
        `);
    return;
  }
  const inputPath = args[0];
  const targetSelector = args[1];
  const outputPath = args[2] || `extracted-${Date.now()}.css`;
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    return;
  }
  const extractor = new CSSExtractor();
  extractor.extractFromFile(inputPath, targetSelector, outputPath);
}

async function extractCSSRules(inputPath, targetSelector, outputPath = null) {
  if (!outputPath) {
    const inputName = path.basename(inputPath, '.css');
    const selectorName = targetSelector.replace(/[^a-zA-Z0-9]/g, '_');
    outputPath = `${inputName}_${selectorName}_extracted.css`;
  }
  const extractor = new CSSExtractor();
  return await extractor.extractFromFile(inputPath, targetSelector, outputPath);
}
module.exports = { CSSExtractor, extractCSSRules };
if (require.main === module) main();

#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Default base font size (16px = 1rem)
const BASE_FONT_SIZE = 16;

function convertPxToRem(cssContent, baseFontSize = BASE_FONT_SIZE) {
  // Regex to match px values (including decimals)
  // Matches patterns like: 16px, 12.5px, 0.5px, etc.
  const pxRegex = /(\d*\.?\d+)px\b/g;

  return cssContent.replace(pxRegex, (match, pxValue) => {
    const px = parseFloat(pxValue);
    const rem = px / baseFontSize;

    // Round to 3 decimal places and remove trailing zeros
    const remValue = parseFloat(rem.toFixed(3));

    return `${remValue}rem`;
  });
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node px-to-rem.js <css-file> [base-font-size]');
    console.log('Example: node px-to-rem.js styles.css');
    console.log('Example: node px-to-rem.js styles.css 18');
    process.exit(1);
  }

  const filePath = args[0];
  const baseFontSize = args[1] ? parseFloat(args[1]) : BASE_FONT_SIZE;

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File '${filePath}' not found.`);
    process.exit(1);
  }

  try {
    // Read the CSS file
    const cssContent = fs.readFileSync(filePath, 'utf8');

    // Convert px to rem
    const convertedContent = convertPxToRem(cssContent, baseFontSize);

    // Create backup file
    const backupPath = filePath.replace(/\.css$/, '.backup.css');
    fs.writeFileSync(backupPath, cssContent);
    console.log(`Backup created: ${backupPath}`);

    // Write the converted content back to the original file
    fs.writeFileSync(filePath, convertedContent);

    console.log(`✅ Successfully converted px to rem in '${filePath}'`);
    console.log(`Base font size used: ${baseFontSize}px`);

    // Show conversion count
    const pxMatches = cssContent.match(/\d*\.?\d+px\b/g);
    const conversionCount = pxMatches ? pxMatches.length : 0;
    console.log(`Converted ${conversionCount} px values to rem`);
  } catch (error) {
    console.error(`Error processing file: ${error.message}`);
    process.exit(1);
  }
}

main();

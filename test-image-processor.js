#!/usr/bin/env node

// Test script for image processor
// Usage: node test-image-processor.js [image-file]

const fs = require("fs");
const path = require("path");
const { processScreenshot } = require("./image-processor.js");

async function main() {
  const imageFile = process.argv[2] || "screenshot.png";
  
  if (!fs.existsSync(imageFile)) {
    console.error(`Error: File not found: ${imageFile}`);
    process.exit(1);
  }

  console.log(`Processing ${imageFile}...\n`);

  try {
    const boardStr = await processScreenshot(imageFile, (status) => {
      console.log(status);
    });

    console.log("\n=== Extracted Board ===");
    console.log(boardStr);
    console.log("\n=== End of Board ===");
  } catch (error) {
    console.error("\nError:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();


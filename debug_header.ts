#!/usr/bin/env -S deno run --allow-read --allow-write

import { sectionHeader } from "./src/ui.ts";

console.log("Testing section header alignment:");
console.log("");

// Test different titles
const titles = [
  "Test",
  "Checking for Updates",
  "Update Summary",
  "Installing Updates",
  "Installed Binaries",
];

for (const title of titles) {
  console.log(`Title: "${title}" (length: ${title.length})`);
  sectionHeader(title);
  console.log("");
}

// Manual calculation debug
const title = "Checking for Updates";
const width = 50;
const innerWidth = width - 2; // 48
const padding = Math.max(0, innerWidth - title.length - 2); // 48 - 21 - 2 = 25
const leftPadding = Math.floor(padding / 2); // 12
const rightPadding = padding - leftPadding; // 13

console.log("Manual calculation for 'Checking for Updates':");
console.log(`Title length: ${title.length}`);
console.log(`Total width: ${width}`);
console.log(`Inner width: ${innerWidth}`);
console.log(`Padding: ${padding}`);
console.log(`Left padding: ${leftPadding}`);
console.log(`Right padding: ${rightPadding}`);

const _line = "─".repeat(width);
const header = `│ ${" ".repeat(leftPadding)}${title}${
  " ".repeat(rightPadding)
} │`;

console.log(`\nExpected header: "${header}"`);
console.log(`Header length: ${header.length}`);
console.log(`Expected length: ${width + 2}`);

import { Colors } from "./internal_utils.ts";

/**
 * Enhanced UI utilities for Chef terminal interface
 * Provides consistent formatting, colors, and visual elements
 */

// Extended color palette
export const UIColors = {
  ...Colors,
  // Status colors
  success: "#00ff00",
  error: "#ff0000",
  warning: "#ffff00",
  info: "#00b0f0",
  muted: "#888888",

  // Semantic colors
  primary: "#00b0f0",
  secondary: "#888888",
  accent: "#ff6b35",

  // Terminal colors
  bright: "#ffffff",
  dim: "#666666",
} as const;

// Symbols and emojis for better visual cues
export const Symbols = {
  // Status indicators
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
  update: "🔄",
  download: "📥",

  // Actions
  run: "🚀",
  install: "📦",
  link: "🔗",
  unlink: "🔓",
  desktop: "🖥️",

  // UI elements
  arrow: "→",
  bullet: "•",
  check: "✓",
  cross: "✗",
} as const;

// Box drawing characters for better visual structure
export const BoxChars = {
  horizontal: "─",
  vertical: "│",
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  cross: "┼",
  teeDown: "┬",
  teeUp: "┴",
  teeRight: "├",
  teeLeft: "┤",
} as const;

/**
 * Create a colored text output
 */
export function colorText(text: string, _color: string): string {
  return `%c${text}`;
}

/**
 * Print colored text to console
 */
export function printColored(text: string, color: string): void {
  console.log(`%c${text}`, `color: ${color}`);
}

/**
 * Create a status message with icon and color
 */
export function statusMessage(
  type: "success" | "error" | "warning" | "info" | "update",
  message: string,
): void {
  const configs = {
    success: { icon: Symbols.success, color: UIColors.success },
    error: { icon: Symbols.error, color: UIColors.error },
    warning: { icon: Symbols.warning, color: UIColors.warning },
    info: { icon: Symbols.info, color: UIColors.info },
    update: { icon: Symbols.update, color: UIColors.primary },
  };

  const config = configs[type];
  console.log(`%c${config.icon} ${message}`, `color: ${config.color}`);
}

/**
 * Create a section header with visual separation
 */
export function sectionHeader(title: string, width: number = 50): void {
  const titleSpace = width - 2; // Space for title (minus the two padding spaces)
  const padding = Math.max(0, titleSpace - title.length);
  const leftPadding = Math.floor(padding / 2);
  const rightPadding = padding - leftPadding;

  const line = BoxChars.horizontal.repeat(width);
  const header = `${BoxChars.vertical} ${" ".repeat(leftPadding)}${title}${
    " ".repeat(rightPadding)
  } ${BoxChars.vertical}`;

  console.log(
    `%c${BoxChars.topLeft}${line}${BoxChars.topRight}`,
    `color: ${UIColors.primary}`,
  );
  console.log(`%c${header}`, `color: ${UIColors.bright}`);
  console.log(
    `%c${BoxChars.bottomLeft}${line}${BoxChars.bottomRight}`,
    `color: ${UIColors.primary}`,
  );
}

/**
 * Create a simple box around text
 */
export function boxText(text: string, width?: number): void {
  const lines = text.split("\n");
  const maxLength = width || Math.max(...lines.map((line) => line.length)) + 4;

  const topLine = BoxChars.topLeft + BoxChars.horizontal.repeat(maxLength - 2) +
    BoxChars.topRight;
  const bottomLine = BoxChars.bottomLeft +
    BoxChars.horizontal.repeat(maxLength - 2) + BoxChars.bottomRight;

  console.log(`%c${topLine}`, `color: ${UIColors.primary}`);

  for (const line of lines) {
    const padding = " ".repeat(Math.max(0, maxLength - line.length - 4));
    console.log(
      `%c${BoxChars.vertical} ${line}${padding} ${BoxChars.vertical}`,
      `color: ${UIColors.bright}`,
    );
  }

  console.log(`%c${bottomLine}`, `color: ${UIColors.primary}`);
}

/**
 * Create a formatted table for binary lists
 */
export function printTable(
  headers: string[],
  rows: string[][],
  colors?: string[],
): void {
  if (rows.length === 0) return;

  // Calculate column widths
  const widths = headers.map((header, i) => {
    const maxRowWidth = Math.max(...rows.map((row) => row[i]?.length || 0));
    return Math.max(header.length, maxRowWidth) + 2;
  });

  const _totalWidth = widths.reduce((sum, width) => sum + width, 0) +
    headers.length + 1;

  // Print top border
  const topLine = BoxChars.topLeft +
    widths.map((w) => BoxChars.horizontal.repeat(w)).join(BoxChars.teeDown) +
    BoxChars.topRight;
  console.log(`%c${topLine}`, `color: ${UIColors.primary}`);

  // Print headers
  const headerRow = BoxChars.vertical +
    headers.map((header, i) => ` ${header.padEnd(widths[i] - 1)}`).join(
      BoxChars.vertical,
    ) +
    BoxChars.vertical;
  console.log(`%c${headerRow}`, `color: ${UIColors.bright}; font-weight: bold`);

  // Print separator
  const sepLine = BoxChars.teeRight +
    widths.map((w) => BoxChars.horizontal.repeat(w)).join(BoxChars.cross) +
    BoxChars.teeLeft;
  console.log(`%c${sepLine}`, `color: ${UIColors.primary}`);

  // Print rows
  rows.forEach((row, rowIndex) => {
    const rowLine = BoxChars.vertical +
      row.map((cell, i) => ` ${(cell || "").padEnd(widths[i] - 1)}`).join(
        BoxChars.vertical,
      ) +
      BoxChars.vertical;

    const color = colors?.[rowIndex] || UIColors.bright;
    console.log(`%c${rowLine}`, `color: ${color}`);
  });

  // Print bottom border
  const bottomLine = BoxChars.bottomLeft +
    widths.map((w) => BoxChars.horizontal.repeat(w)).join(BoxChars.teeUp) +
    BoxChars.bottomRight;
  console.log(`%c${bottomLine}`, `color: ${UIColors.primary}`);
}

/**
 * Print an indented list item
 */
export function listItem(
  text: string,
  level: number = 0,
  color?: string,
): void {
  const indent = "  ".repeat(level);
  const bullet = level === 0 ? Symbols.bullet : Symbols.arrow;
  console.log(
    `%c${indent}${bullet} ${text}`,
    `color: ${color || UIColors.bright}`,
  );
}

/**
 * Print a separator line
 */
export function separator(
  width: number = 50,
  char: string = BoxChars.horizontal,
): void {
  console.log(`%c${char.repeat(width)}`, `color: ${UIColors.muted}`);
}

/**
 * Print an empty line for spacing
 */
export function spacer(lines: number = 1): void {
  for (let i = 0; i < lines; i++) {
    console.log();
  }
}

/**
 * Print a banner with the Chef logo
 */
export function printBanner(): void {
  const banner = `
  ┌────────────────────────-─---┐
  │       🍳 CHEF 🍳            │
  │  Personal Package Manager   │
  └─────────────────────────----┘`;

  console.log(`%c${banner}`, `color: ${UIColors.primary}; font-weight: bold`);
  spacer();
}

/**
 * Print help text with better formatting
 */
export function printHelp(
  command: string,
  description: string,
  options?: Array<{ flag: string; desc: string }>,
): void {
  console.log(
    `%c${Symbols.info} ${command}`,
    `color: ${UIColors.accent}; font-weight: bold`,
  );
  console.log(`%c  ${description}`, `color: ${UIColors.bright}`);

  if (options && options.length > 0) {
    spacer();
    console.log(`%c  Options:`, `color: ${UIColors.info}`);
    options.forEach((option) => {
      console.log(
        `%c    ${option.flag.padEnd(20)} ${option.desc}`,
        `color: ${UIColors.muted}`,
      );
    });
  }
  spacer();
}

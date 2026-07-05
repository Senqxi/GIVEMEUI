export function parseCommandLine(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) current += "\\";
  if (current.length > 0) args.push(current);
  return args;
}

export function shellQuote(value: string): string {
  if (value === "") return "''";
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  if (value.includes("'") && !/["\\$`]/.test(value)) return `"${value}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function formatCommand(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
}

export function commandNameFromExecutable(executable: string): string {
  const normalized = executable.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? executable;
}

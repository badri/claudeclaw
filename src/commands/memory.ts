import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { mkdirSync } from "fs";
import { MEMORY_MD, WORKSPACE_DIR } from "../paths";

export async function memory(args: string[]) {
  const subcommand = args[0];

  if (subcommand === "show" || subcommand === "cat" || args.length === 0 && process.stdout.isTTY === false) {
    // Print to stdout
    if (!existsSync(MEMORY_MD)) {
      console.log("(memory file is empty or does not exist)");
      return;
    }
    const content = await Bun.file(MEMORY_MD).text();
    console.log(content.trim() || "(memory file is empty)");
    return;
  }

  if (subcommand === "clear") {
    if (!existsSync(MEMORY_MD)) {
      console.log("Memory file does not exist.");
      return;
    }
    await writeFile(MEMORY_MD, "", "utf8");
    console.log("Memory cleared.");
    return;
  }

  if (subcommand === "path") {
    console.log(MEMORY_MD);
    return;
  }

  // Default: open in $EDITOR (or fall back to printing if no TTY)
  if (!existsSync(MEMORY_MD)) {
    mkdirSync(WORKSPACE_DIR, { recursive: true });
    await writeFile(MEMORY_MD, "# Persistent Memory\n\n", "utf8");
  }

  if (!process.stdout.isTTY) {
    // Non-interactive: just print
    const content = await Bun.file(MEMORY_MD).text();
    console.log(content.trim() || "(memory file is empty)");
    return;
  }

  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const proc = Bun.spawn([editor, MEMORY_MD], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}

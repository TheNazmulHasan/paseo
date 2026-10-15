import type { AgyRunner } from "./agy-probes.js";

// Fakes shared by the antigravity unit tests. Nothing here spawns agy.

export function usageText(input: {
  gemini5h: number;
  geminiWeek?: number;
  claude5h?: number;
  claudeWeek?: number;
}): string {
  return [
    `Gemini Models\tWeekly Limit Remaining\t${input.geminiWeek ?? 100}%\t2026-10-11T09:47:39Z`,
    `Gemini Models\tFive Hour Limit Remaining\t${input.gemini5h}%\t2026-10-04T14:47:39Z`,
    `Claude and GPT models\tWeekly Limit Remaining\t${input.claudeWeek ?? 100}%\t2026-10-11T09:47:50Z`,
    `Claude and GPT models\tFive Hour Limit Remaining\t${input.claude5h ?? 100}%\t2026-10-04T14:47:50Z`,
  ].join("\n");
}

export const GEMINI_MODELS =
  "Fetching available models...\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\ngemini-3.1-pro-high\tGemini 3.1 Pro (High)\n";
export const WITH_CLAUDE = `${GEMINI_MODELS}claude-opus-5-5-medium\tClaude Opus 5.5 (Medium)\n`;

export interface FakeAccountData {
  usage?: string;
  models?: string;
  failUsage?: boolean;
  failModels?: boolean;
}

export function fakeRunner(table: Record<string, FakeAccountData>) {
  const calls: Array<{ home: string; args: string[] }> = [];
  const runner: AgyRunner = async (args, options) => {
    calls.push({ home: options.home, args });
    const entry = table[options.home];
    if (!entry) throw new Error(`unknown home ${options.home}`);
    if (args[0] === "models") {
      if (entry.failModels) throw new Error("models probe failed");
      return { stdout: entry.models ?? "", stderr: "", code: 0 };
    }
    if (entry.failUsage) throw new Error("usage probe failed");
    return { stdout: entry.usage ?? "", stderr: "", code: 0 };
  };
  return { runner, calls };
}

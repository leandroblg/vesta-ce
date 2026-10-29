// The research §5 data set: 1,000 active tasks with about 2 KB of formatted details, 200 reminders and
// 1,000 Archive and Trash items. Shared by the fill, query and performance tests.
import type { Reminder } from "../../../src/domain/reminder";
import type { Task } from "../../../src/domain/task";
import { makeReminder, makeTask } from "./helpers";

const WORDS = ["report", "invoice", "passport", "garden", "Café", "résumé", "meeting", "budget", "Ação", "travel", "dentist", "quarterly"];

function details(i: number): string {
  const w = (k: number) => WORDS[(i + k) % WORDS.length] ?? "word";
  const para = `Notes about **${w(1)}** and *${w(2)}* with \`code ${String(i)}\`, a [link](https://example.com/${String(i)}) and ==${w(3)}==.`;
  const table = `| Item | Qty |\n| --- | --- |\n| ${w(4)} | ${String(i % 7)} |`;
  const list = `- [ ] call about ${w(5)}\n- [x] paid ${w(6)} #${String(i)}`;
  const block = [`## ${w(0)} ${String(i)}`, para, table, list, `> ${w(7)} quoted`, "```js\nconst x = 1;\n```"].join("\n\n");
  let md = block;
  while (md.length < 2000) md += `\n\n${para}`;
  return md;
}

export interface SearchDataSet {
  tasks: Task[];
  reminders: Reminder[];
}

export function searchDataSet(): SearchDataSet {
  const tasks: Task[] = [];
  for (let i = 0; i < 1000; i++) tasks.push(makeTask({ titleMd: `Task **${String(i)}** ${WORDS[i % WORDS.length] ?? ""}`, detailsMd: details(i) }));
  for (let i = 0; i < 1000; i++) {
    const gone = i % 2 === 0 ? { doneAt: 1_000 + i } : { deletedAt: 1_000 + i };
    tasks.push(makeTask({ titleMd: `Old ${String(i)} ${WORDS[(i + 3) % WORDS.length] ?? ""}`, detailsMd: details(i + 5), ...gone }));
  }
  const reminders: Reminder[] = [];
  for (let i = 0; i < 200; i++) reminders.push(makeReminder({ textMd: `Remember **${WORDS[i % WORDS.length] ?? ""}** ${String(i)}` }));
  return { tasks, reminders };
}

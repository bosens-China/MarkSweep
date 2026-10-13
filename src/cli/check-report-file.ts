import { readFile } from "node:fs/promises";
import { parseCheckReport } from "@marksweep/core/report/check-report-file";
import type { BookmarkCheckResult } from "@marksweep/core/checker/types";

export async function readCheckReportFile(reportPath: string): Promise<BookmarkCheckResult[]> {
  return parseCheckReport(JSON.parse(await readFile(reportPath, "utf8")) as unknown).results;
}

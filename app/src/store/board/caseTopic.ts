// The Evidence Board's "Discuss this case": a case's discussion is an
// ordinary topic (topicsApi.ts) whose spec names the case file, so it shows
// in Discussions like any other and opens in the same floating chat window.
// Starting one is a single write (the topic note); the case file itself
// isn't changed, so it doesn't need a save of the board.
import { fetchPage } from "../api";
import { createTopic, goqlLiteral } from "../topicsApi";
import { TOPICS_VIEW } from "../views";

/** The text every discussion of case `caseHandle` contains. */
export function caseTopicFragment(caseHandle: string): string {
  return `"caseFile":${JSON.stringify(caseHandle)}`;
}

/** The handle of the case's discussion, or null if none was started. */
export async function findCaseTopic(token: string, caseHandle: string): Promise<string | null> {
  const whereExpr = `${TOPICS_VIEW.baseFilter} and ('${goqlLiteral(caseTopicFragment(caseHandle))}' in text.string)`;
  const { page } = await fetchPage(TOPICS_VIEW, token, null, false, whereExpr, TOPICS_VIEW.orderBy, 1);
  return (page.items[0]?.handle as string | undefined) ?? null;
}

export async function startCaseTopic(token: string, caseHandle: string, caseName: string, question: string): Promise<string> {
  return createTopic(token, caseName, question || undefined, undefined, caseHandle);
}

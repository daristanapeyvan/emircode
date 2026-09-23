/**
 * Untrusted Project Data Wrapper
 * Neutralizes Indirect Prompt Injections (e.g. "IGNORE ALL PREVIOUS INSTRUCTIONS")
 * by strictly tagging file and search data as inert external content.
 */

export function wrapUntrustedFileContent(path: string, content: string): string {
  const sanitizedPath = path.replace(/[<>\r\n]/g, '');
  return `<<<UNTRUSTED_PROJECT_DATA: ${sanitizedPath}>>>\n${content}\n<<<END_UNTRUSTED_PROJECT_DATA>>>`;
}

export function wrapUntrustedSearchResults(query: string, matchesText: string): string {
  const sanitizedQuery = query.replace(/[<>\r\n]/g, '');
  return `<<<UNTRUSTED_PROJECT_SEARCH_RESULTS: "${sanitizedQuery}">>>\n${matchesText}\n<<<END_UNTRUSTED_PROJECT_SEARCH_RESULTS>>>`;
}

export function wrapUntrustedGitOutput(action: string, output: string): string {
  return `<<<UNTRUSTED_GIT_OUTPUT: ${action}>>>\n${output}\n<<<END_UNTRUSTED_GIT_OUTPUT>>>`;
}

/**
 * Untrusted Web Data Wrapper
 * Neutralizes Indirect Prompt Injections from external websites or search snippets.
 * The model must strictly treat enclosed content as inert factual data, never system directives.
 */
export function wrapUntrustedWebResult(
  type: 'search' | 'fetch',
  header: string,
  content: string
): string {
  const sanitizedHeader = header.replace(/[<>\r\n]/g, '').trim().slice(0, 150);
  return `<<<WEB_RESULT_UNTRUSTED>>>\n[SOURCE: ${type.toUpperCase()} - ${sanitizedHeader}]\n${content}\n<<<END_WEB_RESULT_UNTRUSTED>>>`;
}

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

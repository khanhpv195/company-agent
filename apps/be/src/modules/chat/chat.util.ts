/** First line of a message with bold markers and backticks stripped (room and thread previews). */
export const previewOf = (markdown: string): string =>
  markdown.replace(/\*\*|`/g, '').split('\n')[0];

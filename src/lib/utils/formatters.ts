export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatTokens(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`;
  }
  return num.toString();
}

export function formatDurationNs(ns: number): string {
  const seconds = ns / 1_000_000_000;
  return `${seconds.toFixed(1)}s`;
}

export function formatParameterSize(size?: string): string {
  if (!size) return '';
  const match = size.match(/([0-9.]+)([a-zA-Z]+)?/);
  if (!match) return size;
  const val = parseFloat(match[1]);
  return `${val.toFixed(val % 1 === 0 ? 0 : 1)}B`;
}

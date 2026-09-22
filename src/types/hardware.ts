export interface HardwareInfo {
  cpu: {
    model: string;
    cores: number;
    logicalProcessors: number;
  };
  ram: {
    totalBytes: number;
    availableBytes: number;
    totalGb: number;
    availableGb: number;
  };
  gpu?: {
    model: string;
    vramMb?: number;
  };
}

export interface ModelHardwareGuidance {
  category: 'lightweight' | 'recommended' | 'demanding' | 'unsupported';
  reason: string;
}

export function getHardwareGuidance(paramSize: string, ramGb: number): ModelHardwareGuidance {
  const sizeNum = parseFloat(paramSize.replace(/[^0-9.]/g, ''));
  if (isNaN(sizeNum)) {
    return { category: 'recommended', reason: 'Guidance unavailable for unknown parameter scale.' };
  }

  if (sizeNum <= 4) {
    return { category: 'lightweight', reason: 'Runs comfortably with minimal memory pressure.' };
  }
  if (sizeNum <= 9) {
    if (ramGb >= 8) {
      return { category: 'recommended', reason: 'Well-suited for your hardware configuration.' };
    }
    return { category: 'demanding', reason: 'Requires at least 8 GB RAM; may run slower on limited memory.' };
  }
  if (sizeNum <= 16) {
    if (ramGb >= 16) {
      return { category: 'recommended', reason: 'Fits your memory capacity for deeper reasoning.' };
    }
    return { category: 'demanding', reason: 'Requires ~12-16 GB RAM; may experience high memory swap.' };
  }
  if (ramGb >= 32) {
    return { category: 'demanding', reason: 'Large model requiring significant compute and memory.' };
  }
  return { category: 'demanding', reason: 'Exceeds recommended memory for responsive generation.' };
}

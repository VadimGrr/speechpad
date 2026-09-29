export interface EnvironmentInfo {
  supported: boolean;
  reason: string | null;
  isEdge: boolean;
  isFirefox: boolean;
  isChromium: boolean;
}

export function inspectEnvironment(
  supported: boolean,
  reason: string | null,
  userAgent = globalThis.navigator?.userAgent ?? '',
): EnvironmentInfo {
  return {
    supported,
    reason,
    isEdge: /Edg\//.test(userAgent),
    isFirefox: /Firefox\//.test(userAgent),
    isChromium: /Chrome\/|Chromium\//.test(userAgent),
  };
}

export function environmentMessage(info: EnvironmentInfo): string | null {
  if (!info.supported) {
    if (info.reason === 'insecure-context') {
      return 'Нужен защищённый адрес: https или http://127.0.0.1. Откройте приложение по локальному адресу.';
    }
    return 'Браузер не поддерживает распознавание речи. Откройте приложение в Chrome или Edge.';
  }
  if (info.isFirefox) {
    return 'В Firefox распознавание речи недоступно. Откройте приложение в Chrome или Edge.';
  }
  if (info.isEdge) {
    return 'Edge использует собственное распознавание Microsoft: задержка и качество отличаются. Для предсказуемости лучше Chrome.';
  }
  return null;
}

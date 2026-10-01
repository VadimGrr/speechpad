export class InsertJoin {
  join(fragment: string): string {
    const piece = fragment.trim().replace(/\s+/gu, ' ');
    if (!piece) return '';
    return `${piece} `;
  }
}

const plurals = new Intl.PluralRules('ru-RU');
export function plural(count: number, forms: [string, string, string]): string {
  const rule = plurals.select(count);
  return forms[rule === 'one' ? 0 : rule === 'few' ? 1 : 2];
}

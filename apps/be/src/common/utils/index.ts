export * from './i18n.util';
export * from './validation.util';

export const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, '\\$&');
export * from './parse-duration';
export * from './query-rows';
export * from './transaction';

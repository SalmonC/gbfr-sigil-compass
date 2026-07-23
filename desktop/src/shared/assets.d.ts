declare module '*.css';
declare module '*.png' {
  const source: string;
  export default source;
}

interface WebpackRequireContext {
  keys(): string[];
  (id: string): string | { default: string };
}

declare namespace NodeJS {
  interface Require {
    context(directory: string, useSubdirectories: boolean, regExp: RegExp): WebpackRequireContext;
  }
}

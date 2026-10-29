/** Vite bundles CSS imports. */
declare module "*.css";

// 013 research §0: the bundled LICENSE text, imported with Vite's ?raw suffix for the About window.
declare module "*?raw" {
  const text: string;
  export default text;
}

// 015 research §11: the third-party notices, read with Vite's import.meta.glob so a build without the file still runs.
interface ImportMeta {
  glob<T>(pattern: string, options: { query: "?raw"; import: "default"; eager: true }): Record<string, T>;
}

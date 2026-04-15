export {}

declare global {
  interface Window {
    hljs?: {
      highlight: (code: string, options: { language: string }) => { value: string }
      getLanguage: (name: string) => unknown
    }
  }
}

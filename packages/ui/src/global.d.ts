// Allow importing CSS files as side-effect imports (e.g. from node_modules)
declare module '*.css' {
  const content: Record<string, string>
  export default content
}

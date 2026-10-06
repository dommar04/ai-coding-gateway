/** Remove only the app's recognized leading wrapper, never arbitrary user XML.
 * Raw submissions remain unchanged in storage for auditing.
 */
export function displayPrompt(text: string): string {
  const wrapper =
    /^\s*<in-app-browser-context\s+source=["']ambient-ui-state["']>[^]*?<\/in-app-browser-context>\s*## My request:\s*\r?\n/;
  return text.replace(wrapper, "");
}

/** Each requested name → its first value when it is a string, else `undefined` (absent, File). */
export function textFields(formData: FormData, names: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(
    names.map((name) => {
      const value = formData.get(name);
      return [name, typeof value === "string" ? value : undefined];
    }),
  );
}

export function resolveExplicitModel<T extends { id: string }>(models: T[], value: string) {
  return value ? models.find((model) => model.id === value) : undefined;
}

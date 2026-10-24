/**
 * JSON 边界的小工具：外部接口返回值一律先当 `unknown`，再用读取器收窄。
 *
 * 这样既不用 `any`，也不会因为某个字段缺失把运行期炸掉。
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type JsonObject = { [key: string]: JsonValue };

export function asJsonObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

export function readObject(source: unknown, key: string): JsonObject | null {
  const object = asJsonObject(source);
  return object ? asJsonObject(object[key]) : null;
}

export function readString(source: unknown, key: string): string | undefined {
  const object = asJsonObject(source);
  const value = object?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function readNumber(source: unknown, key: string): number | undefined {
  const object = asJsonObject(source);
  const value = object?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(source: unknown, key: string): boolean | undefined {
  const object = asJsonObject(source);
  const value = object?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function readArray(source: unknown, key: string): unknown[] {
  const object = asJsonObject(source);
  const value = object?.[key];
  return Array.isArray(value) ? value : [];
}

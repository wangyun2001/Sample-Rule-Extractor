import type { TemplateSchemaField } from "../types/workflow";

export function normalizeSceneSchema(raw: unknown): TemplateSchemaField[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        field: String(item.field ?? ""),
        type: String(item.type ?? "string"),
        required: Boolean(item.required),
        description: String(item.description ?? "")
      }))
      .filter((item) => item.field.length > 0);
  }

  if (raw && typeof raw === "object") {
    const schemaObj = raw as Record<string, unknown>;
    const properties = schemaObj.properties;
    const requiredSet = new Set(
      Array.isArray(schemaObj.required)
        ? schemaObj.required.map((item) => String(item).trim()).filter((item) => item.length > 0)
        : []
    );

    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
      return Object.entries(properties as Record<string, unknown>)
        .map(([field, value]) => {
          const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
          return {
            field: String(field ?? "").trim(),
            type: String(item.type ?? "string"),
            required: requiredSet.has(String(field)),
            description: String(item.description ?? "")
          };
        })
        .filter((item) => item.field.length > 0);
    }

    const reserved = new Set(["type", "properties", "required", "additionalProperties", "$schema", "title"]);
    return Object.entries(schemaObj)
      .filter(([field]) => !reserved.has(field))
      .map(([field, value]) => {
        if (value && typeof value === "object") {
          const item = value as Record<string, unknown>;
          return {
            field,
            type: String(item.type ?? "string"),
            required: Boolean(item.required),
            description: String(item.description ?? "")
          };
        }
        return {
          field,
          type: "string",
          required: false,
          description: ""
        };
      })
      .filter((item) => item.field.length > 0);
  }

  return [];
}

export function getTemplateFieldList(schema: unknown): string[] {
  if (Array.isArray(schema)) {
    return schema
      .map((item) => String(item?.field ?? "").trim())
      .filter((item) => item.length > 0);
  }
  if (schema && typeof schema === "object") {
    const schemaObj = schema as Record<string, unknown>;
    const properties = schemaObj.properties;
    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
      return Object.keys(properties as Record<string, unknown>)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }

    const reserved = new Set(["type", "properties", "required", "additionalProperties", "$schema", "title"]);
    return Object.keys(schemaObj)
      .filter((item) => !reserved.has(item))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

export function getOutputFields(schema: unknown): string[] {
  return getTemplateFieldList(schema);
}

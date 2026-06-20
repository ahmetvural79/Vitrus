// src/api-hub/types.ts
// M1 Faz B — Agent-Native API Hub (Gorilla deseni). Bir API endpoint'ini retrievable + verify edilebilir
// "kart"a indirger. Gorilla şeması: {domain, api_call, api_arguments, ...} → buradaki ApiEndpointCard.

export interface ApiParam {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required: boolean;
  type?: string; // string | integer | number | boolean | array | object
  enum?: string[];
  description?: string;
}

export interface ApiEndpointCard {
  apiName: string;
  operationId: string; // slug + verify referansı (benzersiz)
  method: string; // GET | POST | PUT | PATCH | DELETE
  path: string; // /users/{id}
  baseUrl?: string;
  summary: string;
  description?: string;
  parameters: ApiParam[];
  requestBody?: { required: boolean; contentType?: string; fields?: string[] };
  auth?: string; // güvenlik şeması (varsa)
  deprecated?: boolean;
  tags?: string[];
}

export type ApiCallStatus = "valid" | "unknown_endpoint" | "missing_args" | "unknown_args" | "wrong_type" | "deprecated";

/** Deterministik çağrı doğrulama sonucu (Gorilla'nın AST-matching'inin Vitrus karşılığı). */
export interface ApiCallVerdict {
  status: ApiCallStatus;
  ok: boolean; // çalıştırmaya değer mi (valid | deprecated)
  endpoint?: string; // eşleşen operationId
  issues: string[]; // eksik/uydurma/yanlış-tip argümanlar
}

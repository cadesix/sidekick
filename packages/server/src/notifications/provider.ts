export type PushMessage = {
  token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  badge?: number;
  expiresInSeconds?: number;
  mutableContent?: boolean;
};

export type PushTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; code?: string };

export type PushReceipt =
  | { status: "ok" }
  | { status: "error"; message: string; code?: string };

export interface PushProvider {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  receipts(ids: string[]): Promise<Record<string, PushReceipt>>;
  validToken(token: string): boolean;
}

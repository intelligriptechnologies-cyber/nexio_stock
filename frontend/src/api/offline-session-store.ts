import type {
  OfflineCatalogItem,
  OfflineReceiptPayload,
  OfflineSessionPublic,
  OfflineSessionStartResponse,
} from "./offline-sessions";

export interface StoredOfflineSession {
  session: OfflineSessionPublic;
  offlineToken: string;
  catalog: OfflineCatalogItem[];
}

interface StoredReceipt extends OfflineReceiptPayload {
  session_id: number;
}

const DB_NAME = "barstock-offline-sessions";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const RECEIPT_STORE = "receipts";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "session.id" });
      }
      if (!db.objectStoreNames.contains(RECEIPT_STORE)) {
        const store = db.createObjectStore(RECEIPT_STORE, { keyPath: "temp_receipt_id" });
        store.createIndex("session_id", "session_id", { unique: false });
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

async function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (db: IDBDatabase, transaction: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await openDb();
  try {
    const transaction = db.transaction(stores, mode);
    const result = await run(db, transaction);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally {
    db.close();
  }
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

export async function saveStartedOfflineSession(
  response: OfflineSessionStartResponse
): Promise<StoredOfflineSession> {
  const record: StoredOfflineSession = {
    session: response.session,
    offlineToken: response.offline_token,
    catalog: response.catalog,
  };
  await tx([SESSION_STORE], "readwrite", (_db, transaction) => {
    transaction.objectStore(SESSION_STORE).put(record);
  });
  return record;
}

export async function saveStoredOfflineSession(record: StoredOfflineSession): Promise<void> {
  await tx([SESSION_STORE], "readwrite", (_db, transaction) => {
    transaction.objectStore(SESSION_STORE).put(record);
  });
}

export async function updateStoredOfflineSession(
  session: OfflineSessionPublic,
  offlineToken: string
): Promise<StoredOfflineSession> {
  const existing = await loadOpenOfflineSession();
  if (!existing || existing.session.id !== session.id) {
    throw new Error("offline session is not stored locally");
  }
  const next: StoredOfflineSession = { ...existing, session, offlineToken };
  await saveStoredOfflineSession(next);
  return next;
}

export async function loadOpenOfflineSession(): Promise<StoredOfflineSession | null> {
  const db = await openDb();
  try {
    const transaction = db.transaction([SESSION_STORE], "readonly");
    const store = transaction.objectStore(SESSION_STORE);
    const req = store.getAll();
    const rows = await reqToPromise<StoredOfflineSession[]>(req);
    return rows.find((row) => ["active", "failed", "syncing"].includes(row.session.state)) ?? null;
  } finally {
    db.close();
  }
}

export async function addOfflineReceipt(
  sessionId: number,
  receipt: OfflineReceiptPayload
): Promise<void> {
  await tx([RECEIPT_STORE], "readwrite", (_db, transaction) => {
    const row: StoredReceipt = { ...receipt, session_id: sessionId };
    transaction.objectStore(RECEIPT_STORE).put(row);
  });
}

export async function listOfflineReceipts(sessionId: number): Promise<OfflineReceiptPayload[]> {
  const db = await openDb();
  try {
    const transaction = db.transaction([RECEIPT_STORE], "readonly");
    const index = transaction.objectStore(RECEIPT_STORE).index("session_id");
    const rows = await reqToPromise<StoredReceipt[]>(index.getAll(sessionId));
    return rows
      .sort((a, b) => a.temp_receipt_id.localeCompare(b.temp_receipt_id))
      .map((row) => ({
        temp_receipt_id: row.temp_receipt_id,
        idempotency_key: row.idempotency_key,
        lines: row.lines,
        payments: row.payments,
        note: row.note,
        created_at: row.created_at,
      }));
  } finally {
    db.close();
  }
}

export async function clearOfflineSessionData(sessionId: number): Promise<void> {
  const receipts = await listOfflineReceipts(sessionId);
  await tx([SESSION_STORE, RECEIPT_STORE], "readwrite", (_db, transaction) => {
    transaction.objectStore(SESSION_STORE).delete(sessionId);
    const receiptStore = transaction.objectStore(RECEIPT_STORE);
    for (const receipt of receipts) {
      receiptStore.delete(receipt.temp_receipt_id);
    }
  });
}

// JWT payload decoder. We do NOT verify the signature here — the backend
// (R-21) is the security boundary. The frontend just needs the role to
// decide which screens to render. Any tampering with the local copy is
// rejected at the next API call.
export interface JwtPayload {
  sub: string;
  shop_id: number | null;
  role: "superadmin" | "owner" | "receiver_user" | "cashier_user";
  exp: number;
  iat?: number;
}

export function decodeJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded + "==".slice((padded.length + 3) % 4));
    const payload = JSON.parse(json) as JwtPayload;
    if (typeof payload.sub !== "string" || typeof payload.role !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

export function isExpired(payload: JwtPayload, skewSeconds = 5): boolean {
  return payload.exp * 1000 < Date.now() - skewSeconds * 1000;
}
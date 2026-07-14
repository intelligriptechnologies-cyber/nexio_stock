export const APPROVALS_CHANGED_EVENT = "nexio:approvals-changed";

export function notifyApprovalsChanged(): void {
  window.dispatchEvent(new Event(APPROVALS_CHANGED_EVENT));
}

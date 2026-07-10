export const VOID_APPROVALS_CHANGED_EVENT = "nexio:void-approvals-changed";

export function notifyVoidApprovalsChanged(): void {
  window.dispatchEvent(new Event(VOID_APPROVALS_CHANGED_EVENT));
}

// Attach auth/agent identity to the Express request object.
declare global {
  namespace Express {
    interface Request {
      user?: { uid: string; tid: string };
      agent?: { id: string; tenant_id: string };
    }
  }
}
export {};

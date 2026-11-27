// Global API audit middleware: records WHO, WHICH endpoint, WHEN, IP address, and outcome.
// Never logs request bodies, tokens, passwords, or study record content.
export function auditMiddleware(audit) {
  return (req, res, next) => {
    const endpoint = `${req.method} ${req.baseUrl || ''}${req.path || ''}`.trim();
    const ipAddress = req.ip || req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

    res.on('finish', () => {
      const outcome = res.statusCode === 401 || res.statusCode === 403
        ? 'denied'
        : res.statusCode >= 400
          ? 'failure'
          : 'success';

      try {
        audit.log({
          actorId: req.user?.id || null,
          action: 'api.access',
          entityType: 'endpoint',
          entityId: endpoint,
          outcome,
          endpoint,
          ipAddress,
        });
      } catch {
        // Never crash response lifecycle on audit write error
      }
    });

    next();
  };
}

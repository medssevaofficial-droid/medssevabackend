import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const requirePermission = (permission: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    if (req.user.role === 'SUPER_ADMIN') return next();

    const perms = req.user.permissions || [];
    if (perms.includes('*') || perms.includes(permission)) return next();

    return res.status(403).json({
      error: 'Forbidden',
      message: `You do not have permission: ${permission}`,
    });
  };
};
/**
 * Log important admin actions to AuditLog table.
 */
export const auditLog = (action: string, module: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.id) {
      try {
        await prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action,
            module,
            details: { body: req.body, params: req.params },
            ipAddress: req.ip || req.socket.remoteAddress || '',
            userAgent: req.headers['user-agent'] || '',
          },
        });
      } catch (e) {
        console.error('AuditLog error:', e);
      }
    }
    next();
  };
};
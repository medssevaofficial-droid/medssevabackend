import { Router } from 'express';
import { register, registerPartner, login, getAllUsers, checkMobile, getPartners, updatePartnerApproval, getAvailablePartners, getMe } from '../controllers/authController';
import { authenticate, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();

// Public
router.get('/check-mobile', checkMobile);
router.post('/register', register);
router.post('/register/partner', registerPartner);
router.post('/login', login);

router.get('/me', authenticate, getMe);

// Admin only
router.get('/users', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), getAllUsers);
router.get('/partners', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), getPartners);
router.patch('/partners/:id/approval', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), updatePartnerApproval);
router.get('/partners/available', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), getAvailablePartners);

export default router;
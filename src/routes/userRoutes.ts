import { Router } from 'express';
import { getMe, updateMe, addFamilyMember, removeFamilyMember } from '../controllers/userController';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

// All user routes require authentication
router.use(authenticate);

router.get('/me', getMe);
router.patch('/me', updateMe);
router.post('/family', addFamilyMember);
router.delete('/family/:id', removeFamilyMember);

export default router;

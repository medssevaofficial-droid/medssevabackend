import { Router } from 'express';
import { getPaymentMethods, addPaymentMethod, removePaymentMethod } from '../controllers/paymentMethodController';

const router = Router();

router.get('/', getPaymentMethods);
router.post('/', addPaymentMethod);
router.delete('/:id', removePaymentMethod);

export default router;

import { Router } from 'express';
import {
  getPaymentMethods,
  addPaymentMethod,
  setDefaultPaymentMethod,
  removePaymentMethod,
} from '../controllers/paymentMethodController';

const router = Router();

router.get('/', getPaymentMethods);
router.post('/', addPaymentMethod);
router.patch('/:id/default', setDefaultPaymentMethod);
router.delete('/:id', removePaymentMethod);

export default router;
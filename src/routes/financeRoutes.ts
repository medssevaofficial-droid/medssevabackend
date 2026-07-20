import { Router } from 'express';
import {
  getPaymentSummary,
  getPayments,
  getPaymentById,
  createRazorpayOrder,
  verifyPayment,
  handleRazorpayWebhook,
  getRefunds,
  requestRefund,
  approveRefund,
  rejectRefund,
  getSettlements,
  generateSettlements,
  processSettlement,
} from '../controllers/financeController';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

router.post('/webhook/razorpay', handleRazorpayWebhook);

router.use(authenticate);

router.get('/payment-summary', getPaymentSummary);
router.get('/payments', getPayments);
router.get('/payments/:id', getPaymentById);
router.post('/payments/create-order', createRazorpayOrder);
router.post('/payments/verify', verifyPayment);

router.get('/refunds', getRefunds);
router.post('/refunds', requestRefund);
router.post('/refunds/:id/approve', approveRefund);
router.post('/refunds/:id/reject', rejectRefund);

router.get('/settlements', getSettlements);
router.post('/settlements/generate', generateSettlements);
router.post('/settlements/:id/process', processSettlement);

export default router;
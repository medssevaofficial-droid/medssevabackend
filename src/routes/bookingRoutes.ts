import { Router } from 'express';
import { getAllBookings, createBooking, updateBookingStatus, createRazorpayOrder, updatePaymentStatus, assignExecutive, assignPartner, generatePaymentLink, checkPaymentLinkStatus, collectSample, getAvailableSlots, generateCollectionOtp, verifyCollectionOtp, razorpayWebhook } from '../controllers/bookingController';
import { authenticate, authorizeRoles } from '../middlewares/authMiddleware';
import { strictLimiter } from '../middlewares/rateLimiter';
import { validateRequest } from '../middlewares/validateRequest';
import { createBookingSchema } from '../validators/schemas';

const router = Router();

router.get('/available-slots', getAvailableSlots); // Public — no auth needed
router.post('/webhook/razorpay', razorpayWebhook);  // Public — Razorpay calls this directly
router.get('/', authenticate, getAllBookings);
router.post('/', strictLimiter, authenticate, validateRequest(createBookingSchema), createBooking);
router.patch('/:id/status', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), updateBookingStatus);
// Payment: ADMIN for lab, ADMIN or EXECUTIVE for home (controller handles the distinction)
router.patch('/:id/payment', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN', 'EXECUTIVE'), updatePaymentStatus);
router.patch('/:id/assign-executive', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), assignExecutive);
router.patch('/:id/assign-partner', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), assignPartner);

// Assign executive: ADMIN only
router.patch('/:id/assign-executive', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), assignExecutive);
router.post('/razorpay/create-order', strictLimiter, createRazorpayOrder);

// QR-based payment collection (Cash-at-doorstep / Lab-counter)
router.post('/:id/payment-link', authenticate, authorizeRoles('ADMIN', 'PATHOLOGIST', 'EXECUTIVE'), generatePaymentLink);
router.get('/:id/payment-link/status', authenticate, authorizeRoles('ADMIN', 'PATHOLOGIST', 'EXECUTIVE'), checkPaymentLinkStatus);

// Enforced sample collection (blocks if payment pending)
router.patch('/:id/collect-sample', authenticate, authorizeRoles('ADMIN', 'PATHOLOGIST', 'EXECUTIVE'), collectSample);
router.get('/:id/collection-otp', authenticate, generateCollectionOtp);
router.post('/:id/verify-otp', authenticate, authorizeRoles('PATHOLOGY_PARTNER'), verifyCollectionOtp);

export default router;
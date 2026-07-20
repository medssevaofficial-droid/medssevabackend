import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middlewares/authMiddleware';
import {
  getPartnerBookings,
  getPartnerNotifications,
  getPartnerHistory,
  acceptBooking,
  rejectBooking,
  updateBookingStatus,
  collectCash,
  initiateUpiCollection,
  checkUpiPaymentStatus,
  toggleAvailability,
  getPartnerProfile,
  getPartnerStats,
} from '../controllers/partnerController';

const router = Router();

// All routes require PATHOLOGY_PARTNER role
router.use(authenticate, authorizeRoles('PATHOLOGY_PARTNER'));

router.get('/notifications', getPartnerNotifications);
router.get('/bookings', getPartnerBookings);
router.patch('/bookings/:id/accept', acceptBooking);
router.patch('/bookings/:id/reject', rejectBooking);
router.patch('/bookings/:id/status', updateBookingStatus);
router.post('/bookings/:id/collect-cash', collectCash);
router.post('/bookings/:id/collect-upi', initiateUpiCollection);
router.get('/bookings/:id/upi-status', checkUpiPaymentStatus);
router.patch('/availability', toggleAvailability);
router.get('/history', getPartnerHistory);
router.get('/profile', getPartnerProfile);
router.get('/stats', getPartnerStats);

export default router;
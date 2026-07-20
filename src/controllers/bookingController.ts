import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import Razorpay from 'razorpay';
import crypto from 'crypto';

const prisma = new PrismaClient();

let razorpay: any;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// Lab working hours — all possible slots in a day
const ALL_SLOTS = [
  '06:00 AM - 07:00 AM',
  '07:00 AM - 08:00 AM',
  '08:00 AM - 09:00 AM',
  '09:00 AM - 10:00 AM',
  '10:00 AM - 11:00 AM',
  '11:00 AM - 12:00 PM',
  '12:00 PM - 01:00 PM',
  '01:00 PM - 02:00 PM',
  '02:00 PM - 03:00 PM',
  '03:00 PM - 04:00 PM',
  '04:00 PM - 05:00 PM',
  '05:00 PM - 06:00 PM',
  '06:00 PM - 07:00 PM',
  '07:00 PM - 08:00 PM',
  '08:00 PM - 09:00 PM',
];

/**
 * Parses a slot string like "06:00 AM - 07:00 AM"
 * Returns { startMinutes, endMinutes } as minutes from midnight
 */
const parseSlotMinutes = (slot: string): { startMinutes: number; endMinutes: number } | null => {
  const parts = slot.split(' - ');
  if (parts.length !== 2) return null;

  const toMinutes = (timeStr: string): number => {
    const [timePart, meridiem] = timeStr.trim().split(' ');
    const [hourStr, minuteStr] = timePart.split(':');
    let hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    if (meridiem === 'PM' && hour !== 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    return hour * 60 + minute;
  };

  return {
    startMinutes: toMinutes(parts[0]),
    endMinutes: toMinutes(parts[1]),
  };
};

export const getAvailableSlots = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;

    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: 'date query parameter is required (format: YYYY-MM-DD)' });
    }

    const requestedDate = new Date(date);
    if (isNaN(requestedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    // Reject past dates entirely
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const requestedMidnight = new Date(
      requestedDate.getFullYear(),
      requestedDate.getMonth(),
      requestedDate.getDate()
    );

    if (requestedMidnight < todayMidnight) {
      return res.status(400).json({
        error: 'Cannot fetch slots for a past date.',
        availableSlots: [],
        isToday: false,
      });
    }

    const isToday = requestedMidnight.getTime() === todayMidnight.getTime();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Filter slots: for today, remove slots whose start time has already passed
    let availableSlots = ALL_SLOTS.filter((slot) => {
      if (!isToday) return true; // future date — all slots valid
      const parsed = parseSlotMinutes(slot);
      if (!parsed) return false;
      // Slot is valid only if its start time is strictly in the future
      return parsed.startMinutes > currentMinutes;
    });

    // Remove slots that are already booked (prevent overbooking)
    // Adjust MAX_BOOKINGS_PER_SLOT based on your lab capacity
    const MAX_BOOKINGS_PER_SLOT = 5;

    const bookingsForDate = await prisma.booking.findMany({
      where: {
        scheduledDate: {
          gte: new Date(requestedMidnight),
          lt: new Date(requestedMidnight.getTime() + 24 * 60 * 60 * 1000),
        },
        status: { notIn: ['CANCELLED'] },
      },
      select: { scheduledSlot: true },
    });

    // Count bookings per slot
    const slotBookingCount: Record<string, number> = {};
    for (const booking of bookingsForDate) {
      slotBookingCount[booking.scheduledSlot] =
        (slotBookingCount[booking.scheduledSlot] || 0) + 1;
    }

    // Remove fully booked slots
    availableSlots = availableSlots.filter(
      (slot) => (slotBookingCount[slot] || 0) < MAX_BOOKINGS_PER_SLOT
    );

    return res.json({
      date,
      isToday,
      availableSlots,
      totalSlotsForDay: ALL_SLOTS.length,
      currentTime: isToday
        ? `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
        : null,
    });
  } catch (error: any) {
    console.error('Error fetching available slots:', error);
    res.status(500).json({ error: 'Failed to fetch available slots', details: error.message });
  }
};

export const getAllBookings = async (req: any, res: Response) => {
  try {
    const { mobile, id } = req.query;
    const where: any = {};
    
// Scoped visibility per role
if (req.user.role === 'EXECUTIVE') {
      // Executive sees only their assigned HOME bookings
      where.assignedExecutiveId = req.user.id;
      where.collectionMode = 'HOME';
    } else if (!['ADMIN', 'SUPER_ADMIN', 'PATHOLOGIST'].includes(req.user.role)) {
      // Regular USER sees only their own bookings
      where.userId = req.user.id;
    } else {
      // ADMIN / PATHOLOGIST see all, with optional mobile filter
      if (mobile) {
        where.user = { mobile: String(mobile) };
      }
    }
    if (id) {
      where.id = String(id);
    }

const bookings = await prisma.booking.findMany({
      where,
      include: {
        user: true,
        tests: {
          include: { test: true }
        },
        packages: {
          include: { package: true }
        },
        report: {
          include: { parameters: true }
        },
        assignedPartner: {
          include: {
            user: {
              select: {
                name: true,
                mobile: true,
                avatarUrl: true,
              }
            }
          }
        },
        statusTimeline: {
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const bookingsWithAddress = await Promise.all(bookings.map(async (b) => {
      const address = await prisma.address.findUnique({
        where: { id: b.addressId }
      });
      return {
        ...b,
        address
      };
    }));

    res.json(bookingsWithAddress);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
};

export const createRazorpayOrder = async (req: Request, res: Response) => {
  try {
    if (!razorpay) {
      throw new Error('Razorpay is not configured. Missing API keys in environment variables.');
    }
    const { amount } = req.body;

    const options = {
      amount: Math.round(Number(amount) * 100), // convert to paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error: any) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ error: 'Failed to create Razorpay order', details: error.message });
  }
};

const mapPaymentMethodToMode = (paymentMethod: string | undefined): 'CASH' | 'UPI' | undefined => {
  if (paymentMethod === 'cash') return 'CASH';
  if (paymentMethod === 'upi') return 'UPI';
  // 'lab_walkin' -> undefined, decided later at the branch counter
  return undefined;
};
const generateBookingCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const prefix = 'MS';
  let code = prefix;
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export const createBooking = async (req: any, res: Response) => {
  try {
  const { 
      tests,
      scheduledDate, 
      scheduledSlot, 
      totalPaid, 
      patientName,
      patientAge,
      patientGender,
      mobile, 
      addressId,
      branchId,
      collectionMode,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      paymentMethod
  } = req.body;
  const safeTests = Array.isArray(tests) ? tests : [];
    const safeCollectionMode = collectionMode === 'lab' ? 'LAB' : 'HOME';
    console.log('📦 Received Booking Payload:', req.body);

    // Verify Payment Signature for Online Payments
    if (razorpay_payment_id && razorpay_order_id && razorpay_signature) {
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
        .update(body.toString())
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ error: 'Invalid payment signature' });
      }
    }

// 1. Use authenticated user directly — prevents IDOR
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });
    if (!user) {
      return res.status(401).json({ error: 'Authenticated user not found' });
    }

    // 1.5 Create fallback category if not exists
    await prisma.testCategory.upsert({
      where: { id: 'general' },
      update: {},
    create: { id: 'general', name: 'General', iconName: 'activity', slug: 'general' }
    });

    // 1.6 Upsert tests from frontend payload so relations work
  for (const item of safeTests) {
      if (item.testId || item.id) {
        const tId = item.testId || item.id;
        await prisma.test.upsert({
          where: { id: tId },
          update: { 
            name: item.name, 
            price: Number(item.price) || 0, 
            discountedPrice: Number(item.discountedPrice) || Number(item.price) || 0 
          },
          create: {
            id: tId,
            name: item.name || 'Unknown Test',
            description: item.name || 'Auto-created test',
            price: Number(item.price) || 0,
            discountedPrice: Number(item.discountedPrice) || Number(item.price) || 0,
            categoryId: 'general',
            reportTime: '24 Hours',
            fastingRequired: false,
          }
        });
      }
    }

// 2. Resolve branch (LAB mode) or user address (HOME mode)
    let finalAddressId = addressId;
    let finalBranchId: string | undefined;

    if (collectionMode === 'lab' || addressId === 'LAB_WALKIN') {
      if (!branchId) {
        return res.status(400).json({ error: 'branchId is required for Lab Visit bookings.' });
      }
      const branch = await prisma.branch.findUnique({ where: { id: branchId } });
      if (!branch || !branch.isActive) {
        return res.status(400).json({ error: 'Selected branch is invalid or inactive.' });
      }
      finalBranchId = branch.id;

      // Mirror branch address into an Address row so addressId stays valid
      const centerAddr = await prisma.address.findFirst({
        where: { userId: user.id, type: 'CENTER', line1: branch.line1 }
      }) || await prisma.address.create({
        data: {
          userId: user.id,
          type: 'CENTER',
          line1: branch.line1,
          city: branch.city,
          state: branch.state,
          pincode: branch.pincode,
        }
      });
      finalAddressId = centerAddr.id;
    } else if (!finalAddressId) {
      const defaultAddr = await prisma.address.findFirst({
        where: { userId: user.id },
        orderBy: { isDefault: 'desc' }
      });
      if (defaultAddr) {
        finalAddressId = defaultAddr.id;
} else {
        return res.status(400).json({ error: 'No address found for this user. Please add an address before booking.' });
      }
    }
    
// 3. Parse date safely
    let parsedDate = new Date(scheduledDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid booking date provided.' });
    }

    // 3.5 Date/Time validation — reject past dates and expired slots
    const now = new Date();

    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const bookingMidnight = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());

    if (bookingMidnight < todayMidnight) {
      return res.status(400).json({ error: 'Booking date cannot be in the past.' });
    }

    if (bookingMidnight.getTime() === todayMidnight.getTime() && scheduledSlot) {
      // Parse slot end time e.g. "03:00 PM - 04:00 PM" → end = "04:00 PM"
      const slotEndPart = scheduledSlot.split(' - ')[1];
      if (slotEndPart) {
        const [timePart, meridiem] = slotEndPart.trim().split(' ');
        const [hourStr, minuteStr] = timePart.split(':');
        let hour = parseInt(hourStr, 10);
        const minute = parseInt(minuteStr, 10);
        if (meridiem === 'PM' && hour !== 12) hour += 12;
        if (meridiem === 'AM' && hour === 12) hour = 0;

        const slotEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
        if (slotEnd <= now) {
          return res.status(400).json({ error: 'This time slot has already passed. Please select another slot.' });
        }
      }
    }

// 4. Create booking
    const resolvedPaymentMode = mapPaymentMethodToMode(paymentMethod);

// Generate unique booking code with collision check
    let bookingCode = generateBookingCode();
    let codeExists = await prisma.booking.findUnique({ where: { bookingCode } });
    while (codeExists) {
      bookingCode = generateBookingCode();
      codeExists = await prisma.booking.findUnique({ where: { bookingCode } });
    }

const testItems = safeTests.filter((item: any) => item.itemType === 'test' || !item.itemType);
    const packageItems = safeTests.filter((item: any) => item.itemType === 'package');

    const booking = await prisma.booking.create({
      data: {
        bookingCode,
        userId: user.id,
        scheduledDate: parsedDate,
        scheduledSlot: scheduledSlot || 'Anytime',
        totalPaid: Number(totalPaid) || 0,
        patientName: patientName || user.name || 'Guest',
        patientAge: patientAge ? Number(patientAge) : null,
        patientGender: patientGender || null,
        patientMobile: mobile || user.mobile || null,
    status: razorpay_payment_id
          ? (safeCollectionMode === 'HOME' ? 'WAITING_FOR_PARTNER' : 'CONFIRMED')
          : (safeCollectionMode === 'HOME' ? 'WAITING_FOR_PARTNER' : 'PENDING'),
        paymentStatus: razorpay_payment_id ? 'SUCCESS' : 'PENDING',
        collectionMode: safeCollectionMode as any,
        addressId: finalAddressId,
        branchId: finalBranchId,
        paymentMode: razorpay_payment_id ? 'UPI' : (resolvedPaymentMode as any),
        paymentId: razorpay_payment_id || undefined,
        razorpayOrderId: razorpay_order_id || undefined,
        tests: {
          create: testItems.map((item: any) => ({
            testId: item.testId || item.id
          }))
        },
        packages: {
          create: packageItems.map((item: any) => ({
            packageId: item.id
          }))
        }
      },
  include: {
        tests: true,
        user: true,
      }
    });
    console.log('✅ Booking Created Successfully:', booking.id);
    res.status(201).json(booking);
  } catch (error: any) {
    console.error('❌ CRITICAL ERROR creating booking:', error);
    res.status(500).json({ 
      error: 'Failed to create booking', 
      details: error.message 
    });
  }
};

export const updateBookingStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Ensure status matches Prisma enum (uppercase)
    const upperStatus = status ? status.toUpperCase() : undefined;

    const booking = await prisma.booking.update({
      where: { id },
      data: { status: upperStatus },
    });
    
    res.json(booking);
  } catch (error: any) {
    console.error('Failed to update booking status:', error);
    res.status(500).json({ error: 'Failed to update status', details: error.message });
  }
};

export const updatePaymentStatus = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { paymentStatus, paymentMode } = req.body;

    if (!paymentStatus) {
      return res.status(400).json({ error: 'paymentStatus is required.' });
    }

    const upperStatus = paymentStatus.toUpperCase();
    const validStatuses = ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'];
    if (!validStatuses.includes(upperStatus)) {
      return res.status(400).json({ error: `Invalid paymentStatus. Must be one of: ${validStatuses.join(', ')}` });
    }

    // Fetch booking to check collectionMode and current state
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    // Prevent duplicate payment marking
    if (booking.paymentStatus === 'SUCCESS') {
      return res.status(400).json({ error: 'Payment has already been marked as received for this booking.' });
    }

    const actorRole = req.user.role;
    const actorId = req.user.id;

    // Role-based permission check
const isAdminLevel = ['ADMIN', 'SUPER_ADMIN', 'PATHOLOGIST'].includes(actorRole);
    if (booking.collectionMode === 'LAB') {
      if (!isAdminLevel) {
        return res.status(403).json({ error: 'Only Pathology Admin can mark payment received for Lab Visit bookings.' });
      }
    } else if (booking.collectionMode === 'HOME') {
      const isAssignedExecutive = actorRole === 'EXECUTIVE' && booking.assignedExecutiveId === actorId;
      if (!isAssignedExecutive && !isAdminLevel) {
        return res.status(403).json({ error: 'Only the assigned Collection Executive or Admin can mark payment for Home Collection bookings.' });
      }
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        paymentStatus: upperStatus as any,
        paymentMode: paymentMode ? paymentMode.toUpperCase() as any : undefined,
        paymentReceivedAt: upperStatus === 'SUCCESS' ? new Date() : undefined,
        paymentReceivedById: upperStatus === 'SUCCESS' ? actorId : undefined,
        // Auto-confirm booking when payment received
        status: upperStatus === 'SUCCESS' ? 'CONFIRMED' : undefined,
      },
    });

    console.log(`✅ Payment marked ${upperStatus} for booking ${id} by ${actorRole} ${actorId}`);
    res.json(updated);
  } catch (error: any) {
    console.error('Failed to update payment status:', error);
    res.status(500).json({ error: 'Failed to update payment status', details: error.message });
  }
};

export const generatePaymentLink = async (req: any, res: Response) => {
  try {
    if (!razorpay) {
      return res.status(500).json({ error: 'Razorpay is not configured on the server.' });
    }
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id }, include: { user: true } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    if (booking.paymentStatus === 'SUCCESS') {
      return res.status(400).json({ error: 'Payment has already been received for this booking.' });
    }

    const actorRole = req.user.role;
    const actorId = req.user.id;
    if (booking.collectionMode === 'LAB' && !['ADMIN', 'PATHOLOGIST'].includes(actorRole)) {
      return res.status(403).json({ error: 'Only Admin/Pathologist can generate payment QR for Lab Visit bookings.' });
    }
    if (booking.collectionMode === 'HOME') {
      const isAssignedExecutive = actorRole === 'EXECUTIVE' && booking.assignedExecutiveId === actorId;
      if (!isAssignedExecutive && actorRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Only the assigned Executive or Admin can generate payment QR for Home Collection bookings.' });
      }
    }

    const link = await razorpay.paymentLink.create({
      amount: Math.round(Number(booking.totalPaid) * 100),
      currency: 'INR',
      description: `MedsSeva Booking #${booking.id.substring(0, 8).toUpperCase()}`,
      customer: {
        name: booking.patientName,
        contact: booking.user.mobile,
      },
      notify: { sms: false, email: false },
    });

    await prisma.booking.update({
      where: { id },
      data: { paymentLinkId: link.id, paymentLinkUrl: link.short_url },
    });

    res.json({ paymentLinkId: link.id, paymentLinkUrl: link.short_url });
  } catch (error: any) {
    console.error('Failed to generate payment link:', error);
    res.status(500).json({ error: 'Failed to generate payment QR', details: error.message });
  }
};

export const checkPaymentLinkStatus = async (req: any, res: Response) => {
  try {
    if (!razorpay) {
      return res.status(500).json({ error: 'Razorpay is not configured on the server.' });
    }
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (!booking.paymentLinkId) {
      return res.status(400).json({ error: 'No payment QR has been generated for this booking yet.' });
    }

    if (booking.paymentStatus === 'SUCCESS') {
      return res.json({ paymentStatus: 'SUCCESS', booking });
    }

    const link = await razorpay.paymentLink.fetch(booking.paymentLinkId);

    if (link.status === 'paid') {
      const updated = await prisma.booking.update({
        where: { id },
        data: {
          paymentStatus: 'SUCCESS',
          paymentReceivedAt: new Date(),
          paymentReceivedById: req.user.id,
          status: 'CONFIRMED',
        },
      });
      return res.json({ paymentStatus: 'SUCCESS', booking: updated });
    }

    res.json({ paymentStatus: 'PENDING', booking });
  } catch (error: any) {
    console.error('Failed to check payment link status:', error);
    res.status(500).json({ error: 'Failed to verify payment', details: error.message });
  }
};

export const collectSample = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    const actorRole = req.user.role;
    const actorId = req.user.id;

const isAdminLevel = ['ADMIN', 'SUPER_ADMIN', 'PATHOLOGIST'].includes(actorRole);
    if (booking.collectionMode === 'HOME') {
      const isAssignedExecutive = actorRole === 'EXECUTIVE' && booking.assignedExecutiveId === actorId;
      if (!isAssignedExecutive && !isAdminLevel) {
        return res.status(403).json({ error: 'Only the assigned Executive or Admin can mark sample collected.' });
      }
    } else if (!isAdminLevel) {
      return res.status(403).json({ error: 'Only Admin/Pathologist can mark sample collected for Lab Visit bookings.' });
    }

    if (booking.paymentStatus !== 'SUCCESS') {
      return res.status(400).json({ error: 'Payment must be received before sample collection can begin.' });
    }

const updated = await prisma.booking.update({
      where: { id },
      data: { status: 'SAMPLE_COLLECTED' },
    });

    await prisma.bookingStatusLog.create({
      data: {
        bookingId: id,
        status: 'SAMPLE_COLLECTED',
        note: 'Sample collected and confirmed',
        updatedBy: actorId,
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Failed to mark sample collected:', error);
    res.status(500).json({ error: 'Failed to mark sample collected', details: error.message });
  }
};

export const assignPartner = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { partnerId } = req.body;

    if (!partnerId) {
      return res.status(400).json({ error: 'partnerId is required.' });
    }

    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only Admin can assign partners.' });
    }

    const partner = await prisma.pathologyPartner.findUnique({
      where: { id: partnerId },
      include: { user: true }
    });
    if (!partner) return res.status(404).json({ error: 'Partner not found.' });
    if (partner.approvalStatus !== 'APPROVED') {
      return res.status(400).json({ error: 'Partner is not approved.' });
    }
    if (!partner.isAvailable) {
      return res.status(400).json({ error: 'Partner is not currently available.' });
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.collectionMode !== 'HOME') {
      return res.status(400).json({ error: 'Partners can only be assigned to Home Collection bookings.' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        assignedPartnerId: partnerId,
        partnerAssignedAt: new Date(),
        status: 'ASSIGNED',
      },
    });

    await prisma.bookingStatusLog.create({
      data: {
        bookingId: id,
        status: 'ASSIGNED',
        note: `Partner ${partner.user.name} assigned`,
        updatedBy: req.user.id,
      }
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Failed to assign partner:', error);
    res.status(500).json({ error: 'Failed to assign partner', details: error.message });
  }
};

// Generate 4-digit OTP when partner accepts (pay-at-doorstep only)
export const generateCollectionOtp = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    // Only generate OTP if payment is still pending (pay at doorstep)
    if (booking.paymentStatus === 'SUCCESS') {
      return res.json({ otpRequired: false, message: 'Already paid online. No OTP needed.' });
    }

    // Generate only if not already generated
    if (booking.collectionOtp) {
      return res.json({ otpRequired: true, otp: booking.collectionOtp });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    await prisma.booking.update({
      where: { id },
      data: { collectionOtp: otp },
    });

    res.json({ otpRequired: true, otp });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate OTP', details: error.message });
  }
};

// Partner verifies OTP entered by user
export const verifyCollectionOtp = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;

    const partner = await prisma.pathologyPartner.findUnique({ where: { userId: req.user.id } });
    if (!partner) return res.status(404).json({ error: 'Partner not found.' });

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.assignedPartnerId !== partner.id) {
      return res.status(403).json({ error: 'Not your booking.' });
    }
    if (booking.otpVerified) {
      return res.json({ verified: true, message: 'OTP already verified.' });
    }
    if (booking.collectionOtp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP. Please ask the patient to check again.' });
    }

    await prisma.booking.update({
      where: { id },
      data: { otpVerified: true },
    });

    res.json({ verified: true, message: 'OTP verified. Payment screen unlocked.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to verify OTP', details: error.message });
  }
};

// Razorpay Webhook — auto-updates payment status when UPI payment completes
export const razorpayWebhook = async (req: Request, res: Response) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('RAZORPAY_WEBHOOK_SECRET not set');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    // Verify webhook signature
    const signature = req.headers['x-razorpay-signature'] as string;
    const body = (req as any).rawBody; // raw body set by express middleware below
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.warn('Invalid Razorpay webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    const eventType = event.event;

    console.log(`📡 Razorpay Webhook: ${eventType}`);

    // Payment link paid — UPI collection at doorstep
    if (eventType === 'payment_link.paid') {
      const paymentLinkId = event.payload?.payment_link?.entity?.id;
      if (!paymentLinkId) return res.json({ status: 'ok' });

      const booking = await prisma.booking.findFirst({
        where: { paymentLinkId },
      });

      if (!booking) {
        console.warn(`No booking found for paymentLinkId: ${paymentLinkId}`);
        return res.json({ status: 'ok' });
      }

      if (booking.paymentStatus !== 'SUCCESS') {
        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            paymentStatus: 'SUCCESS',
            paymentMode: 'UPI',
            paymentReceivedAt: new Date(),
          },
        });

        await prisma.bookingStatusLog.create({
          data: {
            bookingId: booking.id,
            status: booking.status as any,
            note: 'UPI payment confirmed via Razorpay webhook',
          },
        });

        console.log(`✅ Payment auto-confirmed for booking ${booking.id} via webhook`);
      }

      return res.json({ status: 'ok' });
    }

    // Payment failed
    if (eventType === 'payment.failed') {
      const paymentLinkId = event.payload?.payment?.entity?.payment_link_id;
      if (paymentLinkId) {
        const booking = await prisma.booking.findFirst({ where: { paymentLinkId } });
        if (booking && booking.paymentStatus !== 'SUCCESS') {
          await prisma.bookingStatusLog.create({
            data: {
              bookingId: booking.id,
              status: booking.status as any,
              note: `UPI payment failed: ${event.payload?.payment?.entity?.error_description || 'Unknown error'}`,
            },
          });
          console.warn(`❌ Payment failed for booking ${booking.id}`);
        }
      }
      return res.json({ status: 'ok' });
    }

    // All other events — acknowledge
    res.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed', details: error.message });
  }
};

export const assignExecutive = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { executiveId } = req.body;

    if (!executiveId) {
      return res.status(400).json({ error: 'executiveId is required.' });
    }

// Only ADMIN / SUPER_ADMIN can assign
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only Admin can assign executives.' });
    }

    const executive = await prisma.user.findUnique({ where: { id: executiveId } });
    if (!executive || executive.role !== 'EXECUTIVE') {
      return res.status(400).json({ error: 'Provided user is not a valid Executive.' });
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.collectionMode !== 'HOME') {
      return res.status(400).json({ error: 'Executives can only be assigned to Home Collection bookings.' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { assignedExecutiveId: executiveId },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Failed to assign executive:', error);
    res.status(500).json({ error: 'Failed to assign executive', details: error.message });
  }
};

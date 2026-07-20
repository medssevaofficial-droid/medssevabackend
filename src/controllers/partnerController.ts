import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Partner's own assigned bookings (active jobs)
export const getPartnerBookings = async (req: any, res: Response) => {
  try {
    const partner = await prisma.pathologyPartner.findUnique({
      where: { userId: req.user.id }
    });
    if (!partner) return res.status(404).json({ error: 'Partner profile not found.' });

    const bookings = await prisma.booking.findMany({
      where: { assignedPartnerId: partner.id },
      include: {
        user: { select: { name: true, mobile: true } },
        tests: { include: { test: { select: { name: true } } } },
        packages: { include: { package: { select: { name: true } } } },
        statusTimeline: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

  const formatted = await Promise.all(bookings.map(async (b) => {
      const address = await prisma.address.findUnique({ where: { id: b.addressId } });
      return {
        id: b.id,
        bookingCode: b.bookingCode,
        status: b.status,
        patientName: b.patientName,
        patientAge: b.patientAge,
        patientGender: b.patientGender,
        patientMobile: b.patientMobile,
        scheduledDate: b.scheduledDate,
        scheduledSlot: b.scheduledSlot,
        totalPaid: b.totalPaid,
        paymentStatus: b.paymentStatus,
        paymentMode: b.paymentMode,
        collectionMode: b.collectionMode,
        collectionOtp: b.collectionOtp,
        otpVerified: b.otpVerified,
        assignedPartnerId: b.assignedPartnerId,
        collectionStartedAt: b.collectionStartedAt,
        sampleCollectedAt: b.sampleCollectedAt,
        deliveredToLabAt: b.deliveredToLabAt,
        collectionAddress: address
          ? [address.line1, address.line2, address.city, address.pincode].filter(Boolean).join(', ')
          : null,
        tests: b.tests.map(t => ({ name: t.test.name })),
        packages: b.packages.map(p => ({ name: p.package.name })),
        statusTimeline: b.statusTimeline,
      };
    }));

    res.json(formatted);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch bookings', details: error.message });
  }
};

// New: broadcast notifications — all WAITING_FOR_PARTNER bookings this partner hasn't rejected
export const getPartnerNotifications = async (req: any, res: Response) => {
  try {
    const partner = await prisma.pathologyPartner.findUnique({
      where: { userId: req.user.id }
    });
    if (!partner) return res.status(404).json({ error: 'Partner profile not found.' });
    if (partner.approvalStatus !== 'APPROVED') {
      return res.status(403).json({ error: 'Partner not approved yet.' });
    }
    if (!partner.isAvailable) {
      return res.json([]); // offline partners see nothing
    }

    const rejectedIds = await prisma.bookingRejection.findMany({
      where: { partnerId: partner.id },
      select: { bookingId: true },
    });
    const excludedIds = rejectedIds.map(r => r.bookingId);

    const bookings = await prisma.booking.findMany({
      where: {
        collectionMode: 'HOME',
        status: 'WAITING_FOR_PARTNER',
        id: { notIn: excludedIds },
      },
      include: {
        tests: { include: { test: { select: { name: true } } } },
        packages: { include: { package: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const formatted = await Promise.all(bookings.map(async (b) => {
      const address = await prisma.address.findUnique({ where: { id: b.addressId } });
      return {
        id: b.id,
        bookingCode: b.bookingCode,
        patientName: b.patientName,
        patientMobile: b.patientMobile,
        scheduledDate: b.scheduledDate,
        scheduledSlot: b.scheduledSlot,
        totalPaid: b.totalPaid,
        status: b.status,
        collectionAddress: address ? `${address.line1}, ${address.city}` : null,
        tests: b.tests.map(t => ({ name: t.test.name })),
        packages: b.packages.map(p => ({ name: p.package.name })),
      };
    }));

    res.json(formatted);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch notifications', details: error.message });
  }
};

export const acceptBooking = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const partner = await prisma.pathologyPartner.findUnique({ where: { userId: req.user.id } });
    if (!partner) return res.status(404).json({ error: 'Partner profile not found.' });
    if (partner.approvalStatus !== 'APPROVED') {
      return res.status(403).json({ error: 'Partner not approved.' });
    }

  // Check current booking state first
    const existing = await prisma.booking.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Booking not found.' });

    // Case 1: Already accepted by THIS partner — idempotent, return current state
    if (existing.status === 'ACCEPTED' && existing.assignedPartnerId === partner.id) {
      const confirmedBooking = await prisma.booking.findUnique({ where: { id } });
      return res.json(confirmedBooking);
    }

    // Case 2: Atomic claim — only succeeds if still WAITING_FOR_PARTNER.
    // Sets status directly to ACCEPTED so user sees "Partner Assigned" immediately
    // with no intermediate ASSIGNED lag step on the partner app.
    const updated = await prisma.booking.updateMany({
      where: { id, status: 'WAITING_FOR_PARTNER' },
      data: {
        status: 'ACCEPTED',
        assignedPartnerId: partner.id,
        partnerAssignedAt: new Date(),
        partnerAcceptedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return res.status(409).json({ error: 'Booking already accepted by another partner.' });
    }

    await prisma.bookingStatusLog.create({
      data: {
        bookingId: id,
        status: 'ACCEPTED',
        note: `Accepted by partner ${partner.id}`,
        updatedBy: req.user.id,
      }
    });

    const booking = await prisma.booking.findUnique({ where: { id } });

    // Auto-generate OTP for pay-at-doorstep bookings only
    if (booking && booking.paymentStatus !== 'SUCCESS' && !booking.collectionOtp) {
      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      await prisma.booking.update({
        where: { id },
        data: { collectionOtp: otp },
      });
    }

   const updatedBooking = await prisma.booking.findUnique({
      where: { id },
      include: {
        assignedPartner: {
          include: {
            user: {
              select: { name: true, mobile: true, avatarUrl: true }
            }
          }
        }
      }
    });
    res.json(updatedBooking);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to accept booking', details: error.message });
  }
};

export const rejectBooking = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const partner = await prisma.pathologyPartner.findUnique({ where: { userId: req.user.id } });
    if (!partner) return res.status(404).json({ error: 'Partner profile not found.' });

   const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

const canReject = booking.status === 'WAITING_FOR_PARTNER' ||
      (booking.status === 'ACCEPTED' && booking.assignedPartnerId === partner.id);

    if (!canReject) {
      return res.status(400).json({ error: 'Booking cannot be rejected at this stage.' });
    }

    // If partner already accepted, release the booking back to the pool
    if (booking.status === 'ACCEPTED' && booking.assignedPartnerId === partner.id) {
      await prisma.booking.update({
        where: { id },
        data: {
          status: 'WAITING_FOR_PARTNER',
          assignedPartnerId: null,
          partnerAssignedAt: null,
          partnerAcceptedAt: null,
          collectionOtp: null,
        },
      });
    }
    // Record rejection — this partner won't see this booking again
    await prisma.bookingRejection.upsert({
      where: { bookingId_partnerId: { bookingId: id, partnerId: partner.id } },
      update: { reason: reason || null },
      create: { bookingId: id, partnerId: partner.id, reason: reason || null },
    });

    await prisma.bookingStatusLog.create({
      data: {
        bookingId: id,
        status: 'WAITING_FOR_PARTNER',
        note: reason ? `Rejected by partner ${partner.id}: ${reason}` : `Rejected by partner ${partner.id}`,
        updatedBy: req.user.id,
      }
    });

    // Check if ALL approved+available partners have now rejected
    const [totalEligible, totalRejections] = await Promise.all([
      prisma.pathologyPartner.count({
        where: { approvalStatus: 'APPROVED', isAvailable: true }
      }),
      prisma.bookingRejection.count({ where: { bookingId: id } }),
    ]);

    if (totalEligible > 0 && totalRejections >= totalEligible) {
      // All partners rejected — Admin needs to manually assign
      console.warn(`⚠️  All partners rejected booking ${id}. Admin manual assignment required.`);
      // TODO: fire push/email notification to admin here
    }

    res.json({ message: 'Booking rejected successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to reject booking', details: error.message });
  }
};

const VALID_PARTNER_STATUSES = [
  'ON_THE_WAY', 'REACHED_LOCATION', 'SAMPLE_COLLECTED', 'DELIVERED_TO_LAB', 'PROCESSING'
];
export const updateBookingStatus = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    if (!VALID_PARTNER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_PARTNER_STATUSES.join(', ')}` });
    }

    const partner = await prisma.pathologyPartner.findUnique({ where: { userId: req.user.id } });
    if (!partner) return res.status(404).json({ error: 'Partner profile not found.' });

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.assignedPartnerId !== partner.id) {
      return res.status(403).json({ error: 'This booking is not assigned to you.' });
    }

    // Gate: SAMPLE_COLLECTED requires OTP verified + payment received
    if (status === 'SAMPLE_COLLECTED') {
      if (!booking.otpVerified && booking.paymentStatus !== 'SUCCESS') {
        return res.status(400).json({ error: 'OTP must be verified before collecting sample.' });
      }
      if (booking.paymentStatus !== 'SUCCESS') {
        return res.status(400).json({ error: 'Payment must be collected before marking sample collected.' });
      }
    }

    const timestampField: Record<string, string> = {
      ON_THE_WAY: 'collectionStartedAt',
      SAMPLE_COLLECTED: 'sampleCollectedAt',
      DELIVERED_TO_LAB: 'deliveredToLabAt',
    };

    const updateData: any = { status };
    if (timestampField[status]) {
      updateData[timestampField[status]] = new Date();
    }
    if (status === 'SAMPLE_COLLECTED') {
      updateData.partnerNote = note || null;
    }
    if (status === 'DELIVERED_TO_LAB') {
      updateData.status = 'DELIVERED_TO_LAB';
      await prisma.pathologyPartner.update({
        where: { id: partner.id },
        data: { totalCollections: { increment: 1 } }
      });
    }

    const updated = await prisma.booking.update({ where: { id }, data: updateData });

    await prisma.bookingStatusLog.create({
      data: { bookingId: id, status: status as any, note: note || null, updatedBy: req.user.id }
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update status', details: error.message });
  }
};

// Cash collection by partner at doorstep
export const collectCash = async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    const partner = await prisma.pathologyPartner.findUnique({ where: { userId: req.user.id } });
    if (!partner) return res.status(404).json({ error: 'Partner profile not found.' });

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.assignedPartnerId !== partner.id) {
      return res.status(403).json({ error: 'This booking is not assigned to you.' });
    }
    if (!booking.otpVerified) {
      return res.status(400).json({ error: 'OTP must be verified before collecting payment.' });
    }
    if (booking.paymentStatus === 'SUCCESS') {
      return res.status(400).json({ error: 'Payment has already been collected for this booking.' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        paymentStatus: 'SUCCESS',
        paymentMode: 'CASH',
        paymentReceivedAt: new Date(),
        paymentReceivedById: req.user.id,
      },
    });

    await prisma.bookingStatusLog.create({
      data: {
        bookingId: id,
        status: booking.status as any,
        note: 'Cash collected by partner at doorstep',
        updatedBy: req.user.id,
      }
    });

    res.json({ success: true, paymentStatus: 'SUCCESS', paymentMode: 'CASH', booking: updated });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to collect cash', details: error.message });
  }
};

// Initiate UPI collection — creates a Razorpay payment link for the patient to scan
import Razorpay from 'razorpay';
export const initiateUpiCollection = async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    // ── 1. Razorpay config guard ───────────────────────────────────────────────
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.error('[UPI] Razorpay env vars missing: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET');
      return res.status(500).json({ error: 'Razorpay is not configured on the server.' });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    // ── 2. Partner guard ──────────────────────────────────────────────────────
    const partner = await prisma.pathologyPartner.findUnique({ where: { userId: req.user.id } });
    if (!partner) return res.status(404).json({ error: 'Partner profile not found.' });

    // ── 3. Booking guard ──────────────────────────────────────────────────────
    const booking = await prisma.booking.findUnique({ where: { id }, include: { user: true } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.assignedPartnerId !== partner.id) {
      return res.status(403).json({ error: 'This booking is not assigned to you.' });
    }
    if (!booking.otpVerified) {
      return res.status(400).json({ error: 'OTP must be verified before initiating UPI payment.' });
    }
    if (booking.paymentStatus === 'SUCCESS') {
      return res.status(400).json({ error: 'Payment has already been collected.' });
    }

    // ── 4. Amount guard ───────────────────────────────────────────────────────
    const amountPaise = Math.round(Number(booking.totalPaid) * 100);
    if (!amountPaise || amountPaise <= 0) {
      console.error(`[UPI] Invalid amount for booking ${id}: totalPaid=${booking.totalPaid}`);
      return res.status(400).json({ error: 'Booking has an invalid payment amount.' });
    }

    // ── 5. Reuse existing unexpired link ──────────────────────────────────────
    if ((booking as any).paymentLinkId) {
      try {
        const existing = await razorpay.paymentLink.fetch((booking as any).paymentLinkId);
        if (existing.status !== 'paid' && existing.status !== 'expired' && existing.status !== 'cancelled') {
          console.log(`[UPI] Reusing existing payment link ${(booking as any).paymentLinkId} (status: ${existing.status})`);
          return res.json({
            paymentLinkId: (booking as any).paymentLinkId,
            paymentLinkUrl: (booking as any).paymentLinkUrl,
          });
        }
        console.log(`[UPI] Existing link status is "${existing.status}" — creating a new one.`);
      } catch (fetchErr: any) {
        // If fetch fails (e.g. stale ID), log and fall through to create a fresh link
        console.warn(`[UPI] Could not fetch existing payment link: ${fetchErr?.message}`);
      }
    }

    // ── 6. Create new Razorpay payment link ───────────────────────────────────
    console.log(`[UPI] Creating payment link for booking ${id}, amount=${amountPaise} paise`);
    let link: any;
    try {
      link = await razorpay.paymentLink.create({
        amount: amountPaise,
        currency: 'INR',
        description: `MedsSeva Booking #${booking.bookingCode}`,
        customer: {
          name: booking.patientName,
          contact: booking.user?.mobile ?? '',
        },
        notify: { sms: false, email: false },
       expire_by: Math.floor(Date.now() / 1000) + 20 * 60, // 20 minutes (Razorpay minimum is 15)
      });
    } catch (razorpayErr: any) {
      // Surface Razorpay's own error message clearly
      const rzpMsg =
        razorpayErr?.error?.description ||
        razorpayErr?.message ||
        'Unknown Razorpay error';
      console.error(`[UPI] Razorpay paymentLink.create failed: ${rzpMsg}`, razorpayErr);
      return res.status(502).json({
        error: 'Could not create UPI payment link via Razorpay.',
        details: rzpMsg,
      });
    }

    // ── 7. Persist link on booking (graceful if columns don't exist yet) ──────
    try {
      await (prisma.booking as any).update({
        where: { id },
        data: { paymentLinkId: link.id, paymentLinkUrl: link.short_url },
      });
    } catch (dbErr: any) {
      // Non-fatal — link was created, we just can't reuse it next time
      console.warn(`[UPI] Could not persist paymentLinkId on booking ${id}: ${dbErr?.message}`);
      console.warn('[UPI] Run: npx prisma migrate dev --name add_payment_link_fields');
    }

    console.log(`[UPI] Payment link created: ${link.short_url}`);
    res.json({ paymentLinkId: link.id, paymentLinkUrl: link.short_url });

  } catch (error: any) {
    console.error('[UPI] Unexpected error in initiateUpiCollection:', error);
    res.status(500).json({
      error: 'Failed to initiate UPI collection',
      details: error?.message ?? 'Unknown error',
    });
  }
};
// Poll UPI payment status — partner app calls this every few seconds
export const checkUpiPaymentStatus = async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
      ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
      : null;

    if (!razorpay) {
      return res.status(500).json({ error: 'Razorpay is not configured on the server.' });
    }

    const partner = await prisma.pathologyPartner.findUnique({ where: { userId: req.user.id } });
    if (!partner) return res.status(404).json({ error: 'Partner profile not found.' });

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.assignedPartnerId !== partner.id) {
      return res.status(403).json({ error: 'Not your booking.' });
    }

    // Already paid — short-circuit
    if (booking.paymentStatus === 'SUCCESS') {
      return res.json({ paymentStatus: 'SUCCESS' });
    }

    if (!booking.paymentLinkId) {
      return res.status(400).json({ error: 'No UPI payment link found for this booking.' });
    }

    const link = await razorpay.paymentLink.fetch(booking.paymentLinkId);

    if (link.status === 'paid') {
      await prisma.booking.update({
        where: { id },
        data: {
          paymentStatus: 'SUCCESS',
          paymentMode: 'UPI',
          paymentReceivedAt: new Date(),
          paymentReceivedById: req.user.id,
        },
      });

      await prisma.bookingStatusLog.create({
        data: {
          bookingId: id,
          status: booking.status as any,
          note: 'UPI payment received via Razorpay QR',
          updatedBy: req.user.id,
        }
      });

      return res.json({ paymentStatus: 'SUCCESS' });
    }

    // Map Razorpay link statuses to useful messages
    const statusMessages: Record<string, string> = {
      created: 'Waiting for patient to scan and pay.',
      partially_paid: 'Partial payment received. Full amount required.',
      expired: 'Payment link expired. Please generate a new one.',
      cancelled: 'Payment was cancelled.',
    };

    res.json({
      paymentStatus: 'PENDING',
      razorpayStatus: link.status,
      message: statusMessages[link.status] || 'Payment pending.',
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to check UPI payment status', details: error.message });
  }
};

export const toggleAvailability = async (req: any, res: Response) => {
  try {
    const { isAvailable } = req.body;
    if (typeof isAvailable !== 'boolean') {
      return res.status(400).json({ error: 'isAvailable must be a boolean.' });
    }

    const partner = await prisma.pathologyPartner.update({
      where: { userId: req.user.id },
      data: { isAvailable },
    });

    res.json({ isAvailable: partner.isAvailable });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update availability', details: error.message });
  }
};

export const getPartnerProfile = async (req: any, res: Response) => {
  try {
    const partner = await prisma.pathologyPartner.findUnique({
      where: { userId: req.user.id },
      include: {
        user: { select: { name: true, email: true, mobile: true, avatarUrl: true } }
      }
    });
    if (!partner) return res.status(404).json({ error: 'Partner profile not found.' });

    res.json({
      ...partner,
      name: partner.user.name,
      email: partner.user.email,
      mobile: partner.user.mobile,
      avatarUrl: partner.user.avatarUrl,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch profile', details: error.message });
  }
};

export const getPartnerHistory = async (req: any, res: Response) => {
  try {
    const partner = await prisma.pathologyPartner.findUnique({
      where: { userId: req.user.id }
    });
    if (!partner) return res.status(404).json({ error: 'Partner profile not found.' });

    // Bookings this partner completed or was assigned to (any terminal status)
    const assignedBookings = await prisma.booking.findMany({
      where: {
        assignedPartnerId: partner.id,
        status: { in: ['DELIVERED_TO_LAB', 'PROCESSING', 'REPORT_READY', 'COMPLETED', 'CANCELLED'] },
      },
      include: {
        tests: { include: { test: { select: { name: true } } } },
        packages: { include: { package: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Bookings this partner explicitly rejected
    const rejections = await prisma.bookingRejection.findMany({
      where: { partnerId: partner.id },
      include: {
        booking: {
          include: {
            tests: { include: { test: { select: { name: true } } } },
            packages: { include: { package: { select: { name: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const assignedFormatted = await Promise.all(assignedBookings.map(async (b) => {
      const address = await prisma.address.findUnique({ where: { id: b.addressId } });
      return {
        id: b.id,
        bookingCode: b.bookingCode,
        patientName: b.patientName,
        scheduledDate: b.scheduledDate,
        scheduledSlot: b.scheduledSlot,
        totalPaid: b.totalPaid,
        status: b.status,
        collectionAddress: address ? `${address.line1}, ${address.city}` : null,
        completedAt: b.deliveredToLabAt || b.sampleCollectedAt || null,
        tests: b.tests.map(t => ({ name: t.test.name })),
        packages: b.packages.map(p => ({ name: p.package.name })),
        isRejected: false,
      };
    }));

    const rejectedFormatted = await Promise.all(rejections.map(async (r) => {
      const b = r.booking;
      const address = await prisma.address.findUnique({ where: { id: b.addressId } });
      return {
        id: b.id,
        bookingCode: b.bookingCode,
        patientName: b.patientName,
        scheduledDate: b.scheduledDate,
        scheduledSlot: b.scheduledSlot,
        totalPaid: b.totalPaid,
        status: 'REJECTED_BY_PARTNER',
        collectionAddress: address ? `${address.line1}, ${address.city}` : null,
        completedAt: null,
        rejectedAt: r.createdAt,
        rejectionReason: r.reason,
        tests: b.tests.map(t => ({ name: t.test.name })),
        packages: b.packages.map(p => ({ name: p.package.name })),
        isRejected: true,
      };
    }));

    // Merge and sort by date descending, deduplicate by booking id
    const seen = new Set<string>();
    const merged = [...assignedFormatted, ...rejectedFormatted]
      .sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime())
      .filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });

    res.json(merged);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch history', details: error.message });
  }
};

export const getPartnerStats = async (req: any, res: Response) => {
  try {
    const partner = await prisma.pathologyPartner.findUnique({ where: { userId: req.user.id } });
    if (!partner) return res.status(404).json({ error: 'Partner profile not found.' });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [todayBookings, pendingCount, acceptedCount, completedToday] = await Promise.all([
      prisma.booking.count({
        where: {
          assignedPartnerId: partner.id,
          partnerAssignedAt: { gte: todayStart, lte: todayEnd },
        }
      }),
      prisma.booking.count({
        where: { assignedPartnerId: partner.id, status: 'ASSIGNED' }
      }),
      prisma.booking.count({
        where: { assignedPartnerId: partner.id, status: 'ACCEPTED' }
      }),
      prisma.booking.count({
        where: {
          assignedPartnerId: partner.id,
          status: { in: ['DELIVERED_TO_LAB', 'PROCESSING', 'COMPLETED'] },
          deliveredToLabAt: { gte: todayStart, lte: todayEnd },
        }
      }),
    ]);

    res.json({
      todayJobs: todayBookings,
      pending: pendingCount,
      accepted: acceptedCount,
      completedToday,
      completedPercent: todayBookings > 0 ? Math.round((completedToday / todayBookings) * 100) : 0,
      totalCollections: partner.totalCollections,
      rating: partner.rating,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
  }
};